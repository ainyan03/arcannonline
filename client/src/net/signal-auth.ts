// シグナリング封筒の送信元認証。
// Nostr リレー経由の封筒はイベント自体の schnorr 署名で送信元が保証されるが、
// メッシュ中継の封筒は経路に署名がなく、中継者が env.from を詐称できてしまう。
// そこで封筒自体に送信元ピア鍵 (= secp256k1 公開鍵) の署名を付け、
// 中継経路で受け取った封筒は署名検証を通ったものだけを扱う。
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type {
  SignalEnvelope,
  SignalPayload,
} from '../../../shared/src/protocol';

/**
 * 署名対象の正規化表現。JSON のキー順序に依存しないよう、
 * フィールドを明示した配列として直列化する (undefined は null に揃える)。
 */
function canonicalPayload(payload: SignalPayload): unknown {
  if (payload.kind === 'description') {
    return ['description', payload.description.type, payload.description.sdp ?? null];
  }
  const c = payload.candidate;
  return [
    'candidate',
    c
      ? [c.candidate ?? null, c.sdpMid ?? null, c.sdpMLineIndex ?? null, c.usernameFragment ?? null]
      : null,
  ];
}

/** 封筒の署名対象ダイジェスト (sha256, 32 bytes) */
export function signalEnvelopeDigest(env: SignalEnvelope): Uint8Array {
  return sha256(
    utf8ToBytes(
      JSON.stringify([env.id, env.from, env.to, canonicalPayload(env.payload)]),
    ),
  );
}

/** 封筒に送信元の署名を付ける */
export function signSignalEnvelope(
  env: SignalEnvelope,
  privkey: Uint8Array,
): string {
  return bytesToHex(schnorr.sign(signalEnvelopeDigest(env), privkey));
}

/** 封筒の署名が env.from の鍵によるものかを検証する (署名なしは不合格) */
export function verifySignalEnvelope(env: SignalEnvelope): boolean {
  if (!env.sig) return false;
  try {
    return schnorr.verify(
      hexToBytes(env.sig),
      signalEnvelopeDigest(env),
      hexToBytes(env.from),
    );
  } catch {
    return false;
  }
}
