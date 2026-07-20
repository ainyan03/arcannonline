import { FIREBASE_PROJECT_ID } from './firebase-config';
import {
  verifyFirebaseToken,
  type VerifiedProfile,
} from './verify-token';

type ProfileVerifier = (
  token: string,
  peerId: string,
) => Promise<VerifiedProfile | null>;

/** リモート認証プロフィールの検証、競合排除、期限切れを一箇所で管理する。 */
export class RemoteProfiles {
  private readonly tokenByPeer = new Map<string, string>();
  private readonly verified = new Map<string, VerifiedProfile>();

  constructor(
    private readonly onChange: (
      peerId: string,
      profile: VerifiedProfile | null,
    ) => void,
    private readonly verify: ProfileVerifier = (token, peerId) =>
      verifyFirebaseToken(token, FIREBASE_PROJECT_ID, peerId),
  ) {}

  get(peerId: string): VerifiedProfile | undefined {
    return this.verified.get(peerId);
  }

  receive(peerId: string, token: string | null): void {
    if (token === null) {
      this.remove(peerId);
      return;
    }
    if (this.tokenByPeer.get(peerId) === token) return;
    this.tokenByPeer.set(peerId, token);
    void this.verify(token, peerId)
      .then((profile) => {
        if (this.tokenByPeer.get(peerId) !== token) return;
        if (!profile) {
          this.clearVerified(peerId);
          return;
        }
        this.verified.set(peerId, profile);
        this.onChange(peerId, profile);
      })
      .catch(() => {
        if (this.tokenByPeer.get(peerId) === token) this.clearVerified(peerId);
      });
  }

  expire(now = Date.now()): void {
    for (const [peerId, profile] of this.verified) {
      if (profile.expiresAt <= now) this.remove(peerId);
    }
  }

  remove(peerId: string): void {
    this.tokenByPeer.delete(peerId);
    this.clearVerified(peerId);
  }

  private clearVerified(peerId: string): void {
    if (!this.verified.delete(peerId)) return;
    this.onChange(peerId, null);
  }
}
