import { describe, expect, it } from 'vitest';
import {
  BASE_DAMAGE_WINDOW_MS,
  BASE_MAX_HP,
  type BaseHitEvent,
} from '../shared/src/protocol';
import { BaseDefense } from '../client/src/sim/base-defense';

const npc = `${'a'.repeat(64)}:npc:0`;

function hit(id: string, damage: number, at: number): BaseHitEvent {
  return { id, npc, damage, at };
}

describe('BaseDefense', () => {
  it('merges hit events idempotently', () => {
    const base = new BaseDefense();
    const event = hit('hit-1', 12, 10_000);
    expect(base.apply(event, 10_000)).toBe(true);
    expect(base.apply(event, 10_000)).toBe(false);
    expect(base.hp(10_000)).toBe(BASE_MAX_HP - 12);
  });

  it('recovers when damage leaves the rolling time window', () => {
    const base = new BaseDefense();
    base.apply(hit('hit-1', 30, 10_000), 10_000);
    expect(base.hp(10_000 + BASE_DAMAGE_WINDOW_MS - 1)).toBe(70);
    expect(base.hp(10_000 + BASE_DAMAGE_WINDOW_MS)).toBe(BASE_MAX_HP);
  });

  it('merges a late-join snapshot and rejects stale or future hits', () => {
    const base = new BaseDefense();
    expect(base.merge([
      hit('valid', 20, 50_000),
      hit('stale', 20, 50_000 - BASE_DAMAGE_WINDOW_MS),
      hit('future', 20, 70_001),
    ], 50_000)).toBe(1);
    expect(base.snapshot(50_000).map((event) => event.id)).toEqual(['valid']);
  });

  it('keeps enough bounded history for a late joiner to reproduce destruction', () => {
    const source = new BaseDefense();
    for (let i = 0; i < 400; i++) source.apply(hit(`hit-${i}`, 1, 10_000 + i), 10_500);
    const snapshot = source.snapshot(10_500);
    expect(snapshot).toHaveLength(256);
    const joining = new BaseDefense();
    joining.merge(snapshot, 10_500);
    expect(joining.hp(10_500)).toBe(0);
  });
});
