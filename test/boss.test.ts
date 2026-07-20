import { describe, expect, it } from 'vitest';
import { LocalNpcSim } from '../client/src/sim/npc';
import {
  SEGMENTS_PER_ROUND,
  WAVE_CYCLE_MS,
  WAVES_PER_ROUND,
  waveStateAt,
} from '../client/src/sim/wave';
import { parseNpcStatePayload } from '../shared/src/validation';
import {
  BOSS_NPC_SLOT,
  NPC_KINDS,
} from '../shared/src/protocol';
import {
  BOSS_SCRIPT_IDS,
  NPC_SCRIPT_SOURCES,
} from '../shared/src/npc-scripts';

const OWNER = 'a'.repeat(64);

describe('boss segment schedule', () => {
  it('the segment after wave 5 is the boss segment', () => {
    const bossStart = WAVE_CYCLE_MS * WAVES_PER_ROUND;
    const w = waveStateAt(bossStart);
    expect(w.boss).toBe(true);
    expect(w.phase).toBe('assault');
    // 次ラウンドの先頭は第1波へ戻る
    const next = waveStateAt(WAVE_CYCLE_MS * SEGMENTS_PER_ROUND);
    expect(next.boss).toBe(false);
    expect(next.number).toBe(1);
    expect(next.round).toBe(w.round + 1);
  });
});

describe('boss npc', () => {
  it('spawns on the outer ring with boss HP', () => {
    const boss = new LocalNpcSim(`${OWNER}:npc:${BOSS_NPC_SLOT}`, 0, 'boss');
    expect(boss.kind).toBe('boss');
    expect(boss.hp).toBe(NPC_KINDS.boss.maxHp);
    const dist = Math.hypot(boss.pos.x, boss.pos.y);
    expect(dist).toBeGreaterThanOrEqual(44);
    expect(boss.makeState().k).toBe('boss');
  });

  it('validates the boss slot and rejects beyond it', () => {
    const base = {
      id: `${OWNER}:npc:${BOSS_NPC_SLOT}`,
      seq: 1,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      h: 0,
      hp: NPC_KINDS.boss.maxHp,
      mode: 'chase',
      ts: 1,
      k: 'boss',
    };
    expect(parseNpcStatePayload(base)?.k).toBe('boss');
    expect(parseNpcStatePayload({ ...base, id: `${OWNER}:npc:9` })).toBeNull();
    // ボス HP は boss 種別でだけ受理される
    expect(parseNpcStatePayload({ ...base, k: 'wisp' })).toBeNull();
  });

  it('has replayable sources for every boss script', () => {
    for (const id of BOSS_SCRIPT_IDS) {
      expect(NPC_SCRIPT_SOURCES[id]).toBeTruthy();
    }
  });
});
