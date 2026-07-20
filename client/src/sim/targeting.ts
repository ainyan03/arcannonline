import type { Vec2 } from '../../../shared/src/protocol';

/**
 * ミサイルの標的割当て。優先度順の候補 (ボス→近い順を想定) へ
 * ラウンドロビンで配り、候補が足りなければ先頭 (最優先) へ重ねる。
 */
export function assignMissileTargets(
  candidates: readonly string[],
  count: number,
): string[] {
  if (candidates.length === 0) return [];
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.push(candidates[i % candidates.length]);
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
