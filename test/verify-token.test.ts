import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearJwksCacheForTest,
  verifyFirebaseToken,
} from '../client/src/auth/verify-token';

const PROJECT = 'arcannonline';
const NOW = 1_800_000_000;
const PEER_ID = 'a'.repeat(64);

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function makeKeys(kid = 'test-key') {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    privateKey: pair.privateKey,
    jwks: [{ kty: 'RSA', kid, n: jwk.n!, e: jwk.e! }],
  };
}

async function signToken(
  privateKey: CryptoKey,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'RS256', kid: 'test-key' },
): Promise<string> {
  const body = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(body),
  );
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

function validPayload(): Record<string, unknown> {
  return {
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: 'uid-123',
    iat: NOW - 60,
    exp: NOW + 3_000,
    name: `arcn:v1:${PEER_ID}:octocat`,
    picture: 'https://avatars.githubusercontent.com/u/583231?v=4',
    firebase: {
      sign_in_provider: 'github.com',
      identities: { 'github.com': ['583231'] },
    },
  };
}

describe('verifyFirebaseToken', () => {
  beforeEach(() => clearJwksCacheForTest());

  it('accepts a correctly signed token for this project', async () => {
    const { privateKey, jwks } = await makeKeys();
    const token = await signToken(privateKey, validPayload());
    const profile = await verifyFirebaseToken(
      token,
      PROJECT,
      PEER_ID,
      async () => jwks,
      NOW,
    );
    expect(profile).toEqual({
      uid: 'uid-123',
      name: 'octocat',
      picture: 'https://avatars.githubusercontent.com/u/583231?v=4',
      githubId: '583231',
      boundPeerId: PEER_ID,
      expiresAt: (NOW + 3_000) * 1000,
    });
  });

  it('rejects a tampered payload (signature mismatch)', async () => {
    const { privateKey, jwks } = await makeKeys();
    const token = await signToken(privateKey, validPayload());
    const [h, , s] = token.split('.');
    const forged = `${h}.${b64urlJson({ ...validPayload(), name: 'evil' })}.${s}`;
    expect(
      await verifyFirebaseToken(forged, PROJECT, PEER_ID, async () => jwks, NOW),
    ).toBeNull();
  });

  it('rejects a token signed by an unknown key', async () => {
    const signer = await makeKeys();
    const other = await makeKeys();
    const token = await signToken(signer.privateKey, validPayload());
    // JWKS には別鍵しかない (kid は一致するが公開鍵が異なる)
    expect(
      await verifyFirebaseToken(token, PROJECT, PEER_ID, async () => other.jwks, NOW),
    ).toBeNull();
  });

  it('rejects wrong audience / issuer / expired / future-issued tokens', async () => {
    const { privateKey, jwks } = await makeKeys();
    const cases: Record<string, unknown>[] = [
      { ...validPayload(), aud: 'other-project' },
      { ...validPayload(), iss: 'https://securetoken.google.com/other' },
      { ...validPayload(), exp: NOW - 1 },
      { ...validPayload(), iat: NOW + 3_600 },
      { ...validPayload(), sub: '' },
    ];
    for (const payload of cases) {
      const token = await signToken(privateKey, payload);
      expect(
        await verifyFirebaseToken(token, PROJECT, PEER_ID, async () => jwks, NOW),
      ).toBeNull();
    }
  });

  it('rejects non-RS256 algorithms (alg=none downgrade)', async () => {
    const { jwks } = await makeKeys();
    const body = `${b64urlJson({ alg: 'none', kid: 'test-key' })}.${b64urlJson(validPayload())}`;
    expect(
      await verifyFirebaseToken(`${body}.x`, PROJECT, PEER_ID, async () => jwks, NOW),
    ).toBeNull();
  });

  it('drops non-GitHub avatar URLs but keeps the verification result', async () => {
    const { privateKey, jwks } = await makeKeys();
    const token = await signToken(privateKey, {
      ...validPayload(),
      picture: 'https://evil.example.com/a.png',
    });
    const profile = await verifyFirebaseToken(
      token,
      PROJECT,
      PEER_ID,
      async () => jwks,
      NOW,
    );
    expect(profile?.uid).toBe('uid-123');
    expect(profile?.picture).toBeUndefined();
  });

  it('rejects a valid token replayed by a different peer', async () => {
    const { privateKey, jwks } = await makeKeys();
    const token = await signToken(privateKey, validPayload());
    expect(
      await verifyFirebaseToken(token, PROJECT, 'b'.repeat(64), async () => jwks, NOW),
    ).toBeNull();
  });

  it('requires an actual GitHub provider identity', async () => {
    const { privateKey, jwks } = await makeKeys();
    const token = await signToken(privateKey, {
      ...validPayload(),
      firebase: { sign_in_provider: 'password', identities: {} },
    });
    expect(
      await verifyFirebaseToken(token, PROJECT, PEER_ID, async () => jwks, NOW),
    ).toBeNull();
  });

  it('refreshes a still-fresh JWKS cache when a new kid appears', async () => {
    const oldKeys = await makeKeys('old-key');
    const newKeys = await makeKeys('new-key');
    const oldToken = await signToken(
      oldKeys.privateKey,
      validPayload(),
      { alg: 'RS256', kid: 'old-key' },
    );
    const newToken = await signToken(
      newKeys.privateKey,
      validPayload(),
      { alg: 'RS256', kid: 'new-key' },
    );
    let fetches = 0;
    const fetcher = async () => (++fetches === 1 ? oldKeys.jwks : newKeys.jwks);
    expect(
      await verifyFirebaseToken(oldToken, PROJECT, PEER_ID, fetcher, NOW),
    ).not.toBeNull();
    expect(
      await verifyFirebaseToken(newToken, PROJECT, PEER_ID, fetcher, NOW),
    ).not.toBeNull();
    expect(fetches).toBe(2);
  });
});
