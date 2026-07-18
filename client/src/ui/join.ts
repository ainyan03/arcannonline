const NAME_KEY = 'blt-name';

/** 参加オーバーレイを表示し、決定されたプレイヤー名を返す。 */
export function showJoinOverlay(): Promise<string> {
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
    input.value =
      localStorage.getItem(NAME_KEY) ??
      `player${Math.floor(Math.random() * 1000)}`;

    const button = document.createElement('button');
    button.textContent = '参加';

    const submit = () => {
      const name = input.value.trim().slice(0, 16) || 'noname';
      localStorage.setItem(NAME_KEY, name);
      overlay.remove();
      resolve(name);
    };
    button.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });

    panel.append(title, input, button);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}
