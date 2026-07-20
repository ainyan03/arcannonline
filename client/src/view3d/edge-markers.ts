import * as THREE from 'three';

/** 画面端からのマージン (NDC)。この内側に収まっていれば「画面内」とみなす */
const EDGE = 0.93;

/** 距離減衰: この距離以下は等倍・全濃度 */
const FADE_NEAR = 20;
/** 距離減衰: この距離以上は下限まで縮小・減光する */
const FADE_FAR = 150;

export interface MarkerTarget {
  name: string;
  x: number;
  z: number;
  /** 種別。player は矢印+名前で最前面、enemy はラベルなしの小さな警告色矢印 */
  kind: 'player' | 'enemy';
  /** 自機からの距離。遠いほどマーカーを小さく・薄くする */
  dist: number;
}

/**
 * 画面外の対象の方向を示す外周マーカー (HTML オーバーレイ)。
 * プレイヤーを優先的に見やすくする: プレイヤーは矢印+名前で敵より手前に、
 * 敵は名前なしの小さな矢印のみ (多数の「ウィスプ」表記で埋まるのを防ぐ)。
 * どちらも距離に応じて縮小・減光し、近い脅威・仲間ほど目立つ
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
        el.className = `edge-marker ${target.kind}`;
        const arrow = document.createElement('span');
        arrow.className = 'arrow';
        arrow.textContent = '▶';
        el.appendChild(arrow);
        if (target.kind === 'player') {
          const label = document.createElement('span');
          label.textContent = target.name;
          el.appendChild(label);
        }
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

      // 距離減衰 (0=至近 → 1=遠方)
      const t = Math.min(
        Math.max((target.dist - FADE_NEAR) / (FADE_FAR - FADE_NEAR), 0),
        1,
      );
      const scale = 1 - 0.45 * t;
      const opacity =
        target.kind === 'player' ? 1 - 0.4 * t : 0.9 - 0.65 * t;

      item.el.style.display = '';
      item.el.style.left = `${px}px`;
      item.el.style.top = `${py}px`;
      item.el.style.opacity = String(opacity);
      item.el.style.transform = `translate(-50%, -50%) scale(${scale})`;
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
