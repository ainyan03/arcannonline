// P2P メッシュ管理。
// - Nostr のプレゼンスで発見したピア、および PEX (既知ピア一覧の交換) で
//   知ったピアと WebRTC 接続を張る
// - シグナリングは「Nostr リレー経由」と「確立済みメッシュでの中継」の二重送信。
//   封筒 (SignalEnvelope) の id で重複排除するため、どちらが先に届いてもよい。
//   これによりリレーへの依存は事実上「最初の1本の接続確立」だけになる
// - 封筒には送信元ピア鍵の schnorr 署名を付け、経路自体に署名がない
//   メッシュ中継分は封筒署名の検証を通ったものだけを配送・転送する
import {
  CONNECT_TIMEOUT_MS,
  MAX_PEERS,
  PEX_INTERVAL_MS,
  PRESENCE_INTERVAL_MS,
  PROTO_VERSION,
  STALE_PRESENCE_MS,
  type BaseHitEvent,
  type ChatLogEntry,
  type GardenEvent,
  type MissileEvent,
  type NovaEvent,
  type FireEvent,
  type BulletCollisionEvent,
  type NostrContent,
  type NpcStatePayload,
  type ReliableMessage,
  type SignalEnvelope,
  type StatePayload,
} from '../../../shared/src/protocol';
import type { NostrSignaling } from './nostr';
import { parseNostrContent } from '../../../shared/src/validation';
import { signalEnvelopeDigest, verifySignalEnvelope } from './signal-auth';
import { Peer } from './peer';
import {
  MAX_CONNECTING_PEERS,
  selectPexDialCandidates,
} from './admission';
import { FireBatchQueue, supportsFireBatch } from './fire-batch';

/**
 * 他ピアへ申告するプロトコルバージョン。開発ビルド (vite dev) は申告しない:
 * 未公開の版数を本番クライアントへ見せると、まだ配信されていない更新への
 * バナーが出てしまう (v は省略可能な advisory フィールド)
 */
const ADVERTISED_PROTO_VERSION: number | undefined = import.meta.env.DEV
  ? undefined
  : PROTO_VERSION;

const ENV_SEEN_MAX = 2_000;
/** プレゼンス即時応答のレート制限 */
const PRESENCE_REPLY_MIN_MS = 2_000;
/** メッシュ中継封筒の署名検証回数の上限 (検証CPUを浪費させる攻撃の抑止) */
const MAX_ENV_VERIFY_PER_SEC = 256;
/** 通常弾をこの時間だけ貯めてReliableメッセージ数を削減する。 */
const FIRE_BATCH_INTERVAL_MS = 250;

interface PeerEntry {
  peer: Peer;
  /** 一度でも開通したか (切断イベントの発火判定用)。開通中かは peer.isOpen が正 */
  everOpen: boolean;
  /** 相手が PEX で申告した「直接接続中のピア」一覧 */
  known: Set<string>;
  /** このピアへまだ送っていない通常弾。接続後に作られたイベントだけを保持する。 */
  fireBatch: FireBatchQueue;
}

export class Mesh {
  readonly selfId: string;

  onPeerOpen?: (id: string) => void;
  onPeerClose?: (id: string) => void;
  onState?: (id: string, state: StatePayload) => void;
  onNpcs?: (id: string, states: NpcStatePayload[]) => void;
  onFire?: (id: string, ev: FireEvent) => void;
  /** 追尾ミサイル (発射時ロック・必中) の発射通知 */
  onMissiles?: (id: string, ev: MissileEvent) => void;
  /** スターノヴァ (敵弾一掃 + ノックバック衝撃波) の発動通知 */
  onNova?: (id: string, ev: NovaEvent) => void;
  /** ブルームガーデン (持続フィールド + 最終開花) の発動通知 */
  onGarden?: (id: string, ev: GardenEvent) => void;
  onChat?: (id: string, text: string, msgId?: string, at?: number) => void;
  /** 途中参加時に既存ピアから届く直近チャット履歴 */
  onChatLog?: (id: string, entries: ChatLogEntry[]) => void;
  onBulletKill?: (fireId: string, spawnIdx: number) => void;
  onBulletCollision?: (id: string, ev: BulletCollisionEvent) => void;
  onBaseHit?: (id: string, ev: BaseHitEvent) => void;
  onBaseSync?: (
    id: string,
    hits: BaseHitEvent[],
    lit?: boolean,
    sentAt?: number,
  ) => void;
  /** GitHub 認証済みプロフィール (Firebase ID トークン) の申告 */
  onProfile?: (id: string, token: string | null) => void;
  /** ピアが申告したプロトコルバージョン (プレゼンス/PEX 受信のたびに発火) */
  onPeerVersion?: (id: string, version: number) => void;

