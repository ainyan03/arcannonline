import {
  APP_ID,
  NOSTR_RELAYS,
  ROOM_NAME,
  type BaseHitEvent,
  type BulletCollisionEvent,
  type FireEvent,
  type NpcStatePayload,
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
  private left = false;

  /** @param privkey 永続アカウント用の鍵。省略時は使い捨て (bot 等) */
  constructor(privkey?: Uint8Array) {
    this.nostr = new NostrSignaling(`${APP_ID}/${ROOM_NAME}`, privkey);
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

  set onNpcs(
    fn: ((id: string, states: NpcStatePayload[]) => void) | undefined,
  ) {
    this.mesh.onNpcs = fn;
  }

  set onFire(fn: ((id: string, ev: FireEvent) => void) | undefined) {
    this.mesh.onFire = fn;
  }

  set onChat(fn: ((id: string, text: string) => void) | undefined) {
    this.mesh.onChat = fn;
  }

  set onBulletKill(
    fn: ((fireId: string, spawnIdx: number) => void) | undefined,
  ) {
    this.mesh.onBulletKill = fn;
  }

  set onBulletCollision(
    fn: ((id: string, ev: BulletCollisionEvent) => void) | undefined,
  ) {
    this.mesh.onBulletCollision = fn;
  }

  set onBaseHit(fn: ((id: string, ev: BaseHitEvent) => void) | undefined) {
    this.mesh.onBaseHit = fn;
  }

  set onBaseSync(
    fn: ((id: string, hits: BaseHitEvent[]) => void) | undefined,
  ) {
    this.mesh.onBaseSync = fn;
  }

  /** ピアが申告したプロトコルバージョンの通知 (更新案内バナーの契機) */
  set onPeerVersion(fn: ((id: string, version: number) => void) | undefined) {
    this.mesh.onPeerVersion = fn;
  }

  /** GitHub 認証済みプロフィール (Firebase ID トークン) の申告 */
  set onProfile(fn: ((id: string, token: string | null) => void) | undefined) {
    this.mesh.onProfile = fn;
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

  broadcastNpcs(states: NpcStatePayload[]): void {
    this.mesh.broadcastNpcs(states);
  }

  broadcastFire(ev: FireEvent): void {
    this.mesh.broadcastFire(ev);
  }

  broadcastChat(text: string): void {
    this.mesh.broadcastChat(text);
  }

  broadcastBulletKill(fireId: string, spawnIdx: number): void {
    this.mesh.broadcastBulletKill(fireId, spawnIdx);
  }

  broadcastBulletCollision(ev: BulletCollisionEvent): void {
    this.mesh.broadcastBulletCollision(ev);
  }

  broadcastBaseHit(ev: BaseHitEvent): void {
    this.mesh.broadcastBaseHit(ev);
  }

  /** 拠点の命中履歴を特定ピアだけへ送る (新規開通時の初期同期用) */
  sendBaseSyncTo(id: string, hits: BaseHitEvent[]): void {
    this.mesh.sendBaseSyncTo(id, hits);
  }

  broadcastProfile(token: string): void {
    this.mesh.broadcastProfile(token);
  }

  broadcastProfileClear(): void {
    this.mesh.broadcastProfileClear();
  }

  /** 回復要求: リレー再接続とプレゼンス再発行 (ウォッチドッグから呼ばれる) */
  rejoin(): void {
    console.warn('[room] recover: reconnect relays + republish presence');
    this.nostr.reconnectNow();
    this.mesh.publishPresence(true);
  }

  leave(): void {
    if (this.left) return;
    this.left = true;
    this.mesh.leave();
    this.nostr.dispose();
  }
}
