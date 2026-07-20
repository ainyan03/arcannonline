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

/** 長押し時間をガーデンの照準距離へ変換する。 */
export function gardenAimDistance(
  elapsedMs: number,
  minDistance: number,
  maxDistance: number,
  chargeMs: number,
): number {
  const t = Math.min(Math.max(elapsedMs / chargeMs, 0), 1);
  return minDistance + (maxDistance - minDistance) * t;
}

/** 自機前方の指定距離をガーデンの設置点にし、効果範囲をフィールド内へ収める。 */
export function gardenAimCenter(
  origin: Vec2,
  heading: number,
  distance: number,
  radius: number,
): Vec2 {
  const bound = FIELD_SIZE / 2 - radius;
  return {
    x: Math.min(
      Math.max(origin.x + Math.cos(heading) * distance, -bound),
      bound,
    ),
    y: Math.min(
      Math.max(origin.y + Math.sin(heading) * distance, -bound),
      bound,
    ),
  };
}