  private readonly peers = new Map<string, PeerEntry>();
  private readonly presenceSeen = new Map<string, number>();
  private readonly envSeen = new Set<string>();
  private readonly peerVersions = new Map<string, number>();
  private lastPresenceSentAt = 0;
  private envVerifyWindowAt = 0;
  private envVerifyChecks = 0;
  private txCount = 0;
  private rxCount = 0;
  private relayedCount = 0;
  private readonly intervalIds: number[];
  private left = false;

  constructor(private readonly nostr: NostrSignaling) {
    this.selfId = nostr.pubkey;
    nostr.onMessage = (from, content) => this.handleNostr(from, content);
    nostr.onRelayOpen = () => this.publishPresence(true);

    this.intervalIds = [
      window.setInterval(() => this.publishPresence(false), PRESENCE_INTERVAL_MS),
      window.setInterval(() => this.sendPex(), PEX_INTERVAL_MS),
      window.setInterval(() => this.cleanup(), 5_000),
      window.setInterval(() => this.flushFireBatches(), FIRE_BATCH_INTERVAL_MS),
    ];
  }

  get openCount(): number {
    let n = 0;
    for (const e of this.peers.values()) if (e.peer.isOpen) n++;
    return n;
  }

  get stats(): string {
    let reliableDropped = 0;
    for (const e of this.peers.values()) {
      reliableDropped += e.peer.reliableDroppedCount;
    }
    return (
      `tx: ${this.txCount} rx: ${this.rxCount}` +
      ` link: ${this.openCount}/${this.peers.size}` +
      (this.relayedCount > 0 ? ` relayed: ${this.relayedCount}` : '') +
      (reliableDropped > 0 ? ` reliable-drop: ${reliableDropped}` : '')
    );
  }

  broadcastState(state: StatePayload): void {
    this.txCount++;
    for (const e of this.peers.values()) {
      if (e.peer.isOpen) e.peer.sendState(state);
    }
  }

  broadcastNpcs(states: NpcStatePayload[]): void {
    this.txCount++;
    for (const e of this.peers.values()) {
      if (e.peer.isOpen) e.peer.sendNpcs(states);
    }
  }

  broadcastFire(ev: FireEvent): void {
    for (const e of this.peers.values()) {
      if (!e.peer.isOpen) continue;
      // 先に発生した通常弾とのReliable順序を保ってから即時弾を送る。
      this.flushEntryFireBatch(e);
      e.peer.sendReliable({ type: 'fire', ev });
    }
  }

  /**
   * 通常弾だけをピア単位で短時間バッチ化する。旧版・版数不明ピアには従来の
   * fire を送り、プロトコル移行中も弾が見えなくならないようにする。
   */
  broadcastAutoFire(ev: FireEvent): void {
    for (const [id, entry] of this.peers) {
      if (!entry.peer.isOpen) continue;
      if (!supportsFireBatch(this.peerVersions.get(id))) {
        entry.peer.sendReliable({ type: 'fire', ev });
        continue;
      }
      const full = entry.fireBatch.push(ev);
      if (full) entry.peer.sendReliable({ type: 'fires', events: full });
    }
  }

  broadcastMissiles(ev: MissileEvent): void {
    for (const e of this.peers.values()) {
      if (e.peer.isOpen) e.peer.sendReliable({ type: 'missiles', ev });
    }
  }

  broadcastNova(ev: NovaEvent): void {
    for (const e of this.peers.values()) {
      if (e.peer.isOpen) e.peer.sendReliable({ type: 'nova', ev });
    }
  }

  broadcastGarden(ev: GardenEvent): void {
    for (const e of this.peers.values()) {
      if (e.peer.isOpen) e.peer.sendReliable({ type: 'garden', ev });
    }
  }

