import { describe, expect, it } from 'vitest';
import { NPC_MAX_HP, NPC_RESPAWN_MS } from '../shared/src/protocol';
import { NPC_FIRE_SCRIPT_SOURCE } from '../shared/src/npc-scripts';
import { BulletEngine } from '../client/src/sim/danmaku/engine';
import { LocalNpcSim } from '../client/src/sim/npc';

const id = `${'a'.repeat(64)}:npc:0`;

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
