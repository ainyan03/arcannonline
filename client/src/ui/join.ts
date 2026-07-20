import type { Appearance } from '../../../shared/src/protocol';
import {
  currentAccount,
  loginWithGithub,
  logoutGithub,
  onAccountChange,
  preloadAuth,
} from '../auth/github';

const NAME_KEY = 'arcn-name';
const AUTOJOIN_KEY = 'arcn-autojoin';
const APPEARANCE_KEY = 'arcn-appearance';

export interface JoinResult {
  name: string;
  appearance: Appearance;
}

const SHAPES = ['星の魔法少女', '箒の魔女', '月の魔導士', '花の魔女'];
const ACCS = ['飾りなし', '魔女帽子', '大きなリボン'];

function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    if (raw) {
      const a = JSON.parse(raw) as Appearance;
      if (typeof a.s === 'number' && typeof a.c === 'string') return a;
    }
  } catch {
    /* 壊れた保存値は無視 */
  }
  return { s: 0, c: '#8877cc', a: 0 };
}

/**
 * 参加オーバーレイを表示し、プレイヤー名と見た目を返す。
 * 一度参加したタブが再読み込みされた場合 (スマホの画面ロック復帰等) は、
 * オーバーレイを出さずに保存済みの設定で即時再参加する。
 */
export function showJoinOverlay(
  peerId: string,
  allowGithubBinding = true,
): Promise<JoinResult> {
  const accountForThisPeer = () => {
    const acc = currentAccount();
    return acc?.boundPeerId === peerId ? acc : null;
  };
  const boundAccountName = () => accountForThisPeer()?.name.slice(0, 16) ?? null;
  const savedName = localStorage.getItem(NAME_KEY);
  if (sessionStorage.getItem(AUTOJOIN_KEY) && savedName) {
    return Promise.resolve({
      name: boundAccountName() ?? savedName,
      appearance: loadAppearance(),
    });
  }
  return new Promise((resolve) => {
    // ログインボタン押下で即ポップアップを開けるよう SDK を先にロードしておく
    preloadAuth();
    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const panel = document.createElement('div');
    panel.className = 'panel';

    const title = document.createElement('h1');
    title.textContent = 'ArcannonLine';

    const tagline = document.createElement('div');
    tagline.className = 'tagline';
    tagline.textContent = '魔法弾幕オンライン共闘（試作）';

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 16;
    input.placeholder = 'プレイヤー名';
    // 手入力の名前は連携解除時に戻せるよう別に覚えておく
    let manualName = savedName ?? `player${Math.floor(Math.random() * 1000)}`;
    input.value = manualName;
    input.addEventListener('input', () => {
      if (!input.disabled) manualName = input.value;
    });
    // GitHub 連携中はアカウント名で参加する (名前欄はロック)
    const syncNameLock = () => {
      const ghName = boundAccountName();
      input.disabled = ghName !== null;
      input.value = ghName ?? manualName;
      input.title = ghName !== null ? 'GitHub 連携中はアカウント名で参加します' : '';
    };

    const saved = loadAppearance();

    const makeSelect = (labels: string[], value: number) => {
      const sel = document.createElement('select');
      labels.forEach((label, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = label;
        sel.appendChild(opt);
      });
      sel.value = String(value);
      return sel;
    };
    const shapeSel = makeSelect(SHAPES, saved.s);
    const accSel = makeSelect(ACCS, saved.a);
    const colorIn = document.createElement('input');
    colorIn.type = 'color';
    colorIn.value = saved.c;

    const row = document.createElement('div');
    row.className = 'row';
    row.append(shapeSel, colorIn, accSel);

    // GitHub 連携 (任意): ログインすると頭上ラベルが認証済みアバターになる
    const ghRow = document.createElement('div');
    ghRow.className = 'gh-row';
    const ghError = document.createElement('div');
    ghError.className = 'gh-error';
    ghError.style.display = 'none';
    const renderGh = () => {
      ghRow.replaceChildren();
      const acc = accountForThisPeer();
      if (acc) {
        if (acc.picture) {
          const img = document.createElement('img');
          img.src = acc.picture;
          img.alt = '';
          ghRow.appendChild(img);
        }
        const nameSpan = document.createElement('span');
        nameSpan.className = 'gh-name';
        nameSpan.textContent = acc.name;
        const badge = document.createElement('span');
        badge.className = 'gh-badge';
        badge.textContent = '✓ GitHubログイン済み';
        badge.title = 'GitHubログインと現在のピア鍵を確認済み（表示名は自己申告）';
        const unlink = document.createElement('button');
        unlink.type = 'button';
        unlink.className = 'gh-unlink';
        unlink.textContent = '解除';
        unlink.addEventListener('click', () => void logoutGithub());
        ghRow.append(nameSpan, badge, unlink);
      } else if (allowGithubBinding) {
        const login = document.createElement('button');
        login.type = 'button';
        login.className = 'gh-login';
        login.textContent = 'GitHub 連携 (任意: 認証バッジ + アバター表示)';
        login.addEventListener('click', () => {
          login.disabled = true;
          login.textContent = 'GitHub に接続中…';
          ghError.style.display = 'none';
          loginWithGithub(peerId).catch((err: unknown) => {
            const code = (err as { code?: string } | null)?.code;
            ghError.textContent =
              code === 'auth/popup-blocked'
                ? 'ポップアップがブロックされました。許可してから再試行してください'
                : 'ログインできませんでした (キャンセル/失敗)';
            ghError.style.display = '';
            renderGh();
          });
        });
        ghRow.appendChild(login);
      } else {
        const note = document.createElement('span');
        note.className = 'gh-name';
        note.textContent = 'GitHub連携は先に開いたタブで使用中';
        ghRow.appendChild(note);
      }
    };
    const renderAuthState = () => {
      renderGh();
      syncNameLock();
    };
    renderAuthState();
    const unsubscribeAuth = onAccountChange(renderAuthState);

    const button = document.createElement('button');
    button.textContent = '参加';

    const submit = () => {
      const name = input.value.trim().slice(0, 16) || 'noname';
      const appearance: Appearance = {
        s: Number(shapeSel.value),
        c: colorIn.value,
        a: Number(accSel.value),
      };
      // 保存するのは手入力の名前。GitHub 連携中の参加名は毎回アカウントから
      // 導出するので保存せず、解除したら手入力の名前へ戻れるようにする
      localStorage.setItem(NAME_KEY, manualName.trim().slice(0, 16) || 'noname');
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
      sessionStorage.setItem(AUTOJOIN_KEY, '1');
      unsubscribeAuth();
      overlay.remove();
      resolve({ name, appearance });
    };
    button.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });

    panel.append(title, tagline, input, row, ghRow, ghError, button);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}