  broadcastChat(text: string, id?: string, at?: number): void {
    for (const e of this.peers.values()) {
      if (e.peer.isOpen) e.peer.sendReliable({ type: 'chat', text, id, at });
    }
  }

  /** 直近チャット履歴を特定ピアだけへ送る (新規開通時の引き継ぎ用) */
  sendChatLogTo(id: string, entries: ChatLogEntry[]): void {
    if (entries.length === 0) return;
    const e = this.peers.get(id);
    if (e?.peer.isOpen) e.peer.sendReliable({ type: 'chat-log', entries });
  }

  broadcastBulletKill(fireId: string, spawnIdx: number): void {
    for (const e of this.peers.values()) {
      if (e.peer.isOpen) {
        e.peer.sendReliable({ type: 'bkill', f: fireId, i: spawnIdx });
      }
    }
  }

  broadcastBulletCollision(ev: BulletCollisionEvent): void {
    for (const e of this.peers.values()) {
      if (e.peer.isOpen) e.peer.sendReliable({ type: 'bcoll', ev });
    }
  }

  broadcastBaseHit(ev: BaseHitEvent): void {
    for (const e of this.peers.values()) {
      if (e.peer.isOpen) e.peer.sendReliable({ type: 'base-hit', ev });
    }
  }

  /** 拠点の命中履歴を特定ピアだけへ送る (新規開通時の初期同期用) */
  sendBaseSyncTo(id: string, hits: BaseHitEvent[], lit: boolean): void {
    const e = this.peers.get(id);
    if (e?.peer.isOpen) {
      e.peer.sendReliable({ type: 'base-sync', hits, lit, at: Date.now() });
    }
  }

  broadcastProfile(token: string): void {
    for (const e of this.peers.values()) {
      if (e.peer.isOpen) e.peer.sendReliable({ type: 'profile', token });
    }
  }

  broadcastProfileClear(): void {
    for (const e of this.peers.values()) {
      if (e.peer.isOpen) e.peer.sendReliable({ type: 'profile-clear' });
    }
  }

  /** 在室を再通知する (ウォッチドッグからの回復要求にも使う) */
  publishPresence(force: boolean): void {
    if (this.left) return;
    const now = performance.now();
    if (!force && now - this.lastPresenceSentAt < PRESENCE_REPLY_MIN_MS) return;
    this.lastPresenceSentAt = now;
    this.publish({ t: 'presence', v: ADVERTISED_PROTO_VERSION });
  }

  /** 退室を通知し、全接続を閉じる */
  leave(): void {
    if (this.left) return;
    this.left = true;
    this.flushFireBatches();
    this.publish({ t: 'bye' });
    for (const id of this.intervalIds) window.clearInterval(id);
    for (const [id, e] of this.peers) {
      e.peer.close();
      this.peers.delete(id);
    }
  }

  // -------------------------------------------------------------------------

  private publish(content: NostrContent): void {
    this.nostr.publish(JSON.stringify(content));
  }

  private handleNostr(from: string, contentStr: string): void {
    let content: NostrContent | null;
    try {
      content = parseNostrContent(JSON.parse(contentStr));
    } catch {
      return;
    }
    if (!content) return;
    switch (content.t) {
      case 'presence':
        if (content.v !== undefined) this.notePeerVersion(from, content.v);
        this.notePeer(from);
        break;
      case 'bye':
        this.dropPeer(from, 'bye');
        this.presenceSeen.delete(from);
        this.peerVersions.delete(from);
        break;
      case 'signal':
        if (content.env.to === this.selfId && content.env.from === from) {
          this.deliver(content.env);
        }
        break;
    }
  }

  /** ピアの存在を認知する (プレゼンス受信・PEX・シグナル受信のすべてが契機) */
  private notePeer(id: string, allowConnect = true): boolean {
    if (id === this.selfId) return false;
    const isNew = !this.presenceSeen.has(id);
    this.presenceSeen.set(id, performance.now());
    let created = false;
    if (
      allowConnect &&
      !this.peers.has(id) &&
      this.peers.size < MAX_PEERS &&
      this.connectingCount() < MAX_CONNECTING_PEERS
    ) {
      this.createPeer(id);
      created = true;
    }
    if (isNew) {
      // 相手がこちらをまだ知らない可能性があるため即時に在室を返す
      this.publishPresence(false);
    }
    return created;
  }

