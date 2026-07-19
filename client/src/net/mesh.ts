// P2P メッシュ管理。
// - Nostr のプレゼンスで発見したピア、および PEX (既知ピア一覧の交換) で
//   知ったピアと WebRTC 接続を張る
// - シグナリングは「Nostr リレー経由」と「確立済みメッシュでの中継」の二重送信。
//   封筒 (SignalEnvelope) の id で重複排除するため、どちらが先に届いてもよい。
//   これによりリレーへの依存は事実上「最初の1本の接続確立」だけになる
import {
  CONNECT_TIMEOUT_MS,
  MAX_PEERS,
  PEX_INTERVAL_MS,
  PRESENCE_INTERVAL_MS,
  PROTO_VERSION,
  STALE_PRESENCE_MS,
  type FireEvent,
  type NostrContent,
  type NpcStatePayload,
  type ReliableMessage,
  type SignalEnvelope,
  type StatePayload,
} from '../../../shared/src/protocol';
import type { NostrSignaling } from './nostr';
import { parseNostrContent } from '../../../shared/src/validation';
import { Peer } from './peer';

const ENV_SEEN_MAX = 2_000;
/** プレゼンス即時応答のレート制限 */
const PRESENCE_REPLY_MIN_MS = 2_000;

interface PeerEntry {
  peer: Peer;
  /** 一度でも開通したか (切断イベントの発火判定用)。開通中かは peer.isOpen が正 */
  everOpen: boolean;
  /** 相手が PEX で申告した「直接接続中のピア」一覧 */
  known: Set<string>;
}

export class Mesh {
  readonly selfId: string;

  onPeerOpen?: (id: string) => void;
  onPeerClose?: (id: string) => void;
  onState?: (id: string, state: StatePayload) => void;
  onNpcs?: (id: string, states: NpcStatePayload[]) => void;
  onFire?: (id: string, ev: FireEvent) => void;
  onChat?: (id: string, text: string) => void;
  onBulletKill?: (fireId: string, spawnIdx: number) => void;
  /** ピアが申告したプロトコルバージョン (プレゼンス/PEX 受信のたびに発火) */
  onPeerVersion?: (id: string, version: number) => void;

  private readonly peers = new Map<string, PeerEntry>();
  private readonly presenceSeen = new Map<string, number>();
  private readonly envSeen = new Set<string>();
  private lastPresenceSentAt = 0;
  private txCount = 0;
  private rxCount = 0;
  private relayedCount = 0;

  constructor(private readonly nostr: NostrSignaling) {
    this.selfId = nostr.pubkey;
    nostr.onMessage = (from, content) => this.handleNostr(from, content);
    nostr.onRelayOpen = () => this.publishPresence(true);

    window.setInterval(() => this.publishPresence(false), PRESENCE_INTERVAL_MS);
    window.setInterval(() => this.sendPex(), PEX_INTERVAL_MS);
    window.setInterval(() => this.cleanup(), 5_000);
  }

  get openCount(): number {
    let n = 0;
    for (const e of this.peers.values()) if (e.peer.isOpen) n++;
    return n;
  }

  get stats(): string {
    return (
      `tx: ${this.txCount} rx: ${this.rxCount}` +
      ` link: ${this.openCount}/${this.peers.size}` +
      (this.relayedCount > 0 ? ` relayed: ${this.relayedCount}` : '')
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
      if (e.peer.isOpen) e.peer.sendReliable({ type: 'fire', ev });
    }
  }

  broadcastChat(text: string): void {
    for (const e of this.peers.values()) {
      if (e.peer.isOpen) e.peer.sendReliable({ type: 'chat', text });
    }
  }

  broadcastBulletKill(fireId: string, spawnIdx: number): void {
    for (const e of this.peers.values()) {
      if (e.peer.isOpen) {
        e.peer.sendReliable({ type: 'bkill', f: fireId, i: spawnIdx });
      }
    }
  }

  /** 在室を再通知する (ウォッチドッグからの回復要求にも使う) */
  publishPresence(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastPresenceSentAt < PRESENCE_REPLY_MIN_MS) return;
    this.lastPresenceSentAt = now;
    this.publish({ t: 'presence', v: PROTO_VERSION });
  }

  /** 退室を通知し、全接続を閉じる */
  leave(): void {
    this.publish({ t: 'bye' });
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
        if (content.v !== undefined) this.onPeerVersion?.(from, content.v);
        this.notePeer(from);
        break;
      case 'bye':
        this.dropPeer(from, 'bye');
        this.presenceSeen.delete(from);
        break;
      case 'signal':
        if (content.env.to === this.selfId && content.env.from === from) {
          this.deliver(content.env);
        }
        break;
    }
  }

  /** ピアの存在を認知する (プレゼンス受信・PEX・シグナル受信のすべてが契機) */
  private notePeer(id: string): void {
    if (id === this.selfId) return;
    const isNew = !this.presenceSeen.has(id);
    this.presenceSeen.set(id, performance.now());
    if (!this.peers.has(id) && this.peers.size < MAX_PEERS) {
      this.createPeer(id);
    }
    if (isNew) {
      // 相手がこちらをまだ知らない可能性があるため即時に在室を返す
      this.publishPresence(false);
    }
  }

  private createPeer(id: string): void {
    console.debug(`[mesh] connect -> ${id.slice(0, 8)}`);
    const entry: PeerEntry = {
      everOpen: false,
      known: new Set(),
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
        if (msg.v !== undefined) this.onPeerVersion?.(fromId, msg.v);
        const entry = this.peers.get(fromId);
        if (entry) entry.known = new Set(msg.peers);
        // PEX による発見: リレーに頼らず新しいピアを知る
        for (const id of msg.peers) this.notePeer(id);
        break;
      }
      case 'sig': {
        const env = msg.env;
        if (env.to === this.selfId) {
          this.deliver(env);
        } else if (!this.envSeen.has(env.id)) {
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
      case 'bkill':
        this.onBulletKill?.(String(msg.f), Number(msg.i));
        break;
      case 'chat':
        this.onChat?.(fromId, String(msg.text).slice(0, 200));
        break;
    }
  }

  // --- 定期処理 ---------------------------------------------------------------

  private sendPex(): void {
    for (const e of this.peers.values()) {
      if (e.peer.isOpen) this.sendPexTo(e);
    }
  }

  private sendPexTo(entry: PeerEntry): void {
    const openIds: string[] = [];
    for (const [id, e] of this.peers) {
      if (e.peer.isOpen) openIds.push(id);
    }
    entry.peer.sendReliable({ type: 'pex', peers: openIds, v: PROTO_VERSION });
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
      }
    }
    for (const [id, t] of this.presenceSeen) {
      if (now - t > STALE_PRESENCE_MS) this.presenceSeen.delete(id);
    }
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
