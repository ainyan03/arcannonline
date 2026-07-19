import * as THREE from 'three';

/** 画面端からのマージン (NDC)。この内側に収まっていれば「画面内」とみなす */
const EDGE = 0.93;

export interface MarkerTarget {
  name: string;
  x: number;
  z: number;
}

/**
 * 画面外にいる他プレイヤーの方向を示す外周マーカー (矢印+名前)。
 * HTML オーバーレイとして描く。画面内にいる相手のマーカーは隠す。
 */
export class EdgeMarkers {
  private readonly root: HTMLElement;
  private readonly items = new Map<
    string,
    { el: HTMLElement; arrow: HTMLElement }
  >();
  private readonly proj = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'edge-markers';
    container.appendChild(this.root);
  }

  update(
    camera: THREE.PerspectiveCamera,
    targets: Iterable<[string, MarkerTarget]>,
  ): void {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    const seen = new Set<string>();
    camera.getWorldDirection(this.camDir);

    for (const [id, target] of targets) {
      seen.add(id);
      let item = this.items.get(id);
      if (!item) {
        const el = document.createElement('div');
        el.className = 'edge-marker';
        const arrow = document.createElement('span');
        arrow.className = 'arrow';
        arrow.textContent = '▶';
        const label = document.createElement('span');
        label.textContent = target.name;
        el.append(arrow, label);
        this.root.appendChild(el);
        item = { el, arrow };
        this.items.set(id, item);
      }

      this.toTarget
        .set(target.x, 1.2, target.z)
        .sub(camera.position);
      const behind = this.toTarget.dot(this.camDir) < 0;
      this.proj.set(target.x, 1.2, target.z).project(camera);
      let sx = this.proj.x;
      let sy = this.proj.y;
      if (behind) {
        // カメラ背後の射影は反転して返るので戻す
        sx = -sx;
        sy = -sy;
      }

      const onScreen = !behind && Math.abs(sx) < EDGE && Math.abs(sy) < EDGE;
      if (onScreen) {
        item.el.style.display = 'none';
        continue;
      }

      // 画面端へクランプ
      const k = EDGE / Math.max(Math.abs(sx), Math.abs(sy), 1e-6);
      const ex = sx * k;
      const ey = sy * k;
      const px = ((ex + 1) / 2) * w;
      const py = ((1 - ey) / 2) * h;
      // CSS 座標系 (y 下向き) での外向き角度
      const angDeg = (Math.atan2(-ey, ex) * 180) / Math.PI;

      item.el.style.display = '';
      item.el.style.left = `${px}px`;
      item.el.style.top = `${py}px`;
      item.arrow.style.transform = `rotate(${angDeg}deg)`;
    }

    for (const [id, item] of this.items) {
      if (!seen.has(id)) {
        item.el.remove();
        this.items.delete(id);
      }
    }
  }
}
