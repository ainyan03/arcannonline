import {
  BASE_ID,
  BASE_MAX_HP,
  BASE_SYNC_HITS_MAX,
  FIELD_SIZE,
  MAX_HP,
  MAX_ID_TOKEN_LEN,
  CHAT_LOG_MAX,
  MAX_FIRE_BATCH,
  MAX_PEERS,
  NPC_KINDS,
  NPCS_PER_PEER,
  type Appearance,
  type BaseHitEvent,
  type BulletCollisionEvent,
  type BulletRef,
  type ChatLogEntry,
  type FireEvent,
  type NostrContent,
  type NpcKind,
  type NpcStatePayload,
  type RealtimeMessage,
  type ReliableMessage,
  type SignalEnvelope,
  type SignalPayload,
  type StatePayload,
} from './protocol';
import { PLAYER_SPEED_MAX } from './player-classes';

type JsonRecord = Record<string, unknown>;

const PEER_ID_RE = /^[0-9a-f]{64}$/;
/** 申告バージョンの受理上限 (異常値によるバナー誤発火を防ぐ緩い天井) */
const MAX_PROTO_VERSION = 1_000_000;
const NPC_ID_RE = /^[0-9a-f]{64}:npc:[0-8]$/;
/** JWT (base64url 3パート) の形式チェック */
const JWT_RE = /^[\w-]+\.[\w-]+\.[\w-]+$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_SIGNAL_SDP_LEN = 64_000;
const MAX_SIGNAL_ID_LEN = 128;
/** schnorr 署名 (64 bytes) の hex 表現 */
const SCHNORR_SIG_RE = /^[0-9a-f]{128}$/;

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

export function isNpcId(value: unknown): value is string {
  return typeof value === 'string' && NPC_ID_RE.test(value);
}

