const KNOB_RANGE = 40; // ノブの可動半径 (px)

/**
 * 画面左下の仮想スティック。発射ボタン (右手) と同時に使う移動手段。
 * onMove には正規化済みベクトル {x: 右+, y: 前+} を渡す。離すと null。
 */
export class StickUI {
  onMove?: (v: { x: number; y: number } | null) => void;

  private readonly knob: HTMLElement;
  private pointerId: number | null = null;
  private centerX = 0;
  private centerY = 0;

  constructor(container: HTMLElement) {
    const base = document.createElement('div');
    base.className = 'stick-base';
    this.knob = document.createElement('div');
    this.knob.className = 'stick-knob';
    base.appendChild(this.knob);
    container.appendChild(base);

    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      try {
        base.setPointerCapture(e.pointerId);
      } catch {
        /* 合成イベントは無視 */
      }
      const rect = base.getBoundingClientRect();
      this.centerX = rect.left + rect.width / 2;
      this.centerY = rect.top + rect.height / 2;
      this.update(e);
    });
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.pointerId) this.update(e);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.knob.style.transform = '';
      this.onMove?.(null);
    };
    base.addEventListener('pointerup', release);
    base.addEventListener('pointercancel', release);
    base.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private update(e: PointerEvent): void {
    let dx = e.clientX - this.centerX;
    let dy = e.clientY - this.centerY;
    const len = Math.hypot(dx, dy);
    if (len > KNOB_RANGE) {
      dx = (dx / len) * KNOB_RANGE;
      dy = (dy / len) * KNOB_RANGE;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // 画面座標は y 下向きなので、前方 (+y) へ反転して渡す
    this.onMove?.({ x: dx / KNOB_RANGE, y: -dy / KNOB_RANGE });
  }
}
