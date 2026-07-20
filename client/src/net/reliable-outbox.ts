const MAX_MESSAGES = 64;
const MAX_CHARS = 128 * 1024;

/** reliable DataChannelのopen待ち送信を、件数・総量の両方で制限する。 */
export class ReliableOutbox {
  private readonly queue: Array<{ data: string; key?: string }> = [];
  private chars = 0;
  dropped = 0;

  enqueue(data: string, replaceKey?: string): boolean {
    if (replaceKey) {
      const old = this.queue.find((entry) => entry.key === replaceKey);
      if (old) {
        const nextChars = this.chars - old.data.length + data.length;
        if (nextChars > MAX_CHARS) {
          this.dropped++;
          return false;
        }
        this.chars = nextChars;
        old.data = data;
        return true;
      }
    }
    if (this.queue.length >= MAX_MESSAGES || this.chars + data.length > MAX_CHARS) {
      this.dropped++;
      return false;
    }
    this.queue.push({ data, key: replaceKey });
    this.chars += data.length;
    return true;
  }

  drain(send: (data: string) => void): void {
    for (const entry of this.queue) send(entry.data);
    this.clear();
  }

  clear(): void {
    this.queue.length = 0;
    this.chars = 0;
  }

  get size(): number {
    return this.queue.length;
  }
}
