import type {
  P2PReliableMessage,
  P2PStateMessage,
  SignalPayload,
} from '../../../shared/src/protocol';

export interface PeerEvents {
  /** state チャネルが開通した */
  onOpen: () => void;
  /** 接続が失敗・切断された（相手側都合含む） */
  onClose: () => void;
  onState: (msg: P2PStateMessage) => void;
  onReliable: (msg: P2PReliableMessage) => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

/**
 * 1 対向との WebRTC 接続。perfect negotiation パターンで glare を解消する。
 * データチャネルは negotiated 固定 ID で両側同時生成:
 *   id=0 state:    非信頼・非順序 (位置同期)
 *   id=1 reliable: 信頼 (チャット・発射イベント予定)
 */
export class Peer {
  private readonly pc: RTCPeerConnection;
  private readonly stateCh: RTCDataChannel;
  private readonly reliableCh: RTCDataChannel;
  private readonly polite: boolean;
  private makingOffer = false;
  private ignoreOffer = false;
  private closed = false;

  constructor(
    myId: string,
    private readonly remoteId: string,
    private readonly signal: (to: string, payload: SignalPayload) => void,
    private readonly events: PeerEvents,
  ) {
    this.polite = myId > remoteId;
    this.pc = new RTCPeerConnection(RTC_CONFIG);

    this.stateCh = this.pc.createDataChannel('state', {
      negotiated: true,
      id: 0,
      ordered: false,
      maxRetransmits: 0,
    });
    this.reliableCh = this.pc.createDataChannel('reliable', {
      negotiated: true,
      id: 1,
    });

    this.stateCh.onopen = () => events.onOpen();
    this.stateCh.onmessage = (ev) => {
      try {
        events.onState(JSON.parse(String(ev.data)) as P2PStateMessage);
      } catch {
        /* 壊れたパケットは無視 */
      }
    };
    this.reliableCh.onmessage = (ev) => {
      try {
        events.onReliable(JSON.parse(String(ev.data)) as P2PReliableMessage);
      } catch {
        /* 同上 */
      }
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        this.sendDescription();
      } catch (err) {
        console.warn(`[peer ${remoteId}] negotiation error`, err);
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.onicecandidate = (ev) => {
      this.signal(this.remoteId, {
        kind: 'candidate',
        candidate: ev.candidate ? ev.candidate.toJSON() : null,
      });
    };

    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed' || s === 'closed') {
        this.notifyClose();
      }
    };
  }

  async handleSignal(payload: SignalPayload): Promise<void> {
    try {
      if (payload.kind === 'description') {
        const desc = payload.description;
        const collision =
          desc.type === 'offer' &&
          (this.makingOffer || this.pc.signalingState !== 'stable');
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        await this.pc.setRemoteDescription(desc);
        if (desc.type === 'offer') {
          await this.pc.setLocalDescription();
          this.sendDescription();
        }
      } else {
        try {
          await this.pc.addIceCandidate(payload.candidate ?? undefined);
        } catch (err) {
          if (!this.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.warn(`[peer ${this.remoteId}] signal error`, err);
    }
  }

  get isOpen(): boolean {
    return this.stateCh.readyState === 'open';
  }

  sendState(msg: P2PStateMessage): void {
    if (this.stateCh.readyState === 'open') {
      this.stateCh.send(JSON.stringify(msg));
    }
  }

  sendReliable(msg: P2PReliableMessage): void {
    if (this.reliableCh.readyState === 'open') {
      this.reliableCh.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.closed = true;
    this.pc.close();
  }

  private notifyClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.events.onClose();
  }

  private sendDescription(): void {
    const d = this.pc.localDescription;
    if (d) {
      this.signal(this.remoteId, {
        kind: 'description',
        description: { type: d.type, sdp: d.sdp },
      });
    }
  }
}
