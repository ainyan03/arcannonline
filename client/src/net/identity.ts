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
 * 2枚目以降のタブは undefined を返して使い捨て鍵に落とす。
 */
export async function loadIdentityKey(): Promise<Uint8Array | undefined> {
  if (!navigator.locks) return loadStored();
  return new Promise((resolve) => {
    void navigator.locks.request(
      'arcn-identity',
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          resolve(undefined);
          return;
        }
        resolve(loadStored());
        // タブが生きている限りロックを保持し続ける (解放はタブ破棄時)
        await new Promise(() => {});
      },
    );
  });
}
