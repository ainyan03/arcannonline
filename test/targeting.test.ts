import { describe, expect, it } from 'vitest';
import { isInFront, planMissileVolley } from '../client/src/sim/targeting';
import {
  MISSILE_SPEED,
  MISSILE_TRAVEL_MAX_MS,
  MISSILE_TRAVEL_MIN_MS,
  missileTravelMs,
} from '../shared/src/protocol';

describe('isInFront', () => {
  const origin = { x: 2, y: 3 };

  it('accepts targets within the forward half-plane', () => {
    expect(isInFront(origin, 0, { x: 12, y: 3 })).toBe(true);
    expect(isInFront(origin, 0, { x: 3, y: 13 })).toBe(true);
    expect(isInFront(origin, Math.PI / 2, { x: -8, y: 4 })).toBe(true);
  });

  it('rejects targets behind or exactly beside the player', () => {
    expect(isInFront(origin, 0, { x: -8, y: 3 })).toBe(false);
    expect(isInFront(origin, 0, { x: 2, y: 13 })).toBe(false);
    expect(isInFront(origin, 0, origin)).toBe(false);
  });
});

describe('missileTravelMs', () => {
  it('scales with distance at constant apparent speed and clamps', () => {
    expect(missileTravelMs(MISSILE_SPEED)).toBe(1000);
    expect(missileTravelMs(MISSILE_SPEED / 2)).toBe(500);
    expect(missileTravelMs(0)).toBe(MISSILE_TRAVEL_MIN_MS);
    expect(missileTravelMs(10_000)).toBe(MISSILE_TRAVEL_MAX_MS);
  });
});

describe('planMissileVolley', () => {
  it('assigns only what is needed to kill, nearest first (no overkill)', () => {
    // ウィスプ24×3体 → 1発ずつで計3発。余り3発は撃たない
    expect(
      planMissileVolley(
        [
          { id: 'w1', hp: 24 },
          { id: 'w2', hp: 24 },
          { id: 'w3', hp: 24 },
        ],
        6,
        24,
      ),
    ).toEqual(['w1', 'w2', 'w3']);
    // ゴーレム64 → 3発、続く近い敵へ残りを配る
    expect(
      planMissileVolley(
        [
          { id: 'golem', hp: 64 },
          { id: 'wisp', hp: 24 },
          { id: 'rusher', hp: 5 },
        ],
        6,
        24,
      ),
    ).toEqual(['golem', 'golem', 'golem', 'wisp', 'rusher']);
    // ボスでも距離順: 手前の大物へ全弾使い切る (上限 count)
    expect(planMissileVolley([{ id: 'boss', hp: 600 }], 6, 24)).toEqual([
      'boss', 'boss', 'boss', 'boss', 'boss', 'boss',
    ]);
    expect(planMissileVolley([], 6, 24)).toEqual([]);
  });
});
