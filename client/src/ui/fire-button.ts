/**
 * 画面右下の仮想発射ボタンとスクリプト切替チップ。
 * ボタンは押している間 held 状態になり、ゲーム側がクールダウン毎に連射する。
 */
export class FireButtonUI {
  onHoldChange?: (held: boolean) => void;
  onCycleScript?: () => void;

  private readonly chip: HTMLElement;

  constructor(container: HTMLElement) {
    const btn = document.createElement('div');
    btn.className = 'fire-btn';
    btn.textContent = '◎';
    container.appendChild(btn);

    this.chip = document.createElement('div');
    this.chip.className = 'script-chip';
    container.appendChild(this.chip);

    const setHeld = (held: boolean) => this.onHoldChange?.(held);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        /* 合成イベント等で pointerId が無効な場合は無視 */
      }
      btn.classList.add('held');
      setHeld(true);
    });
    const release = () => {
      btn.classList.remove('held');
      setHeld(false);
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());

    this.chip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onCycleScript?.();
    });
  }

  setScriptName(name: string): void {
    this.chip.textContent = `▶ ${name}`;
  }
}
