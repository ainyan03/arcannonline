import { describe, expect, it } from 'vitest';
import {
  SEGMENTS_PER_ROUND,
  WAVE_ASSAULT_MS,
  WAVE_CALM_MS,
  WAVE_CYCLE_MS,
  WAVES_PER_ROUND,
  correctedRoomNow,
  waveAggression,
  waveStateAt,
} from '../client/src/sim/wave';
import { LocalNpcSim } from '../client/src/sim/npc';
import { NPC_MAX_HP, NPC_RESPAWN_MS } from '../shared/src/protocol';

describe('waveStateAt', () => {
  it('starts each cycle in the assault phase', () => {
    const t = WAVE_CYCLE_MS * 7;
    const w = waveStateAt(t);
    expect(w.index).toBe(7);
    expect(w.phase).toBe('assault');
    expect(w.phaseEndsAt).toBe(t + WAVE_ASSAULT_MS);
  });

  it('switches to calm after the assault window', () => {
    const cycleStart = WAVE_CYCLE_MS * 7;
    expect(waveStateAt(cycleStart + WAVE_ASSAULT_MS - 1).phase).toBe('assault');
    const calm = waveStateAt(cycleStart + WAVE_ASSAULT_MS);
    expect(calm.phase).toBe('calm');
    expect(calm.phaseEndsAt).toBe(cycleStart + WAVE_CYCLE_MS);
    expect(calm.phaseEndsAt - (cycleStart + WAVE_ASSAULT_MS)).toBe(WAVE_CALM_MS);
  });

  it('cycles waves 1..WAVES_PER_ROUND then a boss segment each round', () => {
    for (let i = 0; i < SEGMENTS_PER_ROUND * 2; i++) {
      const w = waveStateAt(WAVE_CYCLE_MS * i);
      const segment = i % SEGMENTS_PER_ROUND;
      if (segment < WAVES_PER_ROUND) {
        expect(w.boss).toBe(false);
        expect(w.number).toBe(segment + 1);
        expect(w.tier).toBe(segment);
      } else {
        expect(w.boss).toBe(true);
        expect(w.tier).toBe(WAVES_PER_ROUND - 1);
      }
      expect(w.round).toBe(Math.floor(i / SEGMENTS_PER_ROUND));
    }
  });

  it('is identical for all clients at the same wall clock', () => {
    const t = 1_770_000_123_456;
    expect(waveStateAt(t)).toEqual(waveStateAt(t));
  });
});

describe('waveAggression', () => {
  it('increases monotonically with tier', () => {
    expect(waveAggression(0)).toBe(1);
    for (let d = 1; d < WAVES_PER_ROUND; d++) {
      expect(waveAggression(d)).toBeGreaterThan(waveAggression(d - 1));
    }
  });
});

describe('correctedRoomNow', () => {
  it('makes two skewed clients converge on the same midpoint clock', () => {
    const actual = 1_000_000;
    const a = correctedRoomNow(actual, [-30_000]);
    const b = correctedRoomNow(actual + 30_000, [30_000]);
    expect(a).toBe(b);
  });

  it('resists one extreme clock when the majority is near local time', () => {
    expect(correctedRoomNow(1_000_000, [20, -60_000])).toBe(1_000_000);
  });
});

describe('LocalNpcSim wave respawn gating', () => {
  it('does not respawn while calm, respawns when the next wave starts', () => {
    const npc = new LocalNpcSim('a'.repeat(64) + ':npc:0', 0);
    npc.takeHit(NPC_MAX_HP, 1_000);
    expect(npc.alive).toBe(false);

    const after = 1_000 + NPC_RESPAWN_MS + 1;
    npc.update(0.016, after, [], { respawnPaused: true, aggression: 1 });
    expect(npc.alive).toBe(false);

    npc.update(0.016, after + 16, [], { respawnPaused: false, aggression: 1 });
    expect(npc.alive).toBe(true);
  });

  it('keeps the legacy always-respawn behavior when no wave mod is given', () => {
    const npc = new LocalNpcSim('b'.repeat(64) + ':npc:1', 0);
    npc.takeHit(NPC_MAX_HP, 1_000);
    npc.update(0.016, 1_000 + NPC_RESPAWN_MS + 1, []);
    expect(npc.alive).toBe(true);
  });
});
