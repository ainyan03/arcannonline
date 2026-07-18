// 弾幕エンジン: スクリプト実行・弾の移動・場外カリング・弾同士の衝突。
// 描画/通信に依存しない純粋なモジュール。固定タイムステップ (TICK_RATE) で
// tick() を呼ぶこと。
import {
  BULLET_COST_BASE,
  BULLET_COST_PER_DUR,
  BULLET_COST_PER_RADIUS,
  FIELD_SIZE,
  MAX_BULLETS,
  MAX_OWN_BULLETS,
  TICK_RATE,
  type Vec2,
} from '../../../../shared/src/protocol';
import { parse, type Program } from './parser';
import { mulberry32 } from './rng';
import { ScriptRun, type ScriptContext } from './vm';

const DT = 1 / TICK_RATE;

function clampNum(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** 1発あたりのエネルギーコスト (spawn と同じクランプ後の値で計算する) */
export function bulletCost(dur: number, radius: number): number {
  const d = clampNum(dur, 1, 1000);
  const r = clampNum(radius, 0.1, 0.9);
  return (
    BULLET_COST_BASE +
    BULLET_COST_PER_DUR * (d - 1) +
    BULLET_COST_PER_RADIUS * Math.max(r - 0.4, 0)
  );
}
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
  /** 発射イベントID。spawnIdx と合わせてクライアント間で弾を特定する */
  fireId: string;
  /** そのスクリプト実行が何発目に生成した弾か */
  spawnIdx: number;
  /** 生成された tick (オーナー上限超過時の「最古の弾」判定に使う) */
  born: number;
}

interface RunEntry {
  run: ScriptRun;
}

export class BulletEngine {
  /** 弾プール (死んだスロットは再利用される)。読み取り専用で公開 */
  readonly bullets: Bullet[] = [];

  private readonly runs: RunEntry[] = [];
  private readonly compiled = new Map<string, Program>();
  private readonly ownerCounts = new Map<string, number>();
  private alive = 0;
  private freeSlots: number[] = [];
  private tickCounter = 0;

  constructor(
    private readonly maxBullets = MAX_BULLETS,
    private readonly ownerCap = MAX_OWN_BULLETS,
  ) {}

  /** ベンチマーク用: ランダムな弾を大量投入する (ゲーム本体では使わない) */
  debugFill(count: number, seed = 1, owners = 4): void {
    const rng = mulberry32(seed);
    for (let i = 0; i < count; i++) {
      const angle = rng() * 360;
      this.spawn(
        (rng() * 2 - 1) * 80,
        (rng() * 2 - 1) * 80,
        angle,
        3 + rng() * 12,
        1 + Math.floor(rng() * 3),
        0.3 + rng() * 0.3,
        `bench${i % owners}`,
        0,
        'bench',
        i,
      );
    }
  }

  get aliveCount(): number {
    return this.alive;
  }

  /** 指定オーナーの生存弾数 */
  aliveOwned(owner: string): number {
    return this.ownerCounts.get(owner) ?? 0;
  }

  /**
   * スクリプトの総エネルギーコストを空実行で算出する。
   * 実際の発射と同じシード・照準を使うため、乱数分岐があっても
   * 実際に生成される弾列と正確に一致する。
   * @returns コスト。構文エラーや暴走時は null
   */
  estimateCost(
    source: string,
    seed: number,
    dirRad: number,
    origin: () => Vec2,
    targetPos: () => Vec2 | null = () => null,
  ): number | null {
    let program = this.compiled.get(source);
    if (!program) {
      try {
        program = parse(source);
      } catch {
        return null;
      }
      this.compiled.set(source, program);
    }
    let cost = 0;
    const dirDeg = dirRad * RAD_TO_DEG;
    const ctx: ScriptContext = {
      dir: dirDeg,
      t: 0,
      random: mulberry32(seed),
      fire: (_angle, _speed, dur, radius) => {
        cost += bulletCost(dur, radius);
      },
      aim: () => {
        const tp = targetPos();
        if (!tp) return dirDeg;
        const p = origin();
        return Math.atan2(tp.y - p.y, tp.x - p.x) * RAD_TO_DEG;
      },
      tdist: () => {
        const tp = targetPos();
        if (!tp) return -1;
        const p = origin();
        return Math.hypot(tp.x - p.x, tp.y - p.y);
      },
    };
    const run = new ScriptRun(program, ctx);
    // wait を含めて最大60秒ぶんを一気に空回しする
    for (let i = 0; i < TICK_RATE * 60 && !run.done; i++) run.tick();
    return cost;
  }