export function npcBelongsToPeer(npcId: string, peerId: string): boolean {
  return isPeerId(peerId) && npcId.startsWith(`${peerId}:npc:`);
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

export function parseNpcStatePayload(value: unknown): NpcStatePayload | null {
  const v = record(value);
  if (!v || !isNpcId(v.id) || !integer(v.seq, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (!finite(v.x, -FIELD_SIZE, FIELD_SIZE) || !finite(v.y, -FIELD_SIZE, FIELD_SIZE)) return null;
  if (!finite(v.vx, -32, 32) || !finite(v.vy, -32, 32) || !finite(v.h, -Math.PI * 2, Math.PI * 2)) {
    return null;
  }
  if (v.k !== undefined && !(typeof v.k === 'string' && v.k in NPC_KINDS)) return null;
  const kind = (v.k as NpcKind | undefined) ?? 'wisp';
  if (!finite(v.hp, 0, NPC_KINDS[kind].maxHp) || !finite(v.ts, 0, 10_000_000_000_000)) return null;
  if (!['spawn', 'wander', 'chase', 'attack', 'dead'].includes(String(v.mode))) return null;
  return {
    id: v.id,
    seq: v.seq,
    x: v.x,
    y: v.y,
    vx: v.vx,
    vy: v.vy,
    h: v.h,
    hp: v.hp,
    mode: v.mode as NpcStatePayload['mode'],
    ts: v.ts,
    k: v.k as NpcKind | undefined,
  };
}

export function parseRealtimeMessage(value: unknown): RealtimeMessage | null {
  const v = record(value);
  if (!v) return null;
  // 旧クライアントのタグなしplayer stateも移行期間中は受理する。
  if (v.type === undefined) {
    const state = parseStatePayload(value);
    return state ? { type: 'state', state } : null;
  }
  if (v.type === 'state') {
    const state = parseStatePayload(v.state);
    return state ? { type: 'state', state } : null;
  }
  if (v.type === 'npcs') {
    // +1 はリーダーだけが担当するボススロット (BOSS_NPC_SLOT) のぶん
    if (!Array.isArray(v.states) || v.states.length > NPCS_PER_PEER + 1) return null;
    const states = v.states.map(parseNpcStatePayload);
    return states.every((state): state is NpcStatePayload => state !== null)
      ? { type: 'npcs', states }
      : null;
  }
  return null;
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
  if (
    v.sig !== undefined &&
    (typeof v.sig !== 'string' || !SCHNORR_SIG_RE.test(v.sig))
  ) {
    return null;
  }
  const payload = parseSignalPayload(v.payload);
  return payload
    ? { id: v.id, to: v.to, from: v.from, payload, sig: v.sig as string | undefined }
    : null;
}

export function parseFireEvent(value: unknown): FireEvent | null {
  const v = record(value);
  if (!v || !shortString(v.id, MAX_SIGNAL_ID_LEN) || v.id.length === 0) return null;
  if (!shortString(v.script, 64) || v.script.length === 0 || !integer(v.seed, 0, 0xffff_ffff)) return null;
  if (!finite(v.x, -FIELD_SIZE, FIELD_SIZE) || !finite(v.y, -FIELD_SIZE, FIELD_SIZE)) return null;
  if (!finite(v.dir, -Math.PI * 2, Math.PI * 2) || !finite(v.at, 0, 10_000_000_000_000)) return null;
  const hasVelocity = v.vx !== undefined || v.vy !== undefined;
  if (
    hasVelocity &&
    (!finite(v.vx, -PLAYER_SPEED_MAX, PLAYER_SPEED_MAX) ||
      !finite(v.vy, -PLAYER_SPEED_MAX, PLAYER_SPEED_MAX))
  ) {
    return null;
  }
  if (
    v.target !== undefined &&
    v.target !== BASE_ID &&
    !isPeerId(v.target) &&
    !isNpcId(v.target)
  ) return null;
  if (v.npc !== undefined && !isNpcId(v.npc)) return null;
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
    vx: v.vx as number | undefined,
    vy: v.vy as number | undefined,
    at: v.at,
    target: v.target as string | undefined,
    tx: v.tx as number | undefined,
    ty: v.ty as number | undefined,
    npc: v.npc as string | undefined,
  };
}

function parseBulletRef(value: unknown): BulletRef | null {
  const v = record(value);
  if (!v || !shortString(v.f, MAX_SIGNAL_ID_LEN) || v.f.length === 0) return null;
  if (!integer(v.i, 0, 100_000)) return null;
  if (!isPeerId(v.o) && !isNpcId(v.o)) return null;
  return { f: v.f, i: v.i, o: v.o };
}

function parseBulletCollision(value: unknown): BulletCollisionEvent | null {
  const v = record(value);
  if (!v || !shortString(v.id, MAX_SIGNAL_ID_LEN) || v.id.length === 0) return null;
  const a = parseBulletRef(v.a);
  const b = parseBulletRef(v.b);
  if (!a || !b || !finite(v.da, 1, 1000) || !finite(v.db, 1, 1000)) return null;
  return { id: v.id, a, b, da: v.da, db: v.db };
}

function parseChatLogEntry(value: unknown): ChatLogEntry | null {
  const v = record(value);
  if (!v || !shortString(v.id, 64) || v.id.length === 0) return null;
  if (!shortString(v.n, 32)) return null;
  if (!shortString(v.t, 200) || v.t.trim().length === 0) return null;
  if (!finite(v.at, 0, 10_000_000_000_000)) return null;
  return { id: v.id, n: v.n, t: v.t, at: v.at };
}

function parseBaseHit(value: unknown): BaseHitEvent | null {
  const v = record(value);
  if (!v || !shortString(v.id, MAX_SIGNAL_ID_LEN) || v.id.length === 0) return null;
  if (!isNpcId(v.npc) || !finite(v.damage, 1, BASE_MAX_HP)) return null;
  if (!finite(v.at, 0, 10_000_000_000_000)) return null;
  return { id: v.id, npc: v.npc, damage: v.damage, at: v.at };
}

export function parseReliableMessage(value: unknown): ReliableMessage | null {
  const v = record(value);
  if (!v || typeof v.type !== 'string') return null;
  switch (v.type) {
    case 'pex': {
      if (!Array.isArray(v.peers) || v.peers.length > MAX_PEERS) return null;
      if (v.v !== undefined && !integer(v.v, 1, MAX_PROTO_VERSION)) return null;
      const peers = [...new Set(v.peers)];
      return peers.every(isPeerId)
        ? { type: 'pex', peers, v: v.v as number | undefined }
        : null;
    }
    case 'sig': {
      const env = parseSignalEnvelope(v.env);
      return env ? { type: 'sig', env } : null;
    }
    case 'fire': {
      const ev = parseFireEvent(v.ev);
      return ev ? { type: 'fire', ev } : null;
    }
    case 'fires': {
      if (
        !Array.isArray(v.events) ||
        v.events.length === 0 ||
        v.events.length > MAX_FIRE_BATCH
      ) return null;
      const events = v.events.map(parseFireEvent);
      return events.every((event): event is FireEvent => event !== null)
        ? { type: 'fires', events }
        : null;
    }
    case 'bkill':
      return shortString(v.f, MAX_SIGNAL_ID_LEN) && v.f.length > 0 && integer(v.i, 0, 100_000)
        ? { type: 'bkill', f: v.f, i: v.i }
        : null;
    case 'bcoll': {
      const ev = parseBulletCollision(v.ev);
      return ev ? { type: 'bcoll', ev } : null;
    }
    case 'base-hit': {
      const ev = parseBaseHit(v.ev);
      return ev ? { type: 'base-hit', ev } : null;
    }
    case 'base-sync': {
      if (!Array.isArray(v.hits) || v.hits.length > BASE_SYNC_HITS_MAX) return null;
      if (v.lit !== undefined && typeof v.lit !== 'boolean') return null;
      if (v.at !== undefined && !finite(v.at, 0, 10_000_000_000_000)) return null;
      const hits = v.hits.map(parseBaseHit);
      return hits.every((hit): hit is BaseHitEvent => hit !== null)
        ? {
            type: 'base-sync',
            hits,
            ...(v.lit === undefined ? {} : { lit: v.lit as boolean }),
            ...(v.at === undefined ? {} : { at: v.at as number }),
          }
        : null;
    }
    case 'chat': {
      if (!shortString(v.text, 200) || v.text.trim().length === 0) return null;
      if (v.id !== undefined && (!shortString(v.id, 64) || v.id.length === 0)) return null;
      if (v.at !== undefined && !finite(v.at, 0, 10_000_000_000_000)) return null;
      return {
        type: 'chat',
        text: v.text,
        ...(v.id === undefined ? {} : { id: v.id as string }),
        ...(v.at === undefined ? {} : { at: v.at as number }),
      };
    }
    case 'chat-log': {
      if (!Array.isArray(v.entries) || v.entries.length > CHAT_LOG_MAX) return null;
      const entries = v.entries.map(parseChatLogEntry);
      return entries.every((entry): entry is ChatLogEntry => entry !== null)
        ? { type: 'chat-log', entries }
        : null;
    }
    case 'profile':
      return shortString(v.token, MAX_ID_TOKEN_LEN) && JWT_RE.test(v.token)
        ? { type: 'profile', token: v.token }
        : null;
    case 'profile-clear':
      return { type: 'profile-clear' };
    default:
      return null;
  }
}

export function parseNostrContent(value: unknown): NostrContent | null {
  const v = record(value);
  if (!v) return null;
  if (v.t === 'presence') {
    if (v.v !== undefined && !integer(v.v, 1, MAX_PROTO_VERSION)) return null;
    return { t: 'presence', v: v.v as number | undefined };
  }
  if (v.t === 'bye') return { t: 'bye' };
  if (v.t === 'signal') {
    const env = parseSignalEnvelope(v.env);
    return env ? { t: 'signal', env } : null;
  }
  return null;
}
