// シグナリングサーバ:
// - ログイン中ユーザーの接続と座標のみを保持する
// - 距離に応じた近傍の出入り (neighbor-enter / neighbor-leave) を双方へ通知する
// - WebRTC のシグナリングメッセージ (SDP/ICE) を相手クライアントへ中継する
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  DEFAULT_SIGNALING_PORT,
  NEIGHBOR_ENTER_RADIUS,
  NEIGHBOR_LEAVE_RADIUS,
  type ClientMessage,
  type PeerInfo,
  type ServerMessage,
  type Vec2,
} from '../../shared/src/protocol';

interface Client {
  id: string;
  name: string;
  pos: Vec2;
  ws: WebSocket;
  neighbors: Set<string>;
}

const ENTER_R2 = NEIGHBOR_ENTER_RADIUS * NEIGHBOR_ENTER_RADIUS;
const LEAVE_R2 = NEIGHBOR_LEAVE_RADIUS * NEIGHBOR_LEAVE_RADIUS;

const clients = new Map<string, Client>();

function send(client: Client, msg: ServerMessage): void {
  if (client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(msg));
  }
}

function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function peerInfo(c: Client): PeerInfo {
  return { id: c.id, name: c.name, pos: c.pos };
}

function link(a: Client, b: Client): void {
  a.neighbors.add(b.id);
  b.neighbors.add(a.id);
  send(a, { type: 'neighbor-enter', peer: peerInfo(b) });
  send(b, { type: 'neighbor-enter', peer: peerInfo(a) });
}

function unlink(a: Client, b: Client): void {
  a.neighbors.delete(b.id);
  b.neighbors.delete(a.id);
  send(a, { type: 'neighbor-leave', id: b.id });
  send(b, { type: 'neighbor-leave', id: a.id });
}

function updateNeighbors(c: Client): void {
  for (const other of clients.values()) {
    if (other === c) continue;
    const d2 = dist2(c.pos, other.pos);
    const linked = c.neighbors.has(other.id);
    if (!linked && d2 <= ENTER_R2) {
      link(c, other);
    } else if (linked && d2 > LEAVE_R2) {
      unlink(c, other);
    }
  }
}

function sanitizePos(pos: unknown): Vec2 {
  const p = pos as Partial<Vec2> | null | undefined;
  const x = typeof p?.x === 'number' && Number.isFinite(p.x) ? p.x : 0;
  const y = typeof p?.y === 'number' && Number.isFinite(p.y) ? p.y : 0;
  return { x, y };
}

const port = Number(process.env.PORT ?? DEFAULT_SIGNALING_PORT);
const wss = new WebSocketServer({ port });

wss.on('connection', (ws) => {
  let me: Client | null = null;

  ws.on('message', (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return;
    }

    if (!me) {
      if (msg.type !== 'join') return;
      const name = String(msg.name ?? '').trim().slice(0, 16) || 'noname';
      me = {
        id: randomUUID(),
        name,
        pos: sanitizePos(msg.pos),
        ws,
        neighbors: new Set(),
      };
      clients.set(me.id, me);
      send(me, { type: 'welcome', id: me.id });
      updateNeighbors(me);
      console.log(`join: ${me.name} (${me.id}) clients=${clients.size}`);
      return;
    }

    switch (msg.type) {
      case 'pos':
        me.pos = sanitizePos(msg.pos);
        updateNeighbors(me);
        break;
      case 'signal': {
        const target = clients.get(msg.to);
        if (target) {
          send(target, { type: 'signal', from: me.id, payload: msg.payload });
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!me) return;
    for (const id of [...me.neighbors]) {
      const other = clients.get(id);
      if (other) unlink(me, other);
    }
    clients.delete(me.id);
    console.log(`leave: ${me.name} (${me.id}) clients=${clients.size}`);
  });
});

console.log(`signaling server listening on ws://0.0.0.0:${port}`);
