import type {
  P2PReliableMessage,
  P2PStateMessage,
  PeerInfo,
} from '../../../shared/src/protocol';
import { Peer } from './peer';
import type { SignalingClient } from './signaling';

/** 近傍の出入りに応じて Peer を生成・破棄し、状態送受信を束ねる。 */
export class PeerManager {
  onPeerOpen?: (info: PeerInfo) => void;
  onPeerClosed?: (id: string) => void;
  onRemoteState?: (id: string, msg: P2PStateMessage) => void;
  onRemoteReliable?: (id: string, msg: P2PReliableMessage) => void;

  private readonly peers = new Map<string, { peer: Peer; info: PeerInfo }>();

  constructor(private readonly signaling: SignalingClient) {
    signaling.onNeighborEnter = (info) => this.addPeer(info);
    signaling.onNeighborLeave = (id) => this.removePeer(id);
    signaling.onSignal = (from, payload) => {
      void this.peers.get(from)?.peer.handleSignal(payload);
    };
  }

  get openCount(): number {
    let n = 0;
    for (const { peer } of this.peers.values()) if (peer.isOpen) n++;
    return n;
  }

  get totalCount(): number {
    return this.peers.size;
  }

  broadcastState(msg: P2PStateMessage): void {
    for (const { peer } of this.peers.values()) peer.sendState(msg);
  }

  broadcastReliable(msg: P2PReliableMessage): void {
    for (const { peer } of this.peers.values()) peer.sendReliable(msg);
  }

  private addPeer(info: PeerInfo): void {
    if (this.peers.has(info.id)) return;
    const peer = new Peer(
      this.signaling.id,
      info.id,
      (to, payload) => this.signaling.sendSignal(to, payload),
      {
        onOpen: () => this.onPeerOpen?.(info),
        onClose: () => this.removePeer(info.id),
        onState: (msg) => this.onRemoteState?.(info.id, msg),
        onReliable: (msg) => this.onRemoteReliable?.(info.id, msg),
      },
    );
    this.peers.set(info.id, { peer, info });
  }

  private removePeer(id: string): void {
    const entry = this.peers.get(id);
    if (!entry) return;
    this.peers.delete(id);
    entry.peer.close();
    this.onPeerClosed?.(id);
  }
}
