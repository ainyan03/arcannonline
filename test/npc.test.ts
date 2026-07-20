import { describe, expect, it } from 'vitest';
import {
  NPC_MAX_HP,
  NPC_RESPAWN_MS,
  type NpcStatePayload,
} from '../shared/src/protocol';
import { NPC_FIRE_SCRIPT_SOURCE } from '../shared/src/npc-scripts';
import { BulletEngine } from '../client/src/sim/danmaku/engine';
import { LocalNpcSim, RemoteNpcSim } from '../client/src/sim/npc';

const id = `${'a'.repeat(64)}:npc:0`;

function snap(seq: number, t: number, x: number, vx: number): NpcStatePayload {
  return { id, seq, x, y: 0, vx, vy: 0, h: 0, hp: NPC_MAX_HP, mode: 'wander', ts: t };
}

describe('LocalNpcSim', () => {
  it('uses a valid deterministic danmaku script', () => {
    const engine = new BulletEngine();
    expect(engine.estimateCost(
      NPC_FIRE_SCRIPT_SOURCE,
      1,
      0,
      () => ({ x: 0, y: 0 }),
      () => ({ x: 10, y: 0 }),
    )).toBeGreaterThan(0);
  });

  it('spawns deterministically from its globally unique ID', () => {
    const a = new LocalNpcSim(id, 0);
    const b = new LocalNpcSim(id, 0);
    expect(a.pos).toEqual(b.pos);
    expect(a.hp).toBe(NPC_MAX_HP);
  });

  it('chases a nearby target and eventually requests an attack', () => {
    const npc = new LocalNpcSim(id, 0);
    let attacked = false;
    for (let now = 1_000; now < 8_000; now += 100) {
      const attack = npc.update(0.1, now, [{
        id: 'player',
        pos: { x: npc.pos.x + 8, y: npc.pos.y },
      }]);
      attacked ||= attack !== null;
    }
    expect(attacked).toBe(true);
  });

  it('interpolates between 5Hz snapshots at the delayed render time', () => {
    const sim = new RemoteNpcSim(id, 0);
    // 等速 5 units/s で移動するスナップショット列 (200ms 間隔)
    sim.push(snap(0, 0, 0, 5), 0);
    sim.push(snap(1, 200, 1, 5), 200);
    sim.push(snap(2, 400, 2, 5), 400);
    // renderTime = 380 - 280 = 100ms → t=0 と t=200 の中間 (速度一定なので厳密に 0.5)
    const s = sim.sample(380);
    expect(s.visible).toBe(true);
    expect(s.x).toBeCloseTo(0.5, 5);
    expect(s.y).toBeCloseTo(0, 5);
  });

  it('extrapolates briefly with velocity while the buffer is dry', () => {
    const sim = new RemoteNpcSim(id, 0);
    sim.push(snap(0, 0, 0, 5), 0);
    // renderTime = 100ms 先だが次のスナップショット未着 → 速度外挿で 0.5
    expect(sim.sample(380).x).toBeCloseTo(0.5, 5);
    // 長時間未着でも外挿は 200ms で頭打ち (どこまでも滑っていかない)
    expect(sim.sample(2_000).x).toBeCloseTo(1.0, 5);
  });

  it('dies and respawns after the fixed delay', () => {
    const npc = new LocalNpcSim(id, 0);
    expect(npc.takeHit(NPC_MAX_HP, 1_000)).toBe(true);
    expect(npc.alive).toBe(false);
    npc.update(0.1, 1_000 + NPC_RESPAWN_MS - 1, []);
    expect(npc.alive).toBe(false);
    npc.update(0.1, 1_000 + NPC_RESPAWN_MS, []);
    expect(npc.alive).toBe(true);
    expect(npc.hp).toBe(NPC_MAX_HP);
  });
});
