import { describe, expect, it } from 'vitest';
import {
  parseAppearance,
  parseFireEvent,
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

  it('requires a complete target position snapshot', () => {
    const base = {
      id: 'fire-1', script: 'ring', seed: 1, x: 0, y: 0, dir: 0,
      at: Date.now(), target: peerId,
    };
    expect(parseFireEvent({ ...base, tx: 2, ty: 3 })).toMatchObject({ tx: 2, ty: 3 });
    expect(parseFireEvent({ ...base, tx: 2 })).toBeNull();
  });
});
