import { FIELD_SIZE, type Vec2 } from '../../../shared/src/protocol';

export interface MissileCandidate {
  id: string;
  /** 実効残りHP (飛行中ミサイルの予約ダメージを差し引いた値) */
  hp: number;
}

/**
 * ミサイルの標的割当て。近い順の候補へ「撃破に必要な発数」だけ割り当てる
 * (オーバーキル防止)。ボス優先はせず距離だけで決めるため、プレイヤーは
 * 撃ちたい相手へ自分から距離を詰めることで狙いをコントロールできる。
 * 必要数が count に満たなければ余りは撃たない (呼び出し側でコストも発数比例)。
 * @param candidates 近い順に並んだ候補 (hp <= 0 のものは含めないこと)
 */
export function planMissileVolley(
  candidates: readonly MissileCandidate[],
  count: number,
  damage: number,
): string[] {
  const result: string[] = [];
  for (const candidate of candidates) {
    if (result.length >= count) break;
    const need = Math.ceil(Math.max(candidate.hp, 1) / damage);
    for (let i = 0; i < need && result.length < count; i++) {
      result.push(candidate.id);
    }
  }
  return result;
}

/**
 * target が origin から見て heading の前半面にあるかを返す。
 * 真横は前方に含めず、向きとの角度が左右 90 度未満の場合だけ true。
 */
export function isInFront(origin: Vec2, heading: number, target: Vec2): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  return dx * Math.cos(heading) + dy * Math.sin(heading) > 0;
}

/**
 * ガーデンの設置点。敵がいなければ自機前方、いれば最も密集した集団の
 * 重心を選ぶ。単独の敵ならその位置へ直接置く。
 */
export function chooseGardenCenter(
  origin: Vec2,
  heading: number,
  enemies: readonly Vec2[],
  forwardOffset: number,
  searchRange: number,
  clusterRadius: number,
): Vec2 {
  const bound = FIELD_SIZE / 2 - clusterRadius;
  const anchor = {
    x: origin.x + Math.cos(heading) * forwardOffset,
    y: origin.y + Math.sin(heading) * forwardOffset,
  };
  const candidates = enemies.filter(
    (enemy) => Math.hypot(enemy.x - origin.x, enemy.y - origin.y) <= searchRange,
  );
  let center = anchor;
  let bestCount = 0;
  let bestAnchorDist = Infinity;
  for (const candidate of candidates) {
    const cluster = candidates.filter(
      (other) =>
        Math.hypot(other.x - candidate.x, other.y - candidate.y) <= clusterRadius,
    );
    const cx = cluster.reduce((sum, p) => sum + p.x, 0) / cluster.length;
    const cy = cluster.reduce((sum, p) => sum + p.y, 0) / cluster.length;
    const anchorDist = Math.hypot(cx - anchor.x, cy - anchor.y);
    if (
      cluster.length > bestCount ||
      (cluster.length === bestCount && anchorDist < bestAnchorDist)
    ) {
      bestCount = cluster.length;
      bestAnchorDist = anchorDist;
      center = { x: cx, y: cy };
    }
  }
  return {
    x: Math.min(Math.max(center.x, -bound), bound),
    y: Math.min(Math.max(center.y, -bound), bound),
  };
}
