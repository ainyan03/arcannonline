/**
 * Firebase ID トークン (JWT) の独立検証。
 * サーバを介さず、Google の公開鍵 (JWKS) で署名をブラウザ内検証する。
 * ピアから受け取った profile トークンの真正性確認に使う。
 */
import { parseProfileBinding } from './profile-binding';

const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/** JWKS の再取得間隔。エンドポイント側の Cache-Control (約6時間) より短めに */
const JWKS_TTL_MS = 3_600_000;

export interface VerifiedProfile {
  /** Firebase ユーザーID */
  uid: string;
  /** 表示名 (GitHub アカウント名) */
  name?: string;
  /** アバター画像URL */
  picture?: string;
  githubId: string;
  boundPeerId: string;
  expiresAt: number;
}

interface Jwk {
  kty: string;
  kid: string;
  n: string;
  e: string;
}

/** テストから差し替えられる JWKS 取得関数 */
export type JwksFetcher = () => Promise<Jwk[]>;

async function fetchJwksDefault(): Promise<Jwk[]> {
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  return body.keys ?? [];
}

let jwksCache: { keys: Jwk[]; at: number } | null = null;

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodePart(part: string): Record<string, unknown> | null {
  try {
    const json = new TextDecoder().decode(b64urlToBytes(part));
    const v = JSON.parse(json) as unknown;
    return v !== null && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Firebase ID トークンを検証し、通れば表示用プロフィールを返す。
 * 検証内容: RS256 署名 (Google 公開鍵)・発行者・対象プロジェクト・有効期限。
 * 失敗・不正はすべて null (呼び出し側は未認証として扱う)。
 *
 * Firebase署名対象のnameクレームに含めたピア公開鍵も照合し、
 * 別の接続から転載された有効トークンを拒否する。
 */
export async function verifyFirebaseToken(
  token: string,
  projectId: string,
  expectedPeerId: string,
  fetchJwks: JwksFetcher = fetchJwksDefault,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<VerifiedProfile | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (!header || !payload) return null;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

  if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (payload.aud !== projectId) return null;
  const exp = payload.exp;
  const iat = payload.iat;
  if (typeof exp !== 'number' || exp <= nowSec) return null;
  // 未来発行のトークンは拒否 (時計ずれ5分まで許容)
  if (typeof iat !== 'number' || iat > nowSec + 300) return null;
  const uid = payload.sub;
  if (typeof uid !== 'string' || uid.length === 0 || uid.length > 128) {
    return null;
  }
  const firebase = payload.firebase;
  if (!firebase || typeof firebase !== 'object' || Array.isArray(firebase)) return null;
  const firebaseRecord = firebase as Record<string, unknown>;
  if (firebaseRecord.sign_in_provider !== 'github.com') return null;
  const identities = firebaseRecord.identities;
  if (!identities || typeof identities !== 'object' || Array.isArray(identities)) {
    return null;
  }
  const githubIds = (identities as Record<string, unknown>)['github.com'];
  if (
    !Array.isArray(githubIds) ||
    githubIds.length !== 1 ||
    typeof githubIds[0] !== 'string' ||
    !/^\d+$/.test(githubIds[0])
  ) {
    return null;
  }
  const binding = parseProfileBinding(payload.name);
  if (!binding || binding.peerId !== expectedPeerId) return null;

  try {
    const cacheWasFresh =
      jwksCache !== null && performance.now() - jwksCache.at <= JWKS_TTL_MS;
    if (!cacheWasFresh) {
      jwksCache = { keys: await fetchJwks(), at: performance.now() };
    }
    let jwk = jwksCache!.keys.find((k) => k.kid === header.kid);
    // Googleの鍵ローテーション直後はTTL内キャッシュに新kidがないため、
    // kid不一致時だけ一度強制更新して正規トークンの拒否を避ける。
    if (!jwk && cacheWasFresh) {
      jwksCache = { keys: await fetchJwks(), at: performance.now() };
      jwk = jwksCache.keys.find((k) => k.kid === header.kid);
    }
    if (!jwk || jwk.kty !== 'RSA') return null;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(parts[2]) as unknown as BufferSource,
      data,
    );
    if (!ok) return null;
  } catch {
    return null;
  }

  return {
    uid,
    name: binding.name,
    picture:
      typeof payload.picture === 'string' &&
      /^https:\/\/avatars\.githubusercontent\.com\//.test(payload.picture)
        ? payload.picture
        : undefined,
    githubId: githubIds[0],
    boundPeerId: binding.peerId,
    expiresAt: exp * 1000,
  };
}

/** テスト用: JWKS キャッシュを破棄する */
export function clearJwksCacheForTest(): void {
  jwksCache = null;
}
