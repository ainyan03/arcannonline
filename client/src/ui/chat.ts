const MAX_LINES = 8;

/**
 * チャット。入力枠は画面最下部に常設し、自由に編集して Enter (確定) で送信する。
 * Enter キー (ゲーム側) で入力欄へフォーカス、Escape でゲーム操作へ戻る。
 */
export class ChatUI {
  onSend?: (text: string) => void;

  private readonly root: HTMLElement;
  private readonly log: HTMLElement;
  private readonly input: HTMLInputElement;

  /**
   * ソフトキーボード対策。iOS はフォーカス時に入力欄を見せようとページごと
   * スクロールさせるため、fixed 配置のゲーム画面全体が過剰に上へずれる。
   * スクロールは打ち消してゲーム画面を固定したまま、キーボードに隠れる
   * 高さぶんだけチャット枠を transform で持ち上げる
   */
  private readonly liftForKeyboard = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    if (this.isOpen) window.scrollTo(0, 0);
    const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    this.root.style.transform =
      this.isOpen && hidden > 0 ? `translateY(${-hidden}px)` : '';
  };

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'chat';
    this.log = document.createElement('div');
    this.log.className = 'chat-log';
    this.input = document.createElement('input');
    this.input.className = 'chat-input';
    this.input.type = 'text';
    this.input.maxLength = 200;
    this.input.placeholder = 'チャット… (Enterで送信)';
    this.root.append(this.log, this.input);
    container.appendChild(this.root);

    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        if (text) {
          this.onSend?.(text);
          this.input.value = '';
        }
        this.input.blur(); // 送信後はゲーム操作へ戻す
      } else if (e.key === 'Escape') {
        this.input.blur();
      }
    });
    // キーボードの出現・消滅はビューポート寸法の変化として現れる
    window.visualViewport?.addEventListener('resize', this.liftForKeyboard);
    window.visualViewport?.addEventListener('scroll', this.liftForKeyboard);
    this.input.addEventListener('focus', () => {
      // キーボード表示確定のタイミングが端末依存のため、少し遅れても補正する
      setTimeout(this.liftForKeyboard, 50);
      setTimeout(this.liftForKeyboard, 250);
    });
    this.input.addEventListener('blur', () => {
      // 持ち上げを戻し、キーボードでずれたスクロールも復元する
      this.root.style.transform = '';
      window.scrollTo(0, 0);
    });
  }

  dispose(): void {
    window.visualViewport?.removeEventListener('resize', this.liftForKeyboard);
    window.visualViewport?.removeEventListener('scroll', this.liftForKeyboard);
  }

  /** 入力欄にフォーカスがあるか (ゲーム側のキー処理の抑止判定に使える) */
  get isOpen(): boolean {
    return document.activeElement === this.input;
  }

  /** 入力欄へフォーカスする */
  open(): void {
    this.input.focus();
  }

  addLine(name: string, text: string, system = false): void {
    const line = document.createElement('div');
    if (system) {
      line.className = 'sys';
      line.textContent = text;
    } else {
      const nameSpan = document.createElement('span');
      nameSpan.className = 'name';
      nameSpan.textContent = `${name}: `;
      line.append(nameSpan, document.createTextNode(text));
    }
    this.log.appendChild(line);
    while (this.log.children.length > MAX_LINES) {
      this.log.firstChild?.remove();
    }
  }
}
