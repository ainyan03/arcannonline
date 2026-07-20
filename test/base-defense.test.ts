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

  it('stays unlit after HP 0 until the gauge fully recovers', () => {
    const base = new BaseDefense();
    expect(base.lit(10_000)).toBe(true);
    base.apply(hit('a', 60, 10_000), 10_000);
    base.apply(hit('b', 60, 20_000), 20_000);
    expect(base.lit(20_000)).toBe(false);
    // 最初の命中が窓から抜けて HP 40 まで回復してもまだ消灯
    const partial = 10_000 + BASE_DAMAGE_WINDOW_MS;
    expect(base.hp(partial)).toBe(40);
    expect(base.lit(partial)).toBe(false);
    // 全快した瞬間に再点火する
    const full = 20_000 + BASE_DAMAGE_WINDOW_MS;
    expect(base.lit(full)).toBe(true);
  });

  it('does not flicker when HP oscillates around zero', () => {
    const base = new BaseDefense();
    expect(base.lit(10_000)).toBe(true);
    base.apply(hit('a', 100, 10_000), 10_000);
    expect(base.lit(10_000)).toBe(false);
    // 回復し切る直前に追撃されると消灯が続く
    base.apply(hit('b', 10, 10_000 + BASE_DAMAGE_WINDOW_MS - 100), 10_000 + BASE_DAMAGE_WINDOW_MS - 100);
    expect(base.lit(10_000 + BASE_DAMAGE_WINDOW_MS)).toBe(false);
  });

  it('a late joiner with partial damage assumes unlit until full recovery', () => {
    const joiner = new BaseDefense();
    joiner.merge([hit('a', 30, 50_000)], 50_000);
    expect(joiner.lit(50_000)).toBe(false);
    expect(joiner.lit(50_000 + BASE_DAMAGE_WINDOW_MS)).toBe(true);
  });
});
