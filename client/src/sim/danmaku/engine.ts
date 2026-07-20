// 弾幕エンジン: スクリプト実行・弾の移動・場外カリング・弾同士の衝突。
// 描画/通信に依存しない純粋なモジュール。固定タイムステップ (TICK_RATE) で
// tick() を呼ぶこと。
import {
  BULLET_BASE_RADIUS,
  BULLET_COST_BASE,
  BULLET_COST_PER_DUR,
  BULLET_COST_PER_RADIUS,
  FIELD_SIZE,
  MAX_BULLETS,
  MAX_OWN_BULLETS,
  TICK_RATE,
  type Vec2,
} from '../../../../shared/src/protocol';
import type { CircleObstacle } from '../../../../shared/src/obstacles';
import { parse, type Program } from './parser';
import { mulberry32 } from './rng';
import { MAX_SCRIPT_TICKS, ScriptRun, type ScriptContext } from './vm';

const DT = 1 / TICK_RATE;

function clampNum(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** 1発あたりのエネルギーコスト (spawn と同じクランプ後の値で計算する) */
export function bulletCost(dur: number, radius: number): number {
  const d = clampNum(dur, 1, 1000);
  const r = clampNum(radius, 0.05, 0.9);
  return (
    BULLET_COST_BASE +
    BULLET_COST_PER_DUR * (d - 1) +
    BULLET_COST_PER_RADIUS * Math.max(r - BULLET_BASE_RADIUS, 0)
  );
}
const CULL_BOUND = FIELD_SIZE / 2 + 10;
/**
 * 弾の残存時間の上限 (スクリプトが明示指定しても超えられない)。
 * フィールド全域を貫通する長射程を防ぎ、避けた弾が画面外で漂い続けないようにする
 */
const BULLET_TTL_TICKS = TICK_RATE * 8;
/** 残存時間の既定値 (秒)。射程 ≒ 速度 × この秒数 (典型速度 10〜18 で 40〜72) */
const DEFAULT_BULLET_LIFE_SEC = 4;
/**
 * 寿命の残りがこの tick 数を切ったら弾を縮小していく (消滅演出)。
 * 見た目だけでなく判定半径も一緒に縮める (ttl は決定論なので全クライアント一致)
 */
const SHRINK_TICKS = TICK_RATE; // 1秒
/** 縮小の下限倍率 (消える瞬間まで視認・被弾できる大きさを残す) */
const SHRINK_FLOOR = 0.25;
/** 衝突判定の空間ハッシュのセルサイズ (最大弾半径×2 より大きいこと) */
const CELL = 2;
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const COMPILED_CACHE_MAX = 128;
const PENDING_MUTATION_MAX = 4_096;
const PENDING_MUTATION_TICKS = MAX_SCRIPT_TICKS + BULLET_TTL_TICKS;

export interface Bullet {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 耐久度。弾同士の衝突で互いに減算し合い、0 以下で消滅する */
  dur: number;
  /** 現在の半径。寿命の最後の1秒は radius0 から縮小していく */
  radius: number;
  /** 生成時の半径 */
  radius0: number;
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
  owner: string;
}

/** 弾の消滅理由。collide=弾同士の相殺, hit=キャラへの被弾消費 */
export type KillCause = 'collide' | 'hit' | 'expire' | 'fifo';

export class BulletEngine {
  /** 弾プール (死んだスロットは再利用される)。読み取り専用で公開 */
  readonly bullets: Bullet[] = [];

  /** 弾が消えた時に呼ばれる (演出用)。sim 本体はこれに依存しない */
  onKill?: (bullet: Bullet, cause: KillCause) => void;
  /** 担当ピアだけが衝突演算を行うための判定。未指定なら従来通り全衝突を処理する */
  canResolveCollision?: (a: Bullet, b: Bullet) => boolean;
  /** 衝突で確定した可換な耐久ダメージ (aへのdamageA、bへのdamageB) */
  onCollision?: (a: Bullet, b: Bullet, damageA: number, damageB: number) => void;
  /** 同陣営など、弾同士を衝突させない所有者ペアの判定 */
  areAllied?: (ownerA: string, ownerB: string) => boolean;

  private readonly runs: RunEntry[] = [];
  private readonly compiled = new Map<string, Program>();
  private readonly ownerCounts = new Map<string, number>();
  /** tick間でセル配列を再利用し、弾幕中のGC停止を抑える空間グリッド */
  private readonly collisionGrid = new Map<number, number[]>();
  private alive = 0;
  private freeSlots: number[] = [];
  private tickCounter = 0;
  private readonly pendingKills = new Map<string, number>();
  private readonly pendingDamage = new Map<
    string,
    { damage: number; expires: number; owner?: string }
  >();
  /** 全クライアント共通の静的障害物。ゲーム本体から明示設定する。 */
  private obstacles: readonly CircleObstacle[] = [];

  constructor(
    private readonly maxBullets = MAX_BULLETS,
    private readonly ownerCap = MAX_OWN_BULLETS,
  ) {}

  setObstacles(obstacles: readonly CircleObstacle[]): void {
    this.obstacles = obstacles;
  }

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
    let program: Program;
    try {
      program = this.compile(source);
    } catch {
      return null;
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
    const run = new ScriptRun(program, ctx, true);
    // wait を含めて実行上限まで空回しし、完了しない/異常終了するスクリプトは拒否する
    for (let i = 0; i < MAX_SCRIPT_TICKS && !run.done; i++) run.tick();
    return run.done && !run.failed ? cost : null;
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
   * @param inheritedVelocity 発射元から引き継ぐ固定速度。生成される全弾へ加算する
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
    inheritedVelocity: Vec2 = { x: 0, y: 0 },
  ): void {
    let program: Program;
    try {
      program = this.compile(source);
    } catch (err) {
      console.warn('[danmaku] parse error:', err);
      return;
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
          fireId, spawnCounter++, lifeSec, inheritedVelocity,
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

    if (!run.done) this.runs.push({ run, owner });
  }

  /** 指定オーナーの実行中スクリプトがあるか (発射の重ね掛け防止に使う) */
  ownerHasRun(owner: string): boolean {
    for (const entry of this.runs) {
      if (entry.owner === owner) return true;
    }
    return false;
  }

  tick(): void {
    this.tickCounter++;
    if (this.tickCounter % TICK_RATE === 0) this.cleanupPendingMutations();
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
      const fromX = b.x;
      const fromY = b.y;
      b.x += b.vx * DT;
      b.y += b.vy * DT;
      b.ttl--;
      // 消滅間際は縮小していく (突然消えるのではなく減衰して消える演出。
      // 判定半径も同時に縮み、見た目と当たりが食い違わない)
      if (b.ttl < SHRINK_TICKS) {
        b.radius =
          b.radius0 *
          (SHRINK_FLOOR + (1 - SHRINK_FLOOR) * Math.max(b.ttl / SHRINK_TICKS, 0));
      }
      if (
        b.ttl <= 0 ||
        b.x < -CULL_BOUND || b.x > CULL_BOUND ||
        b.y < -CULL_BOUND || b.y > CULL_BOUND
      ) {
        this.kill(i);
        continue;
      }
      // 固定 tick ごとに移動区間と円を判定する。描画頻度に依存させず、
      // 高速弾のトンネリングと端末間の生死分岐を防ぐ。
      if (this.pathHitsObstacle(fromX, fromY, b.x, b.y, b.radius)) {
        this.kill(i);
      }
    }

    this.collide();
  }

  /** 現在位置の近傍セルだけを列挙する。正確な円判定は呼び出し側で行う。 */
  forEachNearby(
    x: number,
    y: number,
    radius: number,
    visit: (bullet: Bullet, index: number) => void,
  ): void {
    const extent = Math.max(radius, 0) + 0.9;
    const minX = Math.floor((x - extent) / CELL);
    const maxX = Math.floor((x + extent) / CELL);
    const minY = Math.floor((y - extent) / CELL);
    const maxY = Math.floor((y + extent) / CELL);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const cell = this.collisionGrid.get(this.cellKeyFromCoords(cx, cy));
        if (!cell) continue;
        for (const index of cell) {
          const bullet = this.bullets[index];
          if (bullet.alive) visit(bullet, index);
        }
      }
    }
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
    lifeSec = DEFAULT_BULLET_LIFE_SEC,
    inheritedVelocity: Vec2 = { x: 0, y: 0 },
  ): void {
    const mutationKey = this.bulletKey(fireId, spawnIdx);
    if (this.pendingKills.delete(mutationKey)) {
      this.pendingDamage.delete(mutationKey);
      return;
    }
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
    const vx = Math.cos(a) * spd + inheritedVelocity.x;
    const vy = Math.sin(a) * spd + inheritedVelocity.y;
    const pending = this.pendingDamage.get(mutationKey);
    const pendingDamage =
      pending && (!pending.owner || pending.owner === owner) ? pending.damage : 0;
    this.pendingDamage.delete(mutationKey);
    const radius0 = Math.min(Math.max(radius, 0.05), 0.9);
    // 受信遅延の追いつき再生では生成位置を一気に先へ進めるため、経過した
    // 各 tick の軌跡を検査し、過去に岩へ当たった弾を復活させない。
    if (advanceTicks > 0) {
      let fromX = x;
      let fromY = y;
      for (let step = 1; step <= advanceTicks; step++) {
        const toX = x + vx * DT * step;
        const toY = y + vy * DT * step;
        const remainingTtl = lifeTicks - step;
        const currentRadius = remainingTtl < SHRINK_TICKS
          ? radius0 * (
              SHRINK_FLOOR +
              (1 - SHRINK_FLOOR) * Math.max(remainingTtl / SHRINK_TICKS, 0)
            )
          : radius0;
        if (this.pathHitsObstacle(fromX, fromY, toX, toY, currentRadius)) return;
        fromX = toX;
        fromY = toY;
      }
    }
    const bullet: Bullet = {
      alive: true,
      x: x + vx * DT * advanceTicks,
      y: y + vy * DT * advanceTicks,
      vx,
      vy,
      dur: Math.min(Math.max(dur, 1), 1000) - pendingDamage,
      radius: radius0,
      radius0,
      owner,
      ttl,
      fireId,
      spawnIdx,
      born: this.tickCounter - advanceTicks,
    };
    if (bullet.dur <= 0) return;
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
    this.kill(index, 'hit');
  }

  /** 発射イベントID + 生成順で弾を特定して消す (他クライアントからの消滅通知) */
  killByFire(fireId: string, spawnIdx: number): void {
    if (!fireId) return;
    const bs = this.bullets;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (b.alive && b.spawnIdx === spawnIdx && b.fireId === fireId) {
        this.kill(i, 'hit');
        return;
      }
    }
    this.rememberPendingKill(fireId, spawnIdx);
  }

  /** 未生成でも保持できる、衝突による可換な耐久ダメージ。 */
  damageByFire(
    fireId: string,
    spawnIdx: number,
    damage: number,
    expectedOwner?: string,
  ): void {
    if (!fireId || !Number.isFinite(damage) || damage <= 0) return;
    const bs = this.bullets;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (b.alive && b.spawnIdx === spawnIdx && b.fireId === fireId) {
        if (expectedOwner && b.owner !== expectedOwner) return;
        b.dur -= damage;
        if (b.dur <= 0) this.kill(i, 'collide');
        return;
      }
    }
    const key = this.bulletKey(fireId, spawnIdx);
    const previous = this.pendingDamage.get(key);
    if (previous?.owner && expectedOwner && previous.owner !== expectedOwner) return;
    const old = previous?.damage ?? 0;
    this.pendingDamage.set(key, {
      damage: old + damage,
      expires: this.tickCounter + PENDING_MUTATION_TICKS,
      owner: expectedOwner ?? previous?.owner,
    });
    this.trimPendingMutations();
  }

  private kill(index: number, cause: KillCause = 'expire'): void {
    const b = this.bullets[index];
    if (!b.alive) return;
    b.alive = false;
    this.freeSlots.push(index);
    this.alive--;
    const n = (this.ownerCounts.get(b.owner) ?? 1) - 1;
    if (n <= 0) this.ownerCounts.delete(b.owner);
    else this.ownerCounts.set(b.owner, n);
    this.onKill?.(b, cause);
  }

  /** 移動区間が、弾半径を膨らませた障害物円へ触れるか。 */
  private pathHitsObstacle(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    bulletRadius: number,
  ): boolean {
    const vx = toX - fromX;
    const vy = toY - fromY;
    const len2 = vx * vx + vy * vy;
    for (const obstacle of this.obstacles) {
      const projection = len2 > 0
        ? Math.min(
            Math.max(
              ((obstacle.x - fromX) * vx + (obstacle.y - fromY) * vy) / len2,
              0,
            ),
            1,
          )
        : 0;
      const dx = fromX + vx * projection - obstacle.x;
      const dy = fromY + vy * projection - obstacle.y;
      const radius = obstacle.r + bulletRadius;
      if (dx * dx + dy * dy <= radius * radius) return true;
    }
    return false;
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
    if (oldestIdx >= 0) this.kill(oldestIdx, 'fifo');
  }

  /**
   * 弾同士の衝突。所有者が異なる弾同士が接触したら、衝突時点の耐久度を
   * 互いに減算し合い、0 以下になった弾は消滅する。
   */
  private collide(): void {
    const bs = this.bullets;
    const grid = this.collisionGrid;
    for (const cell of grid.values()) cell.length = 0;
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
          const cell = grid.get(this.cellKeyFromCoords(cx + ox, cy + oy));
          if (!cell) continue;
          for (const j of cell) {
            if (j <= i) continue;
            const b = bs[j];
            if (!b.alive || !a.alive) continue;
            if (a.owner === b.owner || this.areAllied?.(a.owner, b.owner)) continue;
            if (this.canResolveCollision && !this.canResolveCollision(a, b)) continue;
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const rr = a.radius + b.radius;
            if (dx * dx + dy * dy <= rr * rr) {
              const da = a.dur;
              const db = b.dur;
              a.dur -= db;
              b.dur -= da;
              this.onCollision?.(a, b, db, da);
              if (a.dur <= 0) this.kill(i, 'collide');
              if (b.dur <= 0) this.kill(j, 'collide');
            }
          }
          if (!a.alive) break;
        }
        if (!a.alive) break;
      }
    }
  }

  private bulletKey(fireId: string, spawnIdx: number): string {
    return `${fireId}\u0000${spawnIdx}`;
  }

  private rememberPendingKill(fireId: string, spawnIdx: number): void {
    this.pendingKills.set(
      this.bulletKey(fireId, spawnIdx),
      this.tickCounter + PENDING_MUTATION_TICKS,
    );
    this.trimPendingMutations();
  }

  private trimPendingMutations(): void {
    while (this.pendingKills.size + this.pendingDamage.size > PENDING_MUTATION_MAX) {
      // 消滅通知を優先し、まず累積ダメージの古い項目から間引く。
      const damageKey = this.pendingDamage.keys().next().value as string | undefined;
      if (damageKey !== undefined) this.pendingDamage.delete(damageKey);
      else {
        const killKey = this.pendingKills.keys().next().value as string | undefined;
        if (killKey === undefined) break;
        this.pendingKills.delete(killKey);
      }
    }
  }

  private cleanupPendingMutations(): void {
    for (const [key, expires] of this.pendingKills) {
      if (expires <= this.tickCounter) this.pendingKills.delete(key);
    }
    for (const [key, pending] of this.pendingDamage) {
      if (pending.expires <= this.tickCounter) this.pendingDamage.delete(key);
    }
  }

  private cellKey(x: number, y: number): number {
    return this.cellKeyFromCoords(Math.floor(x / CELL), Math.floor(y / CELL));
  }

  private cellKeyFromCoords(cx: number, cy: number): number {
    return (cx + 32768) * 65536 + (cy + 32768);
  }

  /** カスタムソースを含む構文木キャッシュ。長時間接続でも上限を超えて増やさない。 */
  private compile(source: string): Program {
    const cached = this.compiled.get(source);
    if (cached) {
      // Map の挿入順をLRUとして使う
      this.compiled.delete(source);
      this.compiled.set(source, cached);
      return cached;
    }
    const program = parse(source);
    this.compiled.set(source, program);
    if (this.compiled.size > COMPILED_CACHE_MAX) {
      const oldest = this.compiled.keys().next().value;
      if (oldest !== undefined) this.compiled.delete(oldest);
    }
    return program;
  }
}
