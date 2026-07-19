/**
 * アップデート案内バナー。
 * 自分より新しいプロトコルバージョンを申告するピアを見つけたときに
 * 画面上部へ表示する。静的配信 (GitHub Pages) のためアップデートは
 * ページリロードで完結する。閉じた場合はセッション中は再表示しない。
 */
export class UpdateBannerUI {
  private shown = false;
  private dismissed = false;

  constructor(private readonly container: HTMLElement) {}

  show(): void {
    if (this.shown || this.dismissed) return;
    this.shown = true;

    const root = document.createElement('div');
    root.className = 'update-banner';

    const text = document.createElement('span');
    text.textContent = '新しいバージョンが公開されています';

    const reload = document.createElement('button');
    reload.className = 'update-banner-reload';
    reload.textContent = '更新する';
    reload.addEventListener('click', () => location.reload());

    const close = document.createElement('button');
    close.className = 'update-banner-close';
    close.textContent = '×';
    close.setAttribute('aria-label', '閉じる');
    close.addEventListener('click', () => {
      this.dismissed = true;
      this.shown = false;
      root.remove();
    });

    root.append(text, reload, close);
    this.container.appendChild(root);
  }
}
