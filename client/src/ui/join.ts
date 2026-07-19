import type { Appearance } from '../../../shared/src/protocol';

const NAME_KEY = 'blt-name';
const AUTOJOIN_KEY = 'blt-autojoin';
const APPEARANCE_KEY = 'blt-appearance';

export interface JoinResult {
  name: string;
  appearance: Appearance;
}

const SHAPES = ['カプセル', 'ボックス', 'コーン', 'スフィア'];
const ACCS = ['なし', '帽子', 'アンテナ'];

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
    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const panel = document.createElement('div');
    panel.className = 'panel';

    const title = document.createElement('h1');
    title.textContent = '弾幕フィールド試作';

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

    panel.append(title, input, row, button);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}
