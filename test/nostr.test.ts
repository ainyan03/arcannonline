import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import {
  computeNostrEventId,
  type NostrEvent,
  verifyNostrEvent,
} from '../client/src/net/nostr';

describe('Nostr event verification', () => {
  it('binds the signature to all event fields', () => {
    const secret = new Uint8Array(32);
    secret[31] = 1;
    const createdAt = 1_700_000_000;
    const event: NostrEvent = {
      id: '',
      pubkey: bytesToHex(schnorr.getPublicKey(secret)),
      created_at: createdAt,
      kind: 20808,
      tags: [['t', 'arcannonline/field-1']],
      content: '{"t":"presence"}',
      sig: '',
    };
    event.id = computeNostrEventId(event);
    event.sig = bytesToHex(schnorr.sign(hexToBytes(event.id), secret));

    expect(verifyNostrEvent(event, 'arcannonline/field-1', createdAt)).toBe(true);
    expect(verifyNostrEvent({ ...event, content: '{"t":"bye"}' }, 'arcannonline/field-1', createdAt)).toBe(false);
    expect(verifyNostrEvent(event, 'another-room', createdAt)).toBe(false);
    expect(verifyNostrEvent(event, 'arcannonline/field-1', createdAt + 61)).toBe(false);
  });

  it('rejects oversized tag structures before accepting signed relay input', () => {
    const secret = new Uint8Array(32);
    secret[31] = 2;
    const createdAt = 1_700_000_000;
    const event: NostrEvent = {
      id: '',
      pubkey: bytesToHex(schnorr.getPublicKey(secret)),
      created_at: createdAt,
      kind: 20808,
      tags: Array.from({ length: 9 }, () => ['t', 'arcannonline/field-1']),
      content: '{"t":"presence"}',
      sig: '',
    };
    event.id = computeNostrEventId(event);
    event.sig = bytesToHex(schnorr.sign(hexToBytes(event.id), secret));
    expect(verifyNostrEvent(event, 'arcannonline/field-1', createdAt)).toBe(false);
  });
});
