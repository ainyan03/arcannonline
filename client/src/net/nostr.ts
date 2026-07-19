// 最小の Nostr クライアント (NIP-01)。ブートストラップ専用:
// ルームトピックへの ephemeral イベントでプレゼンス通知とシグナリングを運ぶ。
// - イベントは secp256k1 (BIP340 schnorr) で署名され、pubkey がそのままピア ID になる
//   ため、シグナリングのなりすましがそのまま署名検証で弾かれる
// - ephemeral kind (20000-29999) はリレーに保存されず、現在の購読者へのみ配信される
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

const NOSTR_KIND = 20808; // ephemeral 範囲内の本アプリ固有値
const SUB_ID = 'arcn';
const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;
const SEEN_MAX = 2_000;

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export class NostrSignaling {
  /** 自分のピア ID (= schnorr 公開鍵 hex) */
  readonly pubkey: string;

  onMessage?: (fromPubkey: string, content: string) => void;
  /** リレー接続が (再) 確立した。プレゼンス再発行の契機に使う */
  onRelayOpen?: (url: string) => void;

  private readonly privkey: Uint8Array;
  private readonly sockets = new Map<string, WebSocket>();
  private readonly reconnectDelay = new Map<string, number>();
  private readonly seen = new Set<string>();
  private urls: string[] = [];
  private disposed = false;

  constructor(private readonly topic: string) {
    this.privkey = schnorr.utils.randomSecretKey();
    this.pubkey = bytesToHex(schnorr.getPublicKey(this.privkey));
  }

  connect(urls: string[]): void {
    this.urls = urls;
    for (const url of urls) this.open(url);
  }

  /** 切れているリレーへ即時再接続を試みる */
  reconnectNow(): void {
    for (const url of this.urls) {
      const ws = this.sockets.get(url);
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        this.reconnectDelay.delete(url);
        this.open(url);
      }
    }
  }

  publish(content: string): void {
    const created_at = Math.floor(Date.now() / 1000);
    const tags = [['t', this.topic]];
    const serialized = JSON.stringify([
      0,
      this.pubkey,
      created_at,
      NOSTR_KIND,
      tags,
      content,
    ]);
    const id = bytesToHex(sha256(utf8ToBytes(serialized)));
    const sig = bytesToHex(schnorr.sign(hexToBytes(id), this.privkey));
    const event: NostrEvent = {
      id,
      pubkey: this.pubkey,
      created_at,
      kind: NOSTR_KIND,
      tags,
      content,
      sig,
    };
    const msg = JSON.stringify(['EVENT', event]);
    for (const ws of this.sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  get status(): string {
    let open = 0;
    for (const ws of this.sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) open++;
    }
    return `${open}/${this.urls.length}`;
  }

  dispose(): void {
    this.disposed = true;
    for (const ws of this.sockets.values()) ws.close();
    this.sockets.clear();
  }

  private open(url: string): void {
    if (this.disposed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect(url);
      return;
    }
    this.sockets.set(url, ws);

    ws.onopen = () => {
      this.reconnectDelay.delete(url);
      // since は現在時刻: 一部リレーは ephemeral イベントも保存・リプレイする
      // ため、過去分を受けると死んだインスタンス (ゴースト) を発見してしまう
      ws.send(
        JSON.stringify([
          'REQ',
          SUB_ID,
          {
            kinds: [NOSTR_KIND],
            '#t': [this.topic],
            since: Math.floor(Date.now() / 1000),
          },
        ]),
      );
      this.onRelayOpen?.(url);
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as unknown[];
        if (msg[0] === 'EVENT' && msg[1] === SUB_ID) {
          this.handleEvent(msg[2] as NostrEvent);
        } else if (msg[0] === 'NOTICE') {
          console.warn(`[nostr] notice from ${url}:`, msg[1]);
        } else if (msg[0] === 'OK' && msg[2] === false) {
          console.warn(`[nostr] event rejected by ${url}:`, msg[3]);
        } else if (msg[0] === 'CLOSED') {
          console.warn(`[nostr] subscription closed by ${url}:`, msg[2]);
        }
      } catch {
        /* 不正なメッセージは無視 */
      }
    };
    ws.onclose = () => this.scheduleReconnect(url);
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect(url: string): void {
    if (this.disposed) return;
    const delay = this.reconnectDelay.get(url) ?? RECONNECT_BASE_MS;
    this.reconnectDelay.set(url, Math.min(delay * 2, RECONNECT_MAX_MS));
    setTimeout(() => {
      if (!this.disposed) this.open(url);
    }, delay);
  }

  private handleEvent(ev: NostrEvent): void {
    if (
      !ev ||
      ev.kind !== NOSTR_KIND ||
      typeof ev.id !== 'string' ||
      typeof ev.pubkey !== 'string' ||
      typeof ev.content !== 'string'
    ) {
      return;
    }
    if (ev.pubkey === this.pubkey) return; // 自分の発行分
    // リプレイされた古いイベントは捨てる (時計ずれの許容幅 60 秒)
    if (Math.abs(Date.now() / 1000 - ev.created_at) > 60) return;
    if (this.seen.has(ev.id)) return; // 複数リレーからの重複
    this.remember(ev.id);
    try {
      if (
        !schnorr.verify(
          hexToBytes(ev.sig),
          hexToBytes(ev.id),
          hexToBytes(ev.pubkey),
        )
      ) {
        return;
      }
    } catch {
      return;
    }
    this.onMessage?.(ev.pubkey, ev.content);
  }

  private remember(id: string): void {
    this.seen.add(id);
    if (this.seen.size > SEEN_MAX) {
      const it = this.seen.values();
      for (let i = 0; i < SEEN_MAX / 2; i++) {
        this.seen.delete(it.next().value as string);
      }
    }
  }
}
