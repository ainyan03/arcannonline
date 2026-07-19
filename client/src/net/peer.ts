import type {
  ReliableMessage,
  SignalPayload,
  StatePayload,
} from '../../../shared/src/protocol';

export interface PeerEvents {
  /** state チャネルが開通した */
  onOpen: () => void;
  /** 接続が失敗・切断された（相手側都合含む） */
  onClose: () => void;
  onState: (msg: StatePayload) => void;
  onReliable: (msg: ReliableMessage) => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
};

/**
 * 1 対向との WebRTC 接続。perfect negotiation パターンで glare を解消する。
 * データチャネルは negotiated 固定 ID で両側同時生成:
 *   id=0 state:    非信頼・非順序 (位置同期)
 *   id=1 reliable: 信頼 (PEX・シグナリング中継・チャット・発射イベント予定)
 */
export class Peer {
  readonly createdAt = performance.now();

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
    private readonly signal: (payload: SignalPayload) => void,
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
    this.stateCh.onclose = () => this.notifyClose();
    this.stateCh.onmessage = (ev) => {
      try {
        events.onState(JSON.parse(String(ev.data)) as StatePayload);
      } catch {
        /* 壊れたパケットは無視 */
      }
    };
    this.reliableCh.onmessage = (ev) => {
      try {
        events.onReliable(JSON.parse(String(ev.data)) as ReliableMessage);
      } catch {
        /* 同上 */
      }
    };

    // オファーは impolite 側 (id が小さい側) のみが出す。glare が起きないため
    // rollback が不要になり、リレーに流すイベント数も半減する
    this.pc.onnegotiationneeded = async () => {
      if (this.polite) return;
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        await this.waitIceGathering();
        this.sendDescription();
      } catch (err) {
        console.warn(`[peer ${remoteId.slice(0, 8)}] negotiation error`, err);
      } finally {
        this.makingOffer = false;
      }
    };
    // トリクル ICE は使わない (候補を個別に送るとリレーへのイベント数が
    // 1接続あたり数十件になりレート制限を招く)。gathering 完了を待って
    // 候補入りの SDP を1発で送る (バニラ ICE)

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
          await this.waitIceGathering();
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
      console.warn(`[peer ${this.remoteId.slice(0, 8)}] signal error`, err);
    }
  }

  get isOpen(): boolean {
    return this.stateCh.readyState === 'open';
  }

  sendState(msg: StatePayload): void {
    if (this.stateCh.readyState === 'open') {
      this.stateCh.send(JSON.stringify(msg));
    }
  }

  sendReliable(msg: ReliableMessage): void {
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

  /** ICE gathering の完了 (または上限時間) を待つ。バニラ ICE 用 */
  private waitIceGathering(timeoutMs = 2_500): Promise<void> {
    if (this.pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.pc.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      };
      const onChange = () => {
        if (this.pc.iceGatheringState === 'complete') finish();
      };
      const timer = setTimeout(finish, timeoutMs);
      this.pc.addEventListener('icegatheringstatechange', onChange);
    });
  }

  private sendDescription(): void {
    const d = this.pc.localDescription;
    if (d) {
      this.signal({
        kind: 'description',
        description: { type: d.type, sdp: d.sdp },
      });
    }
  }
}
