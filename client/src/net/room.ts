import { joinRoom, selfId } from 'trystero/nostr';
import {
  APP_ID,
  ROOM_NAME,
  type ProfilePayload,
  type StatePayload,
} from '../../../shared/src/protocol';

/**
 * trystero ルームのラッパー。
 * シグナリングは公開 Nostr リレー経由で行われ、確立後は全ピアと P2P 直接通信になる。
 * 参加中の全ピアと自動的にメッシュ接続される（近傍による接続の取捨選択は今後の課題）。
 */
export class GameRoom {
  readonly selfId = selfId;

  onPeerJoin?: (id: string) => void;
  onPeerLeave?: (id: string) => void;
  onProfile?: (id: string, profile: ProfilePayload) => void;
  onState?: (id: string, state: StatePayload) => void;

  private readonly room: ReturnType<typeof joinRoom>;
  private readonly sendState: (data: StatePayload) => void;

  constructor(name: string) {
    this.room = joinRoom({ appId: APP_ID }, ROOM_NAME);

    const profileAction = this.room.makeAction<ProfilePayload>('profile');
    const stateAction = this.room.makeAction<StatePayload>('state');
    this.sendState = (data) => {
      stateAction.send(data).catch(() => {
        /* 切断直後の送信失敗は無視 */
      });
    };

    profileAction.onMessage = (data, ctx) => this.onProfile?.(ctx.peerId, data);
    stateAction.onMessage = (data, ctx) => this.onState?.(ctx.peerId, data);

    const profile: ProfilePayload = { name };
    this.room.onPeerJoin = (peerId) => {
      // 新規ピアへ自分のプロフィールを直接送る（相手側でも同様に送られてくる）
      profileAction.send(profile, { target: peerId }).catch(() => {});
      this.onPeerJoin?.(peerId);
    };
    this.room.onPeerLeave = (peerId) => this.onPeerLeave?.(peerId);
  }

  get peerCount(): number {
    return Object.keys(this.room.getPeers()).length;
  }

  broadcastState(state: StatePayload): void {
    this.sendState(state);
  }

  leave(): void {
    void this.room.leave();
  }
}
