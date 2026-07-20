/** 画面上部に常時表示する、共通拠点の耐久ゲージ。 */
export class BaseStatusUI {
  private readonly root: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly value: HTMLElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'base-status';
    const title = document.createElement('span');
    title.textContent = '✦ 魔力灯';
    const bar = document.createElement('div');
    bar.className = 'base-status-bar';
    this.fill = document.createElement('div');
    this.fill.className = 'base-status-fill';
    bar.appendChild(this.fill);
    this.value = document.createElement('span');
    this.root.append(title, bar, this.value);
    container.appendChild(this.root);
  }

  update(hp: number, maxHp: number, lit: boolean): void {
    const ratio = Math.min(Math.max(hp / maxHp, 0), 1);
    this.fill.style.width = `${ratio * 100}%`;
    // 消灯中はゲージが回復の進み具合を示す (全快で再点火)
    this.value.textContent = lit
      ? `${Math.ceil(hp)} / ${maxHp}`
      : `消灯中 (${Math.ceil(ratio * 100)}%)`;
    this.root.classList.toggle('danger', lit && ratio <= 0.3);
    this.root.classList.toggle('down', !lit);
  }
}
