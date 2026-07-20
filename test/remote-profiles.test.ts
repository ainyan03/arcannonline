import { describe, expect, it } from 'vitest';
import { RemoteProfiles } from '../client/src/auth/remote-profiles';
import type { VerifiedProfile } from '../client/src/auth/verify-token';

const peerId = 'a'.repeat(64);

function profile(expiresAt: number): VerifiedProfile {
  return {
    uid: 'uid',
    name: 'octocat',
    githubId: '583231',
    boundPeerId: peerId,
    expiresAt,
  };
}

describe('RemoteProfiles', () => {
  it('drops stale async verification results and expires accepted profiles', async () => {
    const resolvers = new Map<
      string,
      (value: VerifiedProfile | null) => void
    >();
    const changes: Array<VerifiedProfile | null> = [];
    const profiles = new RemoteProfiles(
      (_id, value) => changes.push(value),
      (token) => new Promise((resolve) => resolvers.set(token, resolve)),
    );
    profiles.receive(peerId, 'old');
    profiles.receive(peerId, 'new');
    resolvers.get('old')?.(profile(2_000));
    await Promise.resolve();
    expect(changes).toEqual([]);
    resolvers.get('new')?.(profile(2_000));
    await Promise.resolve();
    expect(changes.at(-1)?.name).toBe('octocat');
    profiles.expire(2_001);
    expect(changes.at(-1)).toBeNull();
  });
});
