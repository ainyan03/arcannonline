import {
  FIELD_SIZE,
  MAX_HP,
  MAX_PEERS,
  MAX_SCRIPT_SRC_LEN,
  type Appearance,
  type FireEvent,
  type NostrContent,
  type ReliableMessage,
  type SignalEnvelope,
  type SignalPayload,
  type StatePayload,
} from './protocol';

type JsonRecord = Record<string, unknown>;

const PEER_ID_RE = /^[0-9a-f]{64}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_SIGNAL_SDP_LEN = 64_000;
const MAX_SIGNAL_ID_LEN = 128;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function integer(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && finite(value, min, max);
}

function shortString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

export function isPeerId(value: unknown): value is string {
  return typeof value === 'string' && PEER_ID_RE.test(value);
}

export function parseAppearance(value: unknown): Appearance | undefined {
  const v = record(value);
  if (!v) return undefined;
  if (!integer(v.s, 0, 3) || !integer(v.a, 0, 2) || typeof v.c !== 'string') {
    return undefined;
  }
  if (!COLOR_RE.test(v.c)) return undefined;
  return { s: v.s, c: v.c.toLowerCase(), a: v.a };
}

export function parseStatePayload(value: unknown): StatePayload | null {
  const v = record(value);
  if (!v || !shortString(v.n, 16) || v.n.trim().length === 0) return null;
  if (!integer(v.seq, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (!finite(v.x, -FIELD_SIZE, FIELD_SIZE) || !finite(v.y, -FIELD_SIZE, FIELD_SIZE)) return null;
  if (!finite(v.vx, -64, 64) || !finite(v.vy, -64, 64) || !finite(v.h, -Math.PI * 2, Math.PI * 2)) {
    return null;
  }
  if (!finite(v.ts, 0, 10_000_000_000_000) || !finite(v.hp, 0, MAX_HP)) return null;
  const ap = v.ap === undefined ? undefined : parseAppearance(v.ap);
  if (v.ap !== undefined && !ap) return null;
  return {
    n: v.n.trim(),
    seq: v.seq,
    x: v.x,
    y: v.y,
    vx: v.vx,
    vy: v.vy,
    h: v.h,
    ts: v.ts,
    hp: v.hp,
    ap,
  };
}

function parseSignalPayload(value: unknown): SignalPayload | null {
  const v = record(value);
  if (!v) return null;
  if (v.kind === 'description') {
    const d = record(v.description);
    if (!d || !['offer', 'answer', 'pranswer', 'rollback'].includes(String(d.type))) return null;
    if (d.sdp !== undefined && !shortString(d.sdp, MAX_SIGNAL_SDP_LEN)) return null;
    return {
      kind: 'description',
      description: {
        type: d.type as RTCSdpType,
        sdp: d.sdp as string | undefined,
      },
    };
  }
  if (v.kind === 'candidate') {
    if (v.candidate === null) return { kind: 'candidate', candidate: null };
    const c = record(v.candidate);
    if (!c || (c.candidate !== undefined && !shortString(c.candidate, 4_096))) return null;
    if (c.sdpMid !== undefined && c.sdpMid !== null && !shortString(c.sdpMid, 64)) return null;
    if (c.sdpMLineIndex !== undefined && c.sdpMLineIndex !== null && !integer(c.sdpMLineIndex, 0, 255)) return null;
    if (c.usernameFragment !== undefined && c.usernameFragment !== null && !shortString(c.usernameFragment, 256)) return null;
    return {
      kind: 'candidate',
      candidate: {
        candidate: c.candidate as string | undefined,
        sdpMid: c.sdpMid as string | null | undefined,
        sdpMLineIndex: c.sdpMLineIndex as number | null | undefined,
        usernameFragment: c.usernameFragment as string | null | undefined,
      },
    };
  }
  return null;
}

export function parseSignalEnvelope(value: unknown): SignalEnvelope | null {
  const v = record(value);
  if (!v || !shortString(v.id, MAX_SIGNAL_ID_LEN) || v.id.length === 0) return null;
  if (!isPeerId(v.to) || !isPeerId(v.from)) return null;
  const payload = parseSignalPayload(v.payload);
  return payload ? { id: v.id, to: v.to, from: v.from, payload } : null;
}

export function parseFireEvent(value: unknown): FireEvent | null {
  const v = record(value);
  if (!v || !shortString(v.id, MAX_SIGNAL_ID_LEN) || v.id.length === 0) return null;
  if (!shortString(v.script, 64) || v.script.length === 0 || !integer(v.seed, 0, 0xffff_ffff)) return null;
  if (!finite(v.x, -FIELD_SIZE, FIELD_SIZE) || !finite(v.y, -FIELD_SIZE, FIELD_SIZE)) return null;
  if (!finite(v.dir, -Math.PI * 2, Math.PI * 2) || !finite(v.at, 0, 10_000_000_000_000)) return null;
  if (v.target !== undefined && !isPeerId(v.target)) return null;
  if (v.src !== undefined && !shortString(v.src, MAX_SCRIPT_SRC_LEN)) return null;
  const hasTargetPos = v.tx !== undefined || v.ty !== undefined;
  if (hasTargetPos && (!finite(v.tx, -FIELD_SIZE, FIELD_SIZE) || !finite(v.ty, -FIELD_SIZE, FIELD_SIZE))) {
    return null;
  }
  return {
    id: v.id,
    script: v.script,
    seed: v.seed,
    x: v.x,
    y: v.y,
    dir: v.dir,
    at: v.at,
    target: v.target as string | undefined,
    tx: v.tx as number | undefined,
    ty: v.ty as number | undefined,
    src: v.src as string | undefined,
  };
}

export function parseReliableMessage(value: unknown): ReliableMessage | null {
  const v = record(value);
  if (!v || typeof v.type !== 'string') return null;
  switch (v.type) {
    case 'pex': {
      if (!Array.isArray(v.peers) || v.peers.length > MAX_PEERS) return null;
      const peers = [...new Set(v.peers)];
      return peers.every(isPeerId) ? { type: 'pex', peers } : null;
    }
    case 'sig': {
      const env = parseSignalEnvelope(v.env);
      return env ? { type: 'sig', env } : null;
    }
    case 'fire': {
      const ev = parseFireEvent(v.ev);
      return ev ? { type: 'fire', ev } : null;
    }
    case 'bkill':
      return shortString(v.f, MAX_SIGNAL_ID_LEN) && v.f.length > 0 && integer(v.i, 0, 100_000)
        ? { type: 'bkill', f: v.f, i: v.i }
        : null;
    case 'chat':
      return shortString(v.text, 200) && v.text.trim().length > 0
        ? { type: 'chat', text: v.text }
        : null;
    default:
      return null;
  }
}

export function parseNostrContent(value: unknown): NostrContent | null {
  const v = record(value);
  if (!v) return null;
  if (v.t === 'presence') return { t: 'presence' };
  if (v.t === 'bye') return { t: 'bye' };
  if (v.t === 'signal') {
    const env = parseSignalEnvelope(v.env);
    return env ? { t: 'signal', env } : null;
  }
  return null;
}
