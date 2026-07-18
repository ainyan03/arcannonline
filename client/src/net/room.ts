import { getRelaySockets, joinRoom, selfId } from 'trystero/nostr';
import {
  APP_ID,
  ROOM_NAME,
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
  onState?: (id: string, state: StatePayload) => void;

  private readonly room: ReturnType<typeof joinRoom>;
  private readonly sendState: (data: StatePayload) => void;
  private rxCount = 0;
  private txCount = 0;
  private txErrCount = 0;

  constructor() {
    this.room = joinRoom({ appId: APP_ID }, ROOM_NAME, {
      onJoinError: (err) =>
        console.error('[room] join error', JSON.stringify(err)),
    });

    const stateAction = this.room.makeAction<StatePayload>('state');
    this.sendState = (data) => {
      this.txCount++;
      stateAction.send(data).catch((err) => {
        // 切断直後の送信失敗は次の周期で再送されるが、頻度を観測できるようにする
        this.txErrCount++;
        if (this.txErrCount % 50 === 1) {
          console.warn('[room] state send failed', err);
        }
      });
    };
    stateAction.onMessage = (data, ctx) => {
      this.rxCount++;
      this.onState?.(ctx.peerId, data);
    };

    this.room.onPeerJoin = (peerId) => {
      console.debug(`[room] peer join ${peerId}`);
      this.onPeerJoin?.(peerId);
    };
    this.room.onPeerLeave = (peerId) => {
      console.debug(`[room] peer leave ${peerId}`);
      this.onPeerLeave?.(peerId);
    };
  }

  get peerCount(): number {
    return Object.keys(this.room.getPeers()).length;
  }

  /** 送受信の統計 (デバッグ用) */
  get stats(): string {
    return `tx: ${this.txCount} (err ${this.txErrCount}) rx: ${this.rxCount}`;
  }

  /** シグナリング用 Nostr リレーの接続状況 "open/total" */
  get relayStatus(): string {
    const sockets = Object.values(
      (getRelaySockets as () => Record<string, WebSocket>)(),
    );
    const open = sockets.filter((s) => s.readyState === WebSocket.OPEN).length;
    return `${open}/${sockets.length}`;
  }

  broadcastState(state: StatePayload): void {
    this.sendState(state);
  }

  leave(): void {
    void this.room.leave();
  }
}
