import type { Vec2 } from '../../../shared/src/protocol';

/**
 * target が origin から見て heading の前半面にあるかを返す。
 * 真横は前方に含めず、向きとの角度が左右 90 度未満の場合だけ true。
 */
export function isInFront(origin: Vec2, heading: number, target: Vec2): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  return dx * Math.cos(heading) + dy * Math.sin(heading) > 0;
}
