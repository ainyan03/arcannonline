// 弾幕エンジン: スクリプト実行・弾の移動・場外カリング・弾同士の衝突。
// 描画/通信に依存しない純粋なモジュール。固定タイムステップ (TICK_RATE) で
// tick() を呼ぶこと。
import {
  FIELD_SIZE,
  MAX_BULLETS,
  TICK_RATE,
} from '../../../../shared/src/protocol';
import { parse, type Program } from './parser';
import { mulberry32 } from './rng';
import { ScriptRun, type ScriptContext } from './vm';

const DT = 1 / TICK_RATE;
const CULL_BOUND = FIELD_SIZE / 2 + 10;
const BULLET_TTL_TICKS = TICK_RATE * 60;
/** 衝突判定の空間ハッシュのセルサイズ (最大弾半径×2 より大きいこと) */
const CELL = 2;
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

export interface Bullet {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 耐久度。弾同士の衝突で互いに減算し合い、0 以下で消滅する */
  dur: number;
  radius: number;
  owner: string;
  ttl: number;
}

interface RunEntry {
  run: ScriptRun;
}

export class BulletEngine {
  /** 弾プール (死んだスロットは再利用される)。読み取り専用で公開 */
  readonly bullets: Bullet[] = [];

  private readonly runs: RunEntry[] = [];
  private readonly compiled = new Map<string, Program>();
  private alive = 0;
  private freeSlots: number[] = [];

  get aliveCount(): number {
    return this.alive;
  }

  get runCount(): number {
    return this.runs.length;
  }

  /**
   * スクリプトの実行を開始する。
   * @param catchupTicks 受信遅延分を過去に遡って再生する tick 数 (ローカル発射は 0)
   */
  startScript(
    source: string,
    seed: number,
    x: number,
    y: number,
    dirRad: number,
    owner: string,
    catchupTicks = 0,
  ): void {
    let program = this.compiled.get(source);
    if (!program) {
      try {
        program = parse(source);
      } catch (err) {
        console.warn('[danmaku] parse error:', err);
        return;
      }
      this.compiled.set(source, program);
    }

    let pendingAdvance = 0; // 追いつき再生中に生成された弾を進める tick 数
    const ctx: ScriptContext = {
      dir: dirRad * RAD_TO_DEG,
      t: 0,
      random: mulberry32(seed),
      fire: (angleDeg, speed, dur, radius) =>
        this.spawn(x, y, angleDeg, speed, dur, radius, owner, pendingAdvance),
    };
    const run = new ScriptRun(program, ctx);

    // 追いつき再生: スクリプト自体を経過 tick ぶん進め、その間に生成された
    // 弾は残り時間ぶん位置を先へ進める (弾は等速直線運動なので単純加算でよい)
    for (let k = 0; k < catchupTicks && !run.done; k++) {
      pendingAdvance = catchupTicks - k;
      run.tick();
    }
    pendingAdvance = 0;

    if (!run.done) this.runs.push({ run });
  }

  tick(): void {
    // スクリプト進行 (弾の生成)
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const entry = this.runs[i];
      entry.run.tick();
      if (entry.run.done) {
        this.runs[i] = this.runs[this.runs.length - 1];
        this.runs.pop();
      }
    }

    // 弾の移動・寿命・場外カリング
    const bs = this.bullets;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (!b.alive) continue;
      b.x += b.vx * DT;
      b.y += b.vy * DT;
      b.ttl--;
      if (
        b.ttl <= 0 ||
        b.x < -CULL_BOUND || b.x > CULL_BOUND ||
        b.y < -CULL_BOUND || b.y > CULL_BOUND
      ) {
        this.kill(i);
      }
    }

    this.collide();
  }

  private spawn(
    x: number,
    y: number,
    angleDeg: number,
    speed: number,
    dur: number,
    radius: number,
    owner: string,
    advanceTicks: number,
  ): void {
    if (this.alive >= MAX_BULLETS) return;
    const a = angleDeg * DEG_TO_RAD;
    const spd = Math.min(Math.max(speed, 0), 60);
    const vx = Math.cos(a) * spd;
    const vy = Math.sin(a) * spd;
    const bullet: Bullet = {
      alive: true,
      x: x + vx * DT * advanceTicks,
      y: y + vy * DT * advanceTicks,
      vx,
      vy,
      dur: Math.min(Math.max(dur, 1), 1000),
      radius: Math.min(Math.max(radius, 0.1), 0.9),
      owner,
      ttl: BULLET_TTL_TICKS - advanceTicks,
    };
    const slot = this.freeSlots.pop();
    if (slot !== undefined) {
      this.bullets[slot] = bullet;
    } else {
      this.bullets.push(bullet);
    }
    this.alive++;
  }

  private kill(index: number): void {
    const b = this.bullets[index];
    if (!b.alive) return;
    b.alive = false;
    this.freeSlots.push(index);
    this.alive--;
  }

  /**
   * 弾同士の衝突。所有者が異なる弾同士が接触したら、衝突時点の耐久度を
   * 互いに減算し合い、0 以下になった弾は消滅する。
   */
  private collide(): void {
    const bs = this.bullets;
    const grid = new Map<number, number[]>();
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (!b.alive) continue;
      const key = this.cellKey(b.x, b.y);
      const cell = grid.get(key);
      if (cell) cell.push(i);
      else grid.set(key, [i]);
    }

    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      if (!a.alive) continue;
      const cx = Math.floor(a.x / CELL);
      const cy = Math.floor(a.y / CELL);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const cell = grid.get((cx + ox + 32768) * 65536 + (cy + oy + 32768));
          if (!cell) continue;
          for (const j of cell) {
            if (j <= i) continue;
            const b = bs[j];
            if (!b.alive || !a.alive) continue;
            if (a.owner === b.owner) continue;
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const rr = a.radius + b.radius;
            if (dx * dx + dy * dy <= rr * rr) {
              const da = a.dur;
              const db = b.dur;
              a.dur -= db;
              b.dur -= da;
              if (a.dur <= 0) this.kill(i);
              if (b.dur <= 0) this.kill(j);
            }
          }
          if (!a.alive) break;
        }
        if (!a.alive) break;
      }
    }
  }

  private cellKey(x: number, y: number): number {
    return (Math.floor(x / CELL) + 32768) * 65536 + (Math.floor(y / CELL) + 32768);
  }
}
