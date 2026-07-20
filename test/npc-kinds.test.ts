import { describe, expect, it } from 'vitest';
import { LocalNpcSim } from '../client/src/sim/npc';
import { WAVE_COMPOSITION, WAVES_PER_ROUND } from '../client/src/sim/wave';
import { parseNpcStatePayload } from '../shared/src/validation';
import {
  NPC_KINDS,
  NPC_RESPAWN_MS,
  NPCS_PER_PEER,
  type NpcKind,
} from '../shared/src/protocol';

const OWNER = 'c'.repeat(64);

function baseState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `${OWNER}:npc:0`,
    seq: 1,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    h: 0,
    hp: 10,
    mode: 'chase',
    ts: 1,
    ...overrides,
  };
}

describe('WAVE_COMPOSITION', () => {
  it('has one composition per tier covering every slot', () => {
    expect(WAVE_COMPOSITION.length).toBe(WAVES_PER_ROUND);
    for (const kinds of WAVE_COMPOSITION) {
      expect(kinds.length).toBe(NPCS_PER_PEER);
      for (const kind of kinds) expect(NPC_KINDS[kind]).toBeDefined();
    }
  });
});

describe('LocalNpcSim kinds', () => {
  it('spawns with the given kind and its max HP', () => {
    const npc = new LocalNpcSim(`${OWNER}:npc:2`, 0, 'turret');
    expect(npc.kind).toBe('turret');
    expect(npc.hp).toBe(NPC_KINDS.turret.maxHp);
    expect(npc.makeState().k).toBe('turret');
  });

  it('switches kind on respawn according to the wave composition', () => {
    const npc = new LocalNpcSim(`${OWNER}:npc:3`, 0, 'wisp');
    npc.takeHit(999, 1_000);
    const kinds: NpcKind[] = ['wisp', 'wisp', 'wisp', 'shield'];
    npc.update(0.016, 1_000 + NPC_RESPAWN_MS + 1, [], {
      respawnPaused: false,
      aggression: 1,
      kinds,
    });
    expect(npc.kind).toBe('shield');
    expect(npc.hp).toBe(NPC_KINDS.shield.maxHp);
  });

  it('rusher explodes at close range and dies', () => {
    const npc = new LocalNpcSim(`${OWNER}:npc:1`, 0, 'rusher');
    // spawn 演出時間を過ぎるまで進める
    npc.update(0.016, 1_000, []);
    const attack = npc.update(0.016, 1_100, [
      { id: 'target', pos: { x: npc.pos.x + 1, y: npc.pos.y } },
    ]);
    expect(attack?.explode).toBe(true);
    expect(npc.alive).toBe(false);
  });

  it('rusher does not explode against a distant target', () => {
    const npc = new LocalNpcSim(`${OWNER}:npc:1`, 0, 'rusher');
    npc.update(0.016, 1_000, []);
    const attack = npc.update(0.016, 1_100, [
      { id: 'target', pos: { x: npc.pos.x + 50, y: npc.pos.y } },
    ]);
    expect(attack).toBeNull();
    expect(npc.alive).toBe(true);
  });
});

describe('parseNpcStatePayload kinds', () => {
  it('accepts a valid kind and per-kind hp cap', () => {
    expect(parseNpcStatePayload(baseState({ k: 'shield', hp: 64 }))?.k).toBe('shield');
    expect(parseNpcStatePayload(baseState({ k: 'turret', hp: 40 }))?.k).toBe('turret');
  });

  it('rejects hp above the cap for the declared kind', () => {
    expect(parseNpcStatePayload(baseState({ hp: 25 }))).toBeNull();
    expect(parseNpcStatePayload(baseState({ k: 'wisp', hp: 25 }))).toBeNull();
    expect(parseNpcStatePayload(baseState({ k: 'rusher', hp: 15 }))).toBeNull();
  });

  it('rejects unknown kinds and keeps omitted kind as wisp-compatible', () => {
    expect(parseNpcStatePayload(baseState({ k: 'dragon' }))).toBeNull();
    const parsed = parseNpcStatePayload(baseState());
    expect(parsed).not.toBeNull();
    expect(parsed?.k).toBeUndefined();
  });
});
