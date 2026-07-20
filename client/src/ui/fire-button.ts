/**
 * 画面右下の仮想発射ボタンと、クラス固定のボム名を示すラベルチップ。
 * ボタンは押している間 held 状態になる。通常はクールダウン毎の連射、
 * ガーデンでは長押し照準とリリース確定に使われる。
 */
export class FireButtonUI {
  /** held=false の commit は通常のリリースなら true、キャンセルなら false。 */
  onHoldChange?: (held: boolean, commit: boolean) => void;

  private readonly chip: HTMLElement;
  private readonly btn: HTMLButtonElement;

  constructor(container: HTMLElement) {
    const btn = document.createElement('button');
    this.btn = btn;
    btn.type = 'button';
    btn.className = 'fire-btn';
    btn.textContent = '◎';
    btn.setAttribute('aria-label', 'ボムを発射');
    container.appendChild(btn);

    this.chip = document.createElement('div');
    this.chip.className = 'script-chip';
    container.appendChild(this.chip);

    const setHeld = (held: boolean, commit = false) =>
      this.onHoldChange?.(held, commit);
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
    const release = (commit: boolean) => {
      btn.classList.remove('held');
      setHeld(false, commit);
    };
    btn.addEventListener('pointerup', () => release(true));
    btn.addEventListener('pointercancel', () => release(false));
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
        release(true);
      }
    });
  }

  setScriptName(name: string): void {
    this.chip.textContent = `✦ ${name}`;
  }

  /** エネルギー不足などで発射できない時に見た目を無効化する */
  setEnabled(enabled: boolean): void {
    this.btn.classList.toggle('disabled', !enabled);
    this.btn.setAttribute('aria-disabled', String(!enabled));
  }
}
