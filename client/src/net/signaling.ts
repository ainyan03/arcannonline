import type {
  ClientMessage,
  PeerInfo,
  ServerMessage,
  SignalPayload,
  Vec2,
} from '../../../shared/src/protocol';

export type SignalingStatus = 'connecting' | 'open' | 'closed';

/** シグナリングサーバとの WebSocket 接続。近傍管理と WebRTC シグナリングの中継のみを担う。 */
export class SignalingClient {
  /** welcome で採番される自分の ID */
  id = '';

  onWelcome?: (id: string) => void;
  onNeighborEnter?: (peer: PeerInfo) => void;
  onNeighborLeave?: (id: string) => void;
  onSignal?: (from: string, payload: SignalPayload) => void;
  onStatus?: (status: SignalingStatus) => void;

  private ws?: WebSocket;

  connect(url: string, name: string, pos: Vec2): void {
    this.onStatus?.('connecting');
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.onStatus?.('open');
      this.send({ type: 'join', name, pos });
    };
    ws.onclose = () => this.onStatus?.('closed');
    ws.onerror = () => this.onStatus?.('closed');

    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'welcome':
          this.id = msg.id;
          this.onWelcome?.(msg.id);
          break;
        case 'neighbor-enter':
          this.onNeighborEnter?.(msg.peer);
          break;
        case 'neighbor-leave':
          this.onNeighborLeave?.(msg.id);
          break;
        case 'signal':
          this.onSignal?.(msg.from, msg.payload);
          break;
      }
    };
  }

  sendPos(pos: Vec2): void {
    this.send({ type: 'pos', pos });
  }

  sendSignal(to: string, payload: SignalPayload): void {
    this.send({ type: 'signal', to, payload });
  }

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
