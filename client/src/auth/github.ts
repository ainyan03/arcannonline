/**
 * GitHub ログイン (Firebase Authentication)。任意機能で、ログインすると
 * 頭上ラベルの identicon が GitHub アバター + 認証バッジに変わる。
 *
 * Firebase SDK は重いため動的 import で分離チャンクにし、
 * 「過去にログインしたことがある」場合のみ起動時にロードして復元する。
 */
import { FIREBASE_CONFIG } from './firebase-config';
import { encodeProfileBinding, parseProfileBinding } from './profile-binding';

/** ログイン済みフラグ (起動時に SDK をロードして復元するかの判断のみに使う) */
const LINKED_FLAG = 'arcn-gh-linked';

export interface GithubAccount {
  /** ピアへ配る Firebase ID トークン (受信側が独立検証する) */
  token: string;
  name: string;
  picture?: string;
  boundPeerId: string | null;
}

type AuthModule = typeof import('firebase/auth');

let current: GithubAccount | null = null;
const listeners = new Set<(acc: GithubAccount | null) => void>();
let authReady: Promise<AuthModule> | null = null;
let authRevision = 0;

export function currentAccount(): GithubAccount | null {
  return current;
}

/** ログイン状態の変化 (ログイン・ログアウト・トークン更新) を購読する */
export function onAccountChange(
  fn: (acc: GithubAccount | null) => void,
): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) fn(current);
}

/** Firebase SDK をロードし、トークン更新の監視を開始する (初回のみ) */
async function ensureAuth(): Promise<AuthModule> {
  authReady ??= (async () => {
    const [{ initializeApp, getApps }, authMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
    ]);
    const app = getApps()[0] ?? initializeApp(FIREBASE_CONFIG);
    const auth = authMod.getAuth(app);
    // ID トークンは約1時間で失効し SDK が自動更新する。更新のたびに
    // current を差し替えて購読者 (ゲーム側の再ブロードキャスト) へ通知する
    authMod.onIdTokenChanged(auth, (user) => {
      const revision = ++authRevision;
      void (async () => {
        if (user) {
          const binding = parseProfileBinding(user.displayName);
          const token = await user.getIdToken();
          if (revision !== authRevision) return;
          current = {
            token,
            name: binding?.name ?? user.displayName ?? 'GitHub user',
            picture: user.photoURL ?? undefined,
            boundPeerId: binding?.peerId ?? null,
          };
          try {
            localStorage.setItem(LINKED_FLAG, '1');
          } catch {
            /* 保存不能でも現在のログインセッションは利用する */
          }
        } else {
          current = null;
        }
        notify();
      })().catch(() => {
        if (revision !== authRevision) return;
        current = null;
        notify();
      });
    });
    await auth.authStateReady();
    return authMod;
  })();
  try {
    return await authReady;
  } catch (error) {
    // 一時的なネットワーク失敗なら、次のボタン操作で再試行できるようにする。
    authReady = null;
    throw error;
  }
}

/**
 * SDK の先読み。参加画面の表示時に呼び、ログインボタン押下から
 * ポップアップまでを即時にする (押してからロードすると、ロード待ちの間に
 * ブラウザのユーザー操作有効期限が切れてポップアップがブロックされる)
 */
export function preloadAuth(): void {
  void ensureAuth().catch(() => {
    /* オフライン等でロードできなくても参加自体は妨げない */
  });
}

/**
 * 起動時の復元。過去にログインしたことがある場合のみ SDK をロードする
 * (未ログインユーザーに Firebase のダウンロードコストを払わせない)
 */
export async function restoreLogin(): Promise<void> {
  try {
    if (!localStorage.getItem(LINKED_FLAG)) return;
  } catch {
    return;
  }
  try {
    await ensureAuth();
  } catch {
    // 任意機能なので、オフラインやSDK取得失敗でゲーム参加を止めない。
  }
}

/** 復元済みアカウントを、このタブが実際に使うピア公開鍵へ束縛する。 */
export async function ensureAccountPeerBinding(peerId: string): Promise<void> {
  try {
    if (!current && !localStorage.getItem(LINKED_FLAG)) return;
  } catch {
    if (!current) return;
  }
  const authMod = await ensureAuth();
  const user = authMod.getAuth().currentUser;
  if (!user) return;
  const old = parseProfileBinding(user.displayName);
  const name = old?.name ?? user.displayName ?? 'GitHub user';
  if (old?.peerId !== peerId) {
    await authMod.updateProfile(user, {
      displayName: encodeProfileBinding(peerId, name),
    });
  }
  const token = await user.getIdToken(old?.peerId !== peerId);
  current = {
    token,
    name,
    picture: user.photoURL ?? undefined,
    boundPeerId: peerId,
  };
  try {
    localStorage.setItem(LINKED_FLAG, '1');
  } catch {
    /* 保存不能でも現在のログインセッションは利用する */
  }
  notify();
}

/** ポップアップで GitHub ログインする。失敗 (キャンセル含む) は例外 */
export async function loginWithGithub(peerId: string): Promise<void> {
  const authMod = await ensureAuth();
  const auth = authMod.getAuth();
  const provider = new authMod.GithubAuthProvider();
  const result = await authMod.signInWithPopup(auth, provider);
  // 表示名を GitHub の @ユーザー名に固定する。@ユーザー名は ID トークンに
  // 含まれないため、displayName へ書き込んでトークンを再発行することで
  // name クレームとして載せ、ピアが検証できる「アカウント名」にする
  const username = authMod.getAdditionalUserInfo(result)?.username;
  const name = username ?? result.user.displayName ?? 'GitHub user';
  await authMod.updateProfile(result.user, {
    displayName: encodeProfileBinding(peerId, name),
  });
  await result.user.getIdToken(true); // ピア鍵束縛を含む name で再発行する
}

export async function logoutGithub(): Promise<void> {
  try {
    localStorage.removeItem(LINKED_FLAG);
  } catch {
    /* localStorage が使えなくてもログアウト自体は続行 */
  }
  const authMod = await ensureAuth();
  await authMod.signOut(authMod.getAuth());
}
