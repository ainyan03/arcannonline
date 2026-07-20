const PREFIX = 'arcn:v1:';
const PEER_ID_RE = /^[0-9a-f]{64}$/;

export interface ProfileBinding {
  peerId: string;
  name: string;
}

/** Firebase署名対象のdisplayNameへ、表示名とピア公開鍵を一緒に固定する。 */
export function encodeProfileBinding(peerId: string, name: string): string {
  if (!PEER_ID_RE.test(peerId)) throw new Error('invalid peer id');
  const safeName = name.replace(/[\r\n:]/g, '').trim().slice(0, 64) || 'GitHub user';
  return `${PREFIX}${peerId}:${safeName}`;
}

export function parseProfileBinding(value: unknown): ProfileBinding | null {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return null;
  const peerId = value.slice(PREFIX.length, PREFIX.length + 64);
  if (!PEER_ID_RE.test(peerId) || value[PREFIX.length + 64] !== ':') return null;
  const name = value.slice(PREFIX.length + 65).trim();
  if (!name || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return { peerId, name };
}
