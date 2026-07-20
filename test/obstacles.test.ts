import { describe, expect, it } from 'vitest';
import {
  BASE_COLLIDER_RADIUS,
  OBSTACLES,
  isBlocked,
  resolveObstacles,
  steerAroundObstacles,
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

describe('steerAroundObstacles', () => {
  // 孤立した岩 (52, 8, r=3) を使う
  const rock = OBSTACLES[8];

  it('deflects a head-on course to the side', () => {
    const pos = { x: rock.x - 10, y: rock.y };
    const dir = steerAroundObstacles(pos, { x: 1, y: 0 }, 0.7, 8, 1);
    expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1, 5);
    expect(Math.abs(dir.y)).toBeGreaterThan(0.3);
    // preferredSide を反転すると逆側へ逸れる
    const dir2 = steerAroundObstacles(pos, { x: 1, y: 0 }, 0.7, 8, -1);
    expect(Math.sign(dir2.y)).toBe(-Math.sign(dir.y));
  });

  it('leaves clear courses untouched', () => {
    // 岩の後方を向いている
    const away = steerAroundObstacles(
      { x: rock.x - 10, y: rock.y },
      { x: -1, y: 0 },
      0.7,
      8,
      1,
    );
    expect(away).toEqual({ x: -1, y: 0 });
    // 岩が視程外
    const far = steerAroundObstacles({ x: 70, y: 70 }, { x: 1, y: 0 }, 0.7, 8, 1);
    expect(far).toEqual({ x: 1, y: 0 });
  });

  it('npc walks around a rock blocking the straight line to its target', () => {
    // 岩の中心を正面に捉える軌道: 押し出しだけだと接線成分が出ず膠着していた
    const npc = new LocalNpcSim('e'.repeat(64) + ':npc:0', 0);
    npc.pos.x = rock.x - 20;
    npc.pos.y = rock.y;
    const target = { id: 't', pos: { x: rock.x + 20, y: rock.y } };
    let now = 1_000;
    for (let i = 0; i < 60 * 20; i++) {
      now += 1000 / 60;
      npc.update(1 / 60, now, [target]);
    }
    const d = Math.hypot(npc.pos.x - target.pos.x, npc.pos.y - target.pos.y);
    expect(d).toBeLessThan(15);
  });
});

describe('stuck-recovery regressions', () => {
  const rock = OBSTACLES[8]; // (52, 8, r=3) 孤立した岩

  it('orbiting npc pinned against a rock keeps moving (orbit direction flips)', () => {
    // 周回円が岩にかかる配置: 岩の面に接した状態で至近の目標を周回させる
    const npc = new LocalNpcSim('a'.repeat(64) + ':npc:0', 0);
    npc.pos.x = rock.x - rock.r - 0.8;
    npc.pos.y = rock.y;
    const target = { id: 't', pos: { x: rock.x + 3.5, y: rock.y } };
    let now = 1_000;
    let travelled = 0;
    let prevX = npc.pos.x;
    let prevY = npc.pos.y;
    for (let i = 0; i < 60 * 12; i++) {
      now += 1000 / 60;
      npc.update(1 / 60, now, [target]);
      travelled += Math.hypot(npc.pos.x - prevX, npc.pos.y - prevY);
      prevX = npc.pos.x;
      prevY = npc.pos.y;
    }
    // 膠着すると小刻みな震えだけで移動量がほぼ 0 になる
    expect(travelled).toBeGreaterThan(10);
  });

  it('rusher explodes on a target standing in front of a rock', () => {
    // 目標より奥の岩を避けようとして、目標ごと迂回してしまう回帰の検証
    const npc = new LocalNpcSim('b'.repeat(64) + ':npc:1', 0, 'rusher');
    npc.pos.x = rock.x - 17;
    npc.pos.y = rock.y;
    const target = { id: '2'.repeat(64), pos: { x: rock.x - rock.r - 1.5, y: rock.y } };
    let exploded = false;
    let now = 1_000;
    for (let i = 0; i < 60 * 5; i++) {
      now += 1000 / 60;
      const attack = npc.update(1 / 60, now, [target]);
      if (attack?.explode) {
        exploded = true;
        break;
      }
    }
    expect(exploded).toBe(true);
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