  get runCount(): number {
    return this.runs.length;
  }

  /**
   * スクリプトの実行を開始する。
   * @param origin 発射元の現在位置を返す関数。移動しながらの発射で
   *   弾の出発点が追従するよう、fire のたびに評価される
   * @param targetPos ターゲットの現在位置を返す関数 (未指定なら null)。
   *   DSL の aim / tdist が評価のたびに参照する
   * @param catchupTicks 受信遅延分を過去に遡って再生する tick 数 (ローカル発射は 0)
   */
  startScript(
    source: string,
    seed: number,
    origin: () => Vec2,
    dirRad: number,
    owner: string,
    targetPos: () => Vec2 | null = () => null,
    catchupTicks = 0,
    fireId = '',
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
    let spawnCounter = 0;
    const dirDeg = dirRad * RAD_TO_DEG;
    const ctx: ScriptContext = {
      dir: dirDeg,
      t: 0,
      random: mulberry32(seed),
      fire: (angleDeg, speed, dur, radius, lifeSec) => {
        const p = origin();
        this.spawn(
          p.x, p.y, angleDeg, speed, dur, radius, owner, pendingAdvance,
          fireId, spawnCounter++, lifeSec,
        );
      },
      aim: () => {
        const tp = targetPos();
        if (!tp) return dirDeg;
        const p = origin();
        return Math.atan2(tp.y - p.y, tp.x - p.x) * RAD_TO_DEG;
      },
      tdist: () => {
        const tp = targetPos();
        if (!tp) return -1;
        const p = origin();
        return Math.hypot(tp.x - p.x, tp.y - p.y);
      },
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
    this.tickCounter++;
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
    fireId: string,
    spawnIdx: number,
    lifeSec = 60,
  ): void {
    if (this.alive >= this.maxBullets) return;
    // 残存時間 (追いつき再生で既に寿命切れの弾は生成しない)
    const lifeTicks = Math.min(
      Math.max(Math.round(lifeSec * TICK_RATE), 1),
      BULLET_TTL_TICKS,
    );
    const ttl = lifeTicks - advanceTicks;
    if (ttl <= 0) return;
    // オーナーごとの上限: 超える場合は最も古い弾の寿命を前倒しして消す。
    // 全クライアントが同じ規則を適用するため追加の同期なしで一致する
    if ((this.ownerCounts.get(owner) ?? 0) >= this.ownerCap) {
      this.killOldest(owner);
    }
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
      ttl,
      fireId,
      spawnIdx,
      born: this.tickCounter - advanceTicks,
    };
    const slot = this.freeSlots.pop();
    if (slot !== undefined) {
      this.bullets[slot] = bullet;
    } else {
      this.bullets.push(bullet);
    }
    this.alive++;
    this.ownerCounts.set(owner, (this.ownerCounts.get(owner) ?? 0) + 1);
  }

  /** 外部からの弾の消費 (被弾処理など)。index は bullets 配列上の位置 */
  killAt(index: number): void {
    this.kill(index);
  }

  /** 発射イベントID + 生成順で弾を特定して消す (他クライアントからの消滅通知) */
  killByFire(fireId: string, spawnIdx: number): void {
    if (!fireId) return;
    const bs = this.bullets;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (b.alive && b.spawnIdx === spawnIdx && b.fireId === fireId) {
        this.kill(i);
        return;
      }
    }
  }

  private kill(index: number): void {
    const b = this.bullets[index];
    if (!b.alive) return;
    b.alive = false;
    this.freeSlots.push(index);
    this.alive--;
    const n = (this.ownerCounts.get(b.owner) ?? 1) - 1;
    if (n <= 0) this.ownerCounts.delete(b.owner);
    else this.ownerCounts.set(b.owner, n);
  }

  /**
   * 指定オーナーの最も古い弾を消す。同 tick 生成のタイブレークは
   * (fireId, spawnIdx) で行う。プール上のスロット順はクライアント毎に
   * 異なり得るため、順序判定には使わない
   */
  private killOldest(owner: string): void {
    let oldest: Bullet | null = null;
    let oldestIdx = -1;
    const bs = this.bullets;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (!b.alive || b.owner !== owner) continue;
      if (
        oldest === null ||
        b.born < oldest.born ||
        (b.born === oldest.born &&
          (b.fireId < oldest.fireId ||
            (b.fireId === oldest.fireId && b.spawnIdx < oldest.spawnIdx)))
      ) {
        oldest = b;
        oldestIdx = i;
      }
    }
    if (oldestIdx >= 0) this.kill(oldestIdx);
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