  private createPeer(id: string): void {
    console.debug(`[mesh] connect -> ${id.slice(0, 8)}`);
    const entry: PeerEntry = {
      everOpen: false,
      known: new Set(),
      fireBatch: new FireBatchQueue(),
      peer: new Peer(
        this.selfId,
        id,
        (payload) =>
          this.sendSignal({
            id: crypto.randomUUID(),
            to: id,
            from: this.selfId,
            payload,
          }),
        {
          onOpen: () => {
            entry.everOpen = true;
            console.debug(`[mesh] open <-> ${id.slice(0, 8)}`);
            this.sendPexTo(entry);
            this.onPeerOpen?.(id);
          },
          onClose: () => this.dropPeer(id, 'closed'),
          onState: (state) => {
            this.rxCount++;
            this.presenceSeen.set(id, performance.now());
            this.onState?.(id, state);
          },
          onNpcs: (states) => {
            this.rxCount++;
            this.presenceSeen.set(id, performance.now());
            this.onNpcs?.(id, states);
          },
          onReliable: (msg) => this.handleReliable(id, msg),
        },
      ),
    };
    this.peers.set(id, entry);
  }

  private dropPeer(id: string, reason: string): void {
    const entry = this.peers.get(id);
    if (!entry) return;
    console.debug(`[mesh] drop ${id.slice(0, 8)} (${reason})`);
    this.peers.delete(id);
    entry.peer.close();
    if (entry.everOpen) this.onPeerClose?.(id);
  }

  // --- シグナリング -----------------------------------------------------------

  private sendSignal(env: SignalEnvelope): void {
    // メッシュ中継の受信側が送信元を検証できるよう封筒に署名する
    // (Nostr 経路しか通らない場合も付けたままで害はない)
    env.sig = this.nostr.signDigest(signalEnvelopeDigest(env));
    this.rememberEnv(env.id);
    // 経路1: Nostr リレー
    this.publish({ t: 'signal', env });
    // 経路2: 宛先と直接繋がっているピア経由の中継 (最大2経路)
    let relayed = 0;
    for (const e of this.peers.values()) {
      if (relayed >= 2) break;
      if (e.peer.isOpen && e.known.has(env.to)) {
        e.peer.sendReliable({ type: 'sig', env });
        relayed++;
      }
    }
  }

  private deliver(env: SignalEnvelope): void {
    if (this.envSeen.has(env.id)) return;
    this.rememberEnv(env.id);
    this.notePeer(env.from);
    const entry = this.peers.get(env.from);
    if (entry) void entry.peer.handleSignal(env.payload);
  }

  private handleReliable(fromId: string, msg: ReliableMessage): void {
    switch (msg.type) {
      case 'pex': {
        if (msg.v !== undefined) this.notePeerVersion(fromId, msg.v);
        const entry = this.peers.get(fromId);
        if (entry) entry.known = new Set(msg.peers);
        // PEX による発見: リレーに頼らず新しいピアを知る
        const selected = selectPexDialCandidates(
          msg.peers,
          this.selfId,
          new Set(this.peers.keys()),
          this.peers.size,
          this.connectingCount(),
          MAX_PEERS,
        );
        for (const id of msg.peers) {
          this.notePeer(id, selected.has(id));
        }
        break;
      }
      case 'sig': {
        const env = msg.env;
        // メッシュ中継はリレーと違い経路に署名がなく from を詐称できるため、
        // 封筒の署名が from の鍵によるものだと確認できたときだけ扱う。
        // 検証失敗時に id を記憶しない: 偽署名で本物の封筒 id を先に
        // 潰される (重複扱いで破棄される) のを防ぐ
        if (this.envSeen.has(env.id)) break;
        if (!this.allowEnvVerify() || !verifySignalEnvelope(env)) break;
        if (env.to === this.selfId) {
          this.deliver(env);
        } else {
          // 宛先と直接繋がっていれば1ホップだけ中継する
          this.rememberEnv(env.id);
          const target = this.peers.get(env.to);
          if (target?.peer.isOpen) {
            target.peer.sendReliable(msg);
            this.relayedCount++;
          }
        }
        break;
      }
      case 'fire':
        this.onFire?.(fromId, msg.ev);
        break;
      case 'fires':
        for (const event of msg.events) this.onFire?.(fromId, event);
        break;
      case 'missiles':
        this.onMissiles?.(fromId, msg.ev);
        break;
      case 'nova':
        this.onNova?.(fromId, msg.ev);
        break;
      case 'garden':
        this.onGarden?.(fromId, msg.ev);
        break;
      case 'bkill':
        this.onBulletKill?.(String(msg.f), Number(msg.i));
        break;
      case 'bcoll':
        this.onBulletCollision?.(fromId, msg.ev);
        break;
      case 'base-hit':
        this.onBaseHit?.(fromId, msg.ev);
        break;
      case 'base-sync':
        this.onBaseSync?.(fromId, msg.hits, msg.lit, msg.at);
        break;
      case 'chat':
        this.onChat?.(fromId, String(msg.text).slice(0, 200), msg.id, msg.at);
        break;
      case 'chat-log':
        this.onChatLog?.(fromId, msg.entries);
        break;
      case 'profile':
        this.onProfile?.(fromId, msg.token);
        break;
      case 'profile-clear':
        this.onProfile?.(fromId, null);
        break;
    }
  }

