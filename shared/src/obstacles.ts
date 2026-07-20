// フィールドの静的障害物 (円形コライダー)。
// 全クライアントが同じ定数を持つため同期は不要で、移動の衝突解決は
// 各クライアントがローカルに行う (自分の位置は自己申告、NPC は担当ピア権威)。
// 弾は障害物で消える。弾道は発射イベントから決定論的に再現されるため、
// 障害物との衝突も全クライアントで一致し、追加の同期メッセージは要らない。
import type { Vec2 } from './protocol';

export interface CircleObstacle {
  x: number;
  y: number;
  r: number;
}

/** 魔力灯の移動コライダー半径 (弾の拠点判定 BASE_HIT_RADIUS とは別) */
export const BASE_COLLIDER_RADIUS = 2.6;

/**
 * 岩の配置。拠点近くに近接戦用の遮蔽を2つ、中間リングに主戦場の遮蔽、
 * 外周に大岩を置く。通り道は最低でも幅6を確保し、直進 AI が
 * 押し出しスライドだけで迂回できるようにしている
 */
export const OBSTACLES: readonly CircleObstacle[] = [
  { x: 10, y: -7, r: 1.8 },
  { x: -9, y: 9, r: 1.6 },
  { x: 24, y: 14, r: 2.6 },
  { x: -22, y: -18, r: 2.8 },
  { x: -28, y: 20, r: 2.2 },
  { x: 30, y: -26, r: 3.2 },
  { x: 2, y: 34, r: 2.4 },
  { x: -4, y: -33, r: 2.0 },
  { x: 52, y: 8, r: 3.0 },
  { x: -50, y: -6, r: 2.6 },
  { x: 44, y: 44, r: 3.4 },
  { x: -46, y: 40, r: 3.0 },
];

/** 魔力灯コライダーを含む、移動を妨げる全ての円 */
const MOVE_BLOCKERS: readonly CircleObstacle[] = [
  { x: 0, y: 0, r: BASE_COLLIDER_RADIUS },
  ...OBSTACLES,
];

/**
 * pos を障害物 (魔力灯コライダー含む) の外へ押し出す。
 * 円同士の押し出しなので、壁面に沿ったスライド移動が自然に生まれる。
 * @returns 補正が入ったか
 */
export function resolveObstacles(pos: Vec2, radius: number): boolean {
  let pushed = false;
  for (const o of MOVE_BLOCKERS) {
    const dx = pos.x - o.x;
    const dy = pos.y - o.y;
    const min = o.r + radius;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2);
    if (d > 0.0001) {
      pos.x = o.x + (dx / d) * min;
      pos.y = o.y + (dy / d) * min;
    } else {
      // 中心に完全一致した場合の退避方向は +x に固定 (決定論)
      pos.x = o.x + min;
      pos.y = o.y;
    }
    pushed = true;
  }
  return pushed;
}

/** 点が障害物 (+margin) 内にあるか。スポーン位置や移動先の忌避に使う */
export function isBlocked(x: number, y: number, margin: number): boolean {
  for (const o of MOVE_BLOCKERS) {
    const dx = x - o.x;
    const dy = y - o.y;
    const min = o.r + margin;
    if (dx * dx + dy * dy < min * min) return true;
  }
  return false;
}

/**
 * from→to の射線が岩に遮られるか (魔力灯コライダーは含まない)。
 * 敵の発射判断用: 弾は岩で消えるため、遮られている間は撃っても無駄になる。
 * margin は弾半径ぶんの余裕 (小さめにして「岩の縁ぎりぎりは通る」を許す)
 */
export function lineOfFireBlocked(from: Vec2, to: Vec2, margin = 0.25): boolean {
  const vx = to.x - from.x;
  const vy = to.y - from.y;
  const len2 = vx * vx + vy * vy;
  for (const o of OBSTACLES) {
    const t = len2 > 0
      ? Math.min(Math.max(((o.x - from.x) * vx + (o.y - from.y) * vy) / len2, 0), 1)
      : 0;
    const dx = from.x + vx * t - o.x;
    const dy = from.y + vy * t - o.y;
    const r = o.r + margin;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

/**
 * 進行方向の先を塞ぐ障害物を避ける操舵。
 * 押し出し (resolveObstacles) だけだと、障害物の中心へ正面から向かう軌道で
 * 押し出しと速度が真逆になり接線成分が生まれず膠着する。そこで移動前に
 * 進路上の障害物を検知し、その接線方向へ進行方向を膨らませる。
 * 障害物が進路の左右どちらに寄っているかで回る向きを決め、
 * ちょうど正面の場合だけ preferredSide (呼び出し側の個体癖) で決める。
 * @param dir 単位ベクトルの進行方向
 * @param targetDist 目標までの距離。これより奥の障害物は進路を塞がないので
 *   無視する (岩を背にしたターゲットへ突撃できなくなるのを防ぐ)。
 *   目標が「地点」でない周回移動などでは Infinity を渡す
 * @returns 補正後の単位ベクトル (脅威がなければ dir をそのまま返す)
 */
export function steerAroundObstacles(
  pos: Vec2,
  dir: Vec2,
  radius: number,
  lookahead: number,
  preferredSide: 1 | -1,
  targetDist = Infinity,
): Vec2 {
  let bestThreat = 0;
  let steerX = 0;
  let steerY = 0;
  for (const o of MOVE_BLOCKERS) {
    const ax = o.x - pos.x;
    const ay = o.y - pos.y;
    // 後方や遠方、目標より奥の障害物は無視する
    const proj = ax * dir.x + ay * dir.y;
    if (proj <= 0) continue;
    if (proj - o.r > targetDist) continue;
    const dist = Math.hypot(ax, ay);
    if (dist - o.r - radius > lookahead) continue;
    // 進路 (半直線) から障害物中心までの符号付き横距離。正 = 左に寄っている
    const lat = dir.x * ay - dir.y * ax;
    const clearance = o.r + radius + 0.5;
    if (Math.abs(lat) >= clearance) continue;
    const threat = 1 - Math.abs(lat) / clearance;
    if (threat <= bestThreat) continue;
    bestThreat = threat;
    const side = lat > 0.05 ? -1 : lat < -0.05 ? 1 : preferredSide;
    // 障害物中心まわりの接線方向 (side>0 = 反時計回り)
    const inv = 1 / Math.max(dist, 0.0001);
    steerX = -ay * inv * side;
    steerY = ax * inv * side;
  }
  if (bestThreat <= 0) return dir;
  // 正面度に応じて接線へ寄せる。正面直撃でも前進成分を残し、円に沿って回る
  const outX = dir.x + steerX * bestThreat * 1.2;
  const outY = dir.y + steerY * bestThreat * 1.2;
  const inv = 1 / Math.max(Math.hypot(outX, outY), 0.0001);
  return { x: outX * inv, y: outY * inv };
}
