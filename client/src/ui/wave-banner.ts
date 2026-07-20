/**
 * ウェーブ告知バナー。襲来フェーズの開始時に画面中央へ大きく表示し、
 * CSS アニメーションの終了とともに自動で消える。
 */
export class WaveBannerUI {
  constructor(private readonly container: HTMLElement) {}

  show(text: string): void {
    const el = document.createElement('div');
    el.className = 'wave-banner';
    el.textContent = text;
    el.addEventListener('animationend', () => el.remove());
    this.container.appendChild(el);
  }
}
