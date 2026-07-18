const MAX_LINES = 8;

/**
 * チャット。入力枠は画面最下部に常設し、自由に編集して Enter (確定) で送信する。
 * Enter キー (ゲーム側) で入力欄へフォーカス、Escape でゲーム操作へ戻る。
 */
export class ChatUI {
  onSend?: (text: string) => void;

  private readonly log: HTMLElement;
  private readonly input: HTMLInputElement;

  constructor(container: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'chat';
    this.log = document.createElement('div');
    this.log.className = 'chat-log';
    this.input = document.createElement('input');
    this.input.className = 'chat-input';
    this.input.type = 'text';
    this.input.maxLength = 200;
    this.input.placeholder = 'チャット… (Enterで送信)';
    root.append(this.log, this.input);
    container.appendChild(root);

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
