import {
  APP_ID,
  NOSTR_RELAYS,
  ROOM_NAME,
  type StatePayload,
} from '../../../shared/src/protocol';
import { Mesh } from './mesh';
import { NostrSignaling } from './nostr';

/**
 * ゲームルームのファサード。
 * ブートストラップ (Nostr) と P2P メッシュ (PEX 付き) を束ねる。
 */
export class GameRoom {
  readonly selfId: string;

  private readonly nostr: NostrSignaling;
  private readonly mesh: Mesh;

  constructor() {
    this.nostr = new NostrSignaling(`${APP_ID}/${ROOM_NAME}`);
    this.mesh = new Mesh(this.nostr);
    this.selfId = this.mesh.selfId;
    this.nostr.connect(NOSTR_RELAYS);
  }

  set onPeerJoin(fn: ((id: string) => void) | undefined) {
    this.mesh.onPeerOpen = fn;
  }

  set onPeerLeave(fn: ((id: string) => void) | undefined) {
    this.mesh.onPeerClose = fn;
  }

  set onState(fn: ((id: string, state: StatePayload) => void) | undefined) {
    this.mesh.onState = fn;
  }

  get peerCount(): number {
    return this.mesh.openCount;
  }

  /** ブートストラップ用 Nostr リレーの接続状況 "open/total" */
  get relayStatus(): string {
    return this.nostr.status;
  }

  /** 送受信の統計 (デバッグ用) */
  get stats(): string {
    return this.mesh.stats;
  }

  broadcastState(state: StatePayload): void {
    this.mesh.broadcastState(state);
  }

  /** 回復要求: リレー再接続とプレゼンス再発行 (ウォッチドッグから呼ばれる) */
  rejoin(): void {
    console.warn('[room] recover: reconnect relays + republish presence');
    this.nostr.reconnectNow();
    this.mesh.publishPresence(true);
  }

  leave(): void {
    this.mesh.leave();
    this.nostr.dispose();
  }
}