  // --- 定期処理 ---------------------------------------------------------------

  private sendPex(): void {
    for (const e of this.peers.values()) {
      if (e.peer.isOpen) this.sendPexTo(e);
    }
  }

  private flushFireBatches(): void {
    for (const entry of this.peers.values()) {
      this.flushEntryFireBatch(entry);
    }
  }

  private flushEntryFireBatch(entry: PeerEntry): void {
    if (!entry.peer.isOpen || entry.fireBatch.size === 0) return;
    entry.peer.sendReliable({ type: 'fires', events: entry.fireBatch.drain() });
  }

  private notePeerVersion(id: string, version: number): void {
    this.peerVersions.set(id, version);
    this.onPeerVersion?.(id, version);
  }

  private sendPexTo(entry: PeerEntry): void {
    const openIds: string[] = [];
    for (const [id, e] of this.peers) {
      if (e.peer.isOpen) openIds.push(id);
    }
    entry.peer.sendReliable({
      type: 'pex',
      peers: openIds,
      v: ADVERTISED_PROTO_VERSION,
    });
  }

  private cleanup(): void {
    const now = performance.now();
    for (const [id, e] of this.peers) {
      // 確立しないまま時間切れ → 作り直し (次のプレゼンス/PEX で再試行される)
      if (!e.peer.isOpen && now - e.peer.createdAt > CONNECT_TIMEOUT_MS) {
        this.dropPeer(id, 'connect timeout');
        continue;
      }
      // プレゼンスも state も長時間なし → 居なくなったとみなす
      const seen = this.presenceSeen.get(id) ?? 0;
      if (now - seen > STALE_PRESENCE_MS) {
        this.dropPeer(id, 'stale');
        this.presenceSeen.delete(id);
        this.peerVersions.delete(id);
      }
    }
    for (const [id, t] of this.presenceSeen) {
      if (now - t > STALE_PRESENCE_MS) {
        this.presenceSeen.delete(id);
        // 申告バージョンも居なくなったピアの分は忘れる (再接続時に再学習される)
        this.peerVersions.delete(id);
      }
    }
  }

  private connectingCount(): number {
    let count = 0;
    for (const entry of this.peers.values()) {
      if (!entry.peer.isOpen) count++;
    }
    return count;
  }

  /** 中継封筒の署名検証の実行可否 (1秒窓のレート制限) */
  private allowEnvVerify(): boolean {
    const now = performance.now();
    if (now - this.envVerifyWindowAt >= 1_000) {
      this.envVerifyWindowAt = now;
      this.envVerifyChecks = 0;
    }
    if (this.envVerifyChecks >= MAX_ENV_VERIFY_PER_SEC) return false;
    this.envVerifyChecks++;
    return true;
  }

  private rememberEnv(id: string): void {
    this.envSeen.add(id);
    if (this.envSeen.size > ENV_SEEN_MAX) {
      const it = this.envSeen.values();
      for (let i = 0; i < ENV_SEEN_MAX / 2; i++) {
        this.envSeen.delete(it.next().value as string);
      }
    }
  }
}
