const STORAGE_KEY = 'blt-custom-script';

const TEMPLATE = `// 自作弾幕スクリプト (E で開閉)
// fire(角度deg, 速度, 耐久度, 半径) / wait(tick) / loop(n){}
// 変数: dir(自機向き) aim(ターゲット方向) tdist(距離) t rand(a,b)
let a = aim;
loop (24) {
  fire(a + rand(0-5, 5), 14, 1, 0.4);
  a = a + 15;
  wait(4);
}
`;

/**
 * カスタム弾幕スクリプトの編集パネル。
 * 適用時に構文チェックし、成功したソースは localStorage に保存される。
 */
export class ScriptEditorUI {
  /** 適用時に呼ばれる。エラーメッセージを返すと表示され、null なら成功 */
  onApply?: (source: string) => string | null;

  private readonly panel: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly error: HTMLElement;

  constructor(container: HTMLElement) {
    this.panel = document.createElement('div');
    this.panel.className = 'editor';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = '自作弾幕スクリプト';

    this.textarea = document.createElement('textarea');
    this.textarea.spellcheck = false;
    this.textarea.value = localStorage.getItem(STORAGE_KEY) ?? TEMPLATE;
    this.textarea.addEventListener('keydown', (e) => e.stopPropagation());

    this.error = document.createElement('div');
    this.error.className = 'err';

    const apply = document.createElement('button');
    apply.textContent = '適用して選択 (キー5)';
    apply.addEventListener('click', () => {
      const source = this.textarea.value;
      const err = this.onApply?.(source) ?? null;
      if (err) {
        this.error.textContent = err;
      } else {
        this.error.textContent = '';
        localStorage.setItem(STORAGE_KEY, source);
        this.toggle(false);
      }
    });

    const close = document.createElement('button');
    close.textContent = '閉じる';
    close.addEventListener('click', () => this.toggle(false));

    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    buttons.append(apply, close);

    this.panel.append(title, this.textarea, this.error, buttons);
    container.appendChild(this.panel);
  }

  get isOpen(): boolean {
    return this.panel.style.display === 'block';
  }

  get source(): string {
    return this.textarea.value;
  }

  toggle(show = !this.isOpen): void {
    this.panel.style.display = show ? 'block' : 'none';
  }
}
