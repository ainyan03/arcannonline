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
export function showJoinOverlay(): Promise<JoinResult> {
  const savedName = localStorage.getItem(NAME_KEY);
  if (sessionStorage.getItem(AUTOJOIN_KEY) && savedName) {
    return Promise.resolve({ name: savedName, appearance: loadAppearance() });
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
    tagline.textContent = '魔法弾幕オンライン対戦（試作）';

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 16;
    input.placeholder = 'プレイヤー名';
    input.value = savedName ?? `player${Math.floor(Math.random() * 1000)}`;

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
      const acc = currentAccount();
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
        badge.textContent = '✓ 連携済み';
        const unlink = document.createElement('button');
        unlink.type = 'button';
        unlink.className = 'gh-unlink';
        unlink.textContent = '解除';
        unlink.addEventListener('click', () => void logoutGithub());
        ghRow.append(nameSpan, badge, unlink);
      } else {
        const login = document.createElement('button');
        login.type = 'button';
        login.className = 'gh-login';
        login.textContent = 'GitHub 連携 (任意: 認証バッジ + アバター表示)';
        login.addEventListener('click', () => {
          login.disabled = true;
          login.textContent = 'GitHub に接続中…';
          ghError.style.display = 'none';
          loginWithGithub().catch((err: unknown) => {
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
      }
    };
    renderGh();
    onAccountChange(renderGh);

    const button = document.createElement('button');
    button.textContent = '参加';

    const submit = () => {
      const name = input.value.trim().slice(0, 16) || 'noname';
      const appearance: Appearance = {
        s: Number(shapeSel.value),
        c: colorIn.value,
        a: Number(accSel.value),
      };
      localStorage.setItem(NAME_KEY, name);
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
      sessionStorage.setItem(AUTOJOIN_KEY, '1');
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
