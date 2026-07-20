/**
 * 画面右下の仮想発射ボタンと魔法プリセット切替チップ。
 * ボタンは押している間 held 状態になり、ゲーム側がクールダウン毎に連射する。
 */
export class FireButtonUI {
  onHoldChange?: (held: boolean) => void;
  onCycleScript?: () => void;

  private readonly chip: HTMLButtonElement;
  private readonly btn: HTMLButtonElement;

  constructor(container: HTMLElement) {
    const btn = document.createElement('button');
    this.btn = btn;
    btn.type = 'button';
    btn.className = 'fire-btn';
    btn.textContent = '◎';
    btn.setAttribute('aria-label', '魔法を発射');
    container.appendChild(btn);

    this.chip = document.createElement('button');
    this.chip.type = 'button';
    this.chip.className = 'script-chip';
    this.chip.setAttribute('aria-label', '魔法プリセットを切り替え');
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
    btn.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('held');
        setHeld(true);
      }
    });
    btn.addEventListener('keyup', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        release();
      }
    });

    this.chip.addEventListener('click', (e) => {
      e.preventDefault();
      this.onCycleScript?.();
    });
  }

  setScriptName(name: string): void {
    this.chip.textContent = `▶ ${name}`;
  }

  /** エネルギー不足などで発射できない時に見た目を無効化する */
  setEnabled(enabled: boolean): void {
    this.btn.classList.toggle('disabled', !enabled);
    this.btn.setAttribute('aria-disabled', String(!enabled));
  }
}
