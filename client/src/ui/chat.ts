const MAX_LINES = 8;

/** 画面左下のチャット。Enter で入力欄を開き、Enter 送信 / Escape で閉じる。 */
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
    this.input.placeholder = 'メッセージ… (Enter送信 / Esc閉じる)';
    root.append(this.log, this.input);
    container.appendChild(root);

    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        if (text) this.onSend?.(text);
        this.close();
      } else if (e.key === 'Escape') {
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return this.input.style.display === 'block';
  }

  open(): void {
    this.input.style.display = 'block';
    this.input.focus();
  }

  close(): void {
    this.input.value = '';
    this.input.style.display = 'none';
    this.input.blur();
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
