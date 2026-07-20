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

  update(hp: number, maxHp: number): void {
    const ratio = Math.min(Math.max(hp / maxHp, 0), 1);
    this.fill.style.width = `${ratio * 100}%`;
    this.value.textContent = hp > 0 ? `${Math.ceil(hp)} / ${maxHp}` : '消灯中';
    this.root.classList.toggle('danger', ratio <= 0.3);
    this.root.classList.toggle('down', hp <= 0);
  }
}
