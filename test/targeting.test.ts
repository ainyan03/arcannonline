import { describe, expect, it } from 'vitest';
import { isInFront } from '../client/src/sim/targeting';

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
