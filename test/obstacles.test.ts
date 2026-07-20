import { describe, expect, it } from 'vitest';
import {
  BASE_COLLIDER_RADIUS,
  OBSTACLES,
  isBlocked,
  resolveObstacles,
} from '../shared/src/obstacles';
import { FIELD_SIZE } from '../shared/src/protocol';
import { LocalPlayerSim } from '../client/src/sim/local-player';
import { LocalNpcSim } from '../client/src/sim/npc';

describe('obstacle placement', () => {
  const blockers = [{ x: 0, y: 0, r: BASE_COLLIDER_RADIUS }, ...OBSTACLES];

  it('stays inside the field bounds', () => {
    for (const o of OBSTACLES) {
      expect(Math.abs(o.x) + o.r).toBeLessThan(FIELD_SIZE / 2 - 4);
      expect(Math.abs(o.y) + o.r).toBeLessThan(FIELD_SIZE / 2 - 4);
    }
  });

  it('keeps a corridor of at least 4 between any two blockers', () => {
    for (let i = 0; i < blockers.length; i++) {
      for (let j = i + 1; j < blockers.length; j++) {
        const a = blockers[i];
        const b = blockers[j];
        const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
        expect(gap).toBeGreaterThanOrEqual(4);
      }
    }
  });
});

describe('resolveObstacles', () => {
  it('pushes a point out of a rock to its surface', () => {
    const o = OBSTACLES[0];
    const pos = { x: o.x + 0.5, y: o.y };
    expect(resolveObstacles(pos, 0.5)).toBe(true);
    const d = Math.hypot(pos.x - o.x, pos.y - o.y);
    expect(d).toBeCloseTo(o.r + 0.5, 5);
  });

  it('pushes out of the base collider', () => {
    const pos = { x: 1, y: 1 };
    expect(resolveObstacles(pos, 0.5)).toBe(true);
    expect(Math.hypot(pos.x, pos.y)).toBeCloseTo(BASE_COLLIDER_RADIUS + 0.5, 5);
  });

  it('leaves points outside untouched', () => {
    const pos = { x: 70, y: 70 };
    expect(resolveObstacles(pos, 0.5)).toBe(false);
    expect(pos).toEqual({ x: 70, y: 70 });
  });
});

describe('isBlocked', () => {
  it('detects the base collider and rocks with margin', () => {
    expect(isBlocked(0, 0, 0.5)).toBe(true);
    const o = OBSTACLES[0];
    expect(isBlocked(o.x, o.y, 0)).toBe(true);
    expect(isBlocked(o.x + o.r + 1.1, o.y, 1)).toBe(false);
  });
});

describe('movement collision', () => {
  it('player cannot enter a rock', () => {
    const o = OBSTACLES[0];
    const sim = new LocalPlayerSim({ x: o.x - o.r - 2, y: o.y }, 'test');
    for (let i = 0; i < 300; i++) {
      sim.update(1 / 60, { x: 1, y: 0 });
      const d = Math.hypot(sim.pos.x - o.x, sim.pos.y - o.y);
      expect(d).toBeGreaterThanOrEqual(o.r + 0.5 - 1e-6);
    }
  });

  it('npc gets pushed out of a rock', () => {
    const o = OBSTACLES[0];
    const npc = new LocalNpcSim('d'.repeat(64) + ':npc:0', 0);
    npc.pos.x = o.x;
    npc.pos.y = o.y + 0.1;
    npc.update(1 / 60, 2_000, []);
    const d = Math.hypot(npc.pos.x - o.x, npc.pos.y - o.y);
    expect(d).toBeGreaterThanOrEqual(o.r + 0.7 - 1e-6);
  });
});
