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
