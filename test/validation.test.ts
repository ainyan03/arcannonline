import { describe, expect, it } from 'vitest';
import { NPCS_PER_PEER } from '../shared/src/protocol';
import {
  parseAppearance,
  parseFireEvent,
  parseNostrContent,
  parseRealtimeMessage,
  parseReliableMessage,
  parseStatePayload,
} from '../shared/src/validation';

const peerId = 'a'.repeat(64);

describe('protocol validation', () => {
  it('accepts and normalizes a valid state', () => {
    expect(parseStatePayload({
      n: ' Alice ', seq: 1, x: 2, y: -3, vx: 4, vy: 0, h: 1,
      ts: 1_700_000_000_000, hp: 80, ap: { s: 1, c: '#AABBCC', a: 2 },
    })).toMatchObject({ n: 'Alice', ap: { s: 1, c: '#aabbcc', a: 2 } });
  });

  it('rejects non-finite and out-of-range state data', () => {
    expect(parseStatePayload({
      n: 'x', seq: 1, x: Number.NaN, y: 0, vx: 0, vy: 0, h: 0,
      ts: Date.now(), hp: 100,
    })).toBeNull();
    expect(parseAppearance({ s: 99, c: '#ffffff', a: 0 })).toBeUndefined();
  });

  it('bounds PEX and validates peer IDs', () => {
    expect(parseReliableMessage({ type: 'pex', peers: [peerId, peerId] }))
      .toEqual({ type: 'pex', peers: [peerId] });
    expect(parseReliableMessage({ type: 'pex', peers: ['not-a-key'] })).toBeNull();
    expect(parseReliableMessage({ type: 'pex', peers: Array(33).fill(peerId) })).toBeNull();
  });

  it('carries an optional protocol version in presence and PEX', () => {
    expect(parseNostrContent({ t: 'presence' })).toEqual({ t: 'presence' });
    expect(parseNostrContent({ t: 'presence', v: 2 }))
      .toMatchObject({ t: 'presence', v: 2 });
    expect(parseNostrContent({ t: 'presence', v: 0 })).toBeNull();
    expect(parseNostrContent({ t: 'presence', v: 1.5 })).toBeNull();
    expect(parseReliableMessage({ type: 'pex', peers: [peerId], v: 3 }))
      .toMatchObject({ type: 'pex', v: 3 });
    expect(parseReliableMessage({ type: 'pex', peers: [peerId], v: -1 }))
      .toBeNull();
  });

  it('requires a complete target position snapshot', () => {
    const base = {
      id: 'fire-1', script: 'ring', seed: 1, x: 0, y: 0, dir: 0,
      at: Date.now(), target: peerId,
    };
    expect(parseFireEvent({ ...base, tx: 2, ty: 3 })).toMatchObject({ tx: 2, ty: 3 });
    expect(parseFireEvent({ ...base, tx: 2 })).toBeNull();
    expect(parseFireEvent({ ...base, vx: 4, vy: -3 })).toMatchObject({
      vx: 4,
      vy: -3,
    });
    expect(parseFireEvent({ ...base, vx: 4 })).toBeNull();
    expect(parseFireEvent({ ...base, vx: 9, vy: 0 })).toBeNull();
    expect(parseFireEvent({
      ...base,
      target: `${peerId}:npc:0`,
      npc: `${peerId}:npc:1`,
      tx: 2,
      ty: 3,
    })).toMatchObject({ npc: `${peerId}:npc:1` });
  });

  it('validates a bounded NPC snapshot batch', () => {
    const npc = {
      id: `${peerId}:npc:0`, seq: 1, x: 4, y: 5, vx: 1, vy: 0,
      h: 0, hp: 24, mode: 'chase', ts: Date.now(),
    };
    expect(parseRealtimeMessage({ type: 'npcs', states: [npc] }))
      .toMatchObject({ type: 'npcs', states: [{ id: npc.id, mode: 'chase' }] });
    // 上限 (NPCS_PER_PEER) を超えるバッチは拒否する
    expect(
      parseRealtimeMessage({
        type: 'npcs',
        states: Array.from({ length: NPCS_PER_PEER + 1 }, () => npc),
      }),
    ).toBeNull();
    expect(parseRealtimeMessage({
      type: 'npcs', states: [{ ...npc, id: 'invalid:npc:0' }],
    })).toBeNull();
  });

  it('validates collision damage messages and bullet ownership', () => {
    const npcId = `${peerId}:npc:0`;
    const message = {
      type: 'bcoll',
      ev: {
        id: 'collision-1',
        a: { f: 'fire-a', i: 0, o: peerId },
        b: { f: 'fire-b', i: 2, o: npcId },
        da: 2,
        db: 1,
      },
    };
    expect(parseReliableMessage(message)).toMatchObject(message);
    expect(parseReliableMessage({
      ...message,
      ev: { ...message.ev, a: { ...message.ev.a, o: 'invalid' } },
    })).toBeNull();
  });

  it('validates base targets, hit events, and bounded late-join sync', () => {
    const npcId = `${peerId}:npc:0`;
    expect(parseFireEvent({
      id: 'fire-base', script: 'npc-wisp-burst', seed: 1,
      x: 10, y: 0, dir: Math.PI, at: Date.now(),
      target: 'arcane-beacon', tx: 0, ty: 0, npc: npcId,
    })).toMatchObject({ target: 'arcane-beacon' });
    const event = { id: 'base-hit-1', npc: npcId, damage: 1, at: Date.now() };
    expect(parseReliableMessage({ type: 'base-hit', ev: event }))
      .toEqual({ type: 'base-hit', ev: event });
    expect(parseReliableMessage({ type: 'base-sync', hits: [event] }))
      .toEqual({ type: 'base-sync', hits: [event] });
    expect(parseReliableMessage({ type: 'base-hit', ev: { ...event, npc: 'bad' } }))
      .toBeNull();
    expect(parseReliableMessage({ type: 'base-sync', hits: Array(257).fill(event) }))
      .toBeNull();
  });
});
