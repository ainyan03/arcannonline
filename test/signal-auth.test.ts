import { describe, expect, it } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  signalEnvelopeDigest,
  signSignalEnvelope,
  verifySignalEnvelope,
} from '../client/src/net/signal-auth';
import { parseSignalEnvelope } from '../shared/src/validation';
import type { SignalEnvelope } from '../shared/src/protocol';

const privkey = schnorr.utils.randomSecretKey();
const pubkey = bytesToHex(schnorr.getPublicKey(privkey));
const otherPubkey = bytesToHex(schnorr.getPublicKey(schnorr.utils.randomSecretKey()));

function makeEnvelope(): SignalEnvelope {
  return {
    id: 'env-1',
    from: pubkey,
    to: otherPubkey,
    payload: { kind: 'description', description: { type: 'offer', sdp: 'v=0' } },
  };
}

describe('signal-auth', () => {
  it('signs and verifies an envelope', () => {
    const env = makeEnvelope();
    env.sig = signSignalEnvelope(env, privkey);
    expect(verifySignalEnvelope(env)).toBe(true);
  });

  it('rejects an unsigned envelope', () => {
    expect(verifySignalEnvelope(makeEnvelope())).toBe(false);
  });

  it('rejects a tampered payload', () => {
    const env = makeEnvelope();
    env.sig = signSignalEnvelope(env, privkey);
    env.payload = { kind: 'description', description: { type: 'offer', sdp: 'v=1' } };
    expect(verifySignalEnvelope(env)).toBe(false);
  });

  it('rejects a spoofed sender (from を別ピアに差し替え)', () => {
    const env = makeEnvelope();
    env.sig = signSignalEnvelope(env, privkey);
    env.from = otherPubkey;
    expect(verifySignalEnvelope(env)).toBe(false);
  });

  it('digest is independent of JSON key order', () => {
    const env = makeEnvelope();
    const reordered = JSON.parse(
      JSON.stringify({ payload: env.payload, from: env.from, to: env.to, id: env.id }),
    ) as SignalEnvelope;
    expect(bytesToHex(signalEnvelopeDigest(reordered))).toBe(
      bytesToHex(signalEnvelopeDigest(env)),
    );
  });

  it('validation keeps a well-formed sig and rejects malformed ones', () => {
    const env = makeEnvelope();
    env.sig = signSignalEnvelope(env, privkey);
    const parsed = parseSignalEnvelope(JSON.parse(JSON.stringify(env)));
    expect(parsed?.sig).toBe(env.sig);
    expect(verifySignalEnvelope(parsed!)).toBe(true);

    expect(parseSignalEnvelope({ ...env, sig: 'zz' })).toBeNull();
    expect(parseSignalEnvelope({ ...env, sig: 123 })).toBeNull();
    // sig なしは旧クライアント互換のため受理される
    expect(parseSignalEnvelope({ ...env, sig: undefined })).not.toBeNull();
  });
});
