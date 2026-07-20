import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

const PRIVKEY_STORAGE = 'arcn-privkey';

function loadStored(): Uint8Array {
  try {
    const hex = localStorage.getItem(PRIVKEY_STORAGE);
    if (hex && /^[0-9a-f]{64}$/.test(hex)) return hexToBytes(hex);
  } catch {
    /* localStorage が使えない環境では使い捨て鍵になる */
  }
  const key = schnorr.utils.randomSecretKey();
  try {
    localStorage.setItem(PRIVKEY_STORAGE, bytesToHex(key));
  } catch {
    /* 同上 */
  }
  return key;
}

/**
 * 永続する秘密鍵をロードする。公開鍵 (= ピアID) がプレイヤーの継続的な
 * アカウントとなり、identicon や GitHub 連携の紐付け先になる。
 *
 * 同一ブラウザの複数タブが同じ鍵で参加するとメッシュ上で同一ピア扱いに
 * なって衝突するため、Web Locks で最初の1タブだけが永続鍵を使い、
 * 2枚目以降のタブは生成した使い捨て鍵を返す。
 */
export interface IdentityKey {
  privkey: Uint8Array;
  /** 永続鍵を所有する主タブ。falseなら複数タブ用の使い捨て鍵 */
  persistent: boolean;
}

export async function loadIdentityKey(): Promise<IdentityKey> {
  if (!navigator.locks) return { privkey: loadStored(), persistent: true };
  return new Promise((resolve) => {
    void navigator.locks.request(
      'arcn-identity',
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          resolve({ privkey: schnorr.utils.randomSecretKey(), persistent: false });
          return;
        }
        resolve({ privkey: loadStored(), persistent: true });
        // タブが生きている限りロックを保持し続ける (解放はタブ破棄時)
        await new Promise(() => {});
      },
    ).catch(() => {
      // ロック機構自体が失敗した場合は、同一鍵の二重使用より使い捨てを優先する。
      resolve({ privkey: schnorr.utils.randomSecretKey(), persistent: false });
    });
  });
}

export function identityPeerId(privkey: Uint8Array): string {
  return bytesToHex(schnorr.getPublicKey(privkey));
}
