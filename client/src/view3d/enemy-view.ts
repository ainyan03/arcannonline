import * as THREE from 'three';
import { NPC_KINDS, type NpcKind, type NpcMode } from '../../../shared/src/protocol';
import { disposeObject3D } from './dispose';

/** 種別ごとの見た目パラメータ */
const KIND_LOOKS: Record<
  NpcKind,
  {
    /** 本体色 [担当分, リモート分] */
    main: [number, number];
    accent: number;
    scale: number;
    /** HP バーの色 */
    bar: string;
  }
> = {
  wisp: { main: [0x9b63da, 0x7550bd], accent: 0x63e6ff, scale: 1, bar: '#d86cff' },
  rusher: { main: [0xe05a4a, 0xc04a40], accent: 0xffb347, scale: 0.85, bar: '#ff8a5c' },
  turret: { main: [0x6a6a80, 0x585870], accent: 0xff6d8a, scale: 1.35, bar: '#a0a0c0' },
  shield: { main: [0x4a70c8, 0x3e5ea8], accent: 0x9fd8ff, scale: 1.5, bar: '#6da8ff' },
  boss: { main: [0x2c1a4a, 0x2c1a4a], accent: 0xb03060, scale: 2.6, bar: '#ff5a78' },
};

/** 小型敵の軽量3D表示。演算や所有権には関与しない。 */
export class EnemyView {
  readonly object = new THREE.Group();

  private readonly body = new THREE.Group();
  private readonly hpCanvas: HTMLCanvasElement;
  private readonly hpTexture: THREE.CanvasTexture;
  private readonly phase: number;
  /**
   * HPバーの分母。人数スケールするボスは種別の上限 (検証用) より低いHPで
   * 湧くため、実際に観測した最大HPを分母にする (湧き直後 = 満タン表示)
   */
  private maxHp = 1;
  private readonly barColor: string;
  private readonly bobAmount: number;
  private hp: number;
  private mode: NpcMode = 'spawn';

  constructor(
    id: string,
    local: boolean,
    readonly kind: NpcKind = 'wisp',
  ) {
    const look = KIND_LOOKS[kind];
    // ボス以外は種別の上限 = 湧きHP。ボスは最初の setState で実HPに合わせる
    this.maxHp = kind === 'boss' ? 1 : NPC_KINDS[kind].maxHp;
    this.hp = this.maxHp;
    this.barColor = look.bar;
    // 重い型ほど浮遊の揺れを小さくして質量感を出す
    this.bobAmount = kind === 'turret' || kind === 'shield' ? 0.04 : 0.1;
    this.phase = [...id].reduce((n, ch) => n + ch.charCodeAt(0), 0) * 0.11;
    const main = new THREE.MeshLambertMaterial({
      color: local ? look.main[0] : look.main[1],
      emissive: 0x281044,
      emissiveIntensity: 0.55,
    });
    const accent = new THREE.MeshLambertMaterial({ color: look.accent });
    const dark = new THREE.MeshLambertMaterial({ color: 0x302041 });

    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 9), main);
    orb.scale.set(1, 0.9, 1);
    orb.position.y = 1.02;
    this.body.add(orb);

    // 進行方向(+X)に大きな目を置く。
    for (const z of [-0.22, 0.22]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), dark);
      eye.scale.set(0.35, 1, 0.72);
      eye.position.set(0.59, 1.1, z);
      this.body.add(eye);
      const shine = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      );
      shine.position.set(0.64, 1.15, z - 0.025);
      this.body.add(shine);
    }

    if (kind === 'turret') {
      // 砲台型: 前方に砲身、角なし。
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.9, 8), accent);
      barrel.rotation.z = -Math.PI / 2;
      barrel.position.set(0.85, 1.02, 0);
      this.body.add(barrel);
    } else {
      // 耳/角。突進型は前傾した長い角で威嚇的に。
      const hornLen = kind === 'rusher' ? 0.68 : 0.48;
      const hornPitch = kind === 'rusher' ? 0.85 : 0;
      for (const z of [-0.4, 0.4]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.16, hornLen, 7), accent);
        horn.position.set(hornPitch * 0.25 - 0.02, 1.56, z);
        horn.rotation.x = z > 0 ? -0.32 : 0.32;
        horn.rotation.z = -hornPitch;
        this.body.add(horn);
      }
    }
    if (kind === 'shield') {
      // 重装型: 胴を囲むリング。
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.09, 8, 20), accent);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 1.02;
      this.body.add(ring);
    }
    if (kind === 'boss') {
      // ボス: 傾いた二重リングと王冠状の角で禍々しく。
      for (const [radius, tilt] of [
        [0.85, 0.35],
        [1.05, -0.5],
      ] as const) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.06, 8, 24), accent);
        ring.rotation.x = Math.PI / 2 + tilt;
        ring.position.y = 1.02;
        this.body.add(ring);
      }
      for (const angle of [-0.7, 0, 0.7]) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.62, 6), accent);
        spike.position.set(Math.sin(angle) * 0.34 - 0.15, 1.72, Math.sin(angle) * 0.3);
        spike.rotation.z = -0.25;
        this.body.add(spike);
      }
    }
    if (kind !== 'turret') {
      // 後方へ流れる魔力の尾 (砲台型は据え置きなので無し)。
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 8), main);
      tail.rotation.z = Math.PI / 2;
      tail.position.set(-0.86, 0.98, 0);
      this.body.add(tail);
    }
    this.body.scale.multiplyScalar(look.scale);
    this.object.add(this.body);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.58 * look.scale, 20),
      new THREE.MeshBasicMaterial({ color: 0x22152e, transparent: true, opacity: 0.25 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.04;
    this.object.add(shadow);

    this.hpCanvas = document.createElement('canvas');
    this.hpCanvas.width = 96;
    this.hpCanvas.height = 12;
    this.hpTexture = new THREE.CanvasTexture(this.hpCanvas);
    const bar = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.hpTexture, transparent: true, depthTest: false }),
    );
    bar.scale.set(1.35, 0.18, 1);
    bar.position.y = 1.92 * look.scale;
    this.object.add(bar);
    this.redrawHp();
  }

  sync(x: number, y: number, heading: number, visible = true): void {
    this.object.visible = visible && this.mode !== 'dead';
    this.object.position.set(x, 0, y);
    this.body.rotation.y = -heading;
  }

  setState(hp: number, mode: NpcMode, maxHp = hp): void {
    if (maxHp > this.maxHp) {
      this.maxHp = maxHp;
      this.redrawHp();
    }
    if (hp !== this.hp) {
      this.hp = hp;
      this.redrawHp();
    }
    this.mode = mode;
    if (mode === 'dead') this.object.visible = false;
  }

  animate(now: number): void {
    const wave = Math.sin(now * 0.004 + this.phase);
    this.body.position.y = 0.22 + wave * this.bobAmount;
    this.body.rotation.z = wave * 0.06;
    const spawnScale = this.mode === 'spawn' ? 0.72 + Math.sin(now * 0.012) * 0.08 : 1;
    this.body.scale.setScalar(spawnScale * KIND_LOOKS[this.kind].scale);
  }

  /** scene から外す際に、このビュー専用の WebGL リソースを解放する。 */
  dispose(): void {
    disposeObject3D(this.object);
  }

  private redrawHp(): void {
    const ctx = this.hpCanvas.getContext('2d')!;
    const fraction = Math.min(Math.max(this.hp / this.maxHp, 0), 1);
    ctx.clearRect(0, 0, 96, 12);
    ctx.fillStyle = 'rgba(20, 12, 28, 0.8)';
    ctx.fillRect(0, 0, 96, 12);
    ctx.fillStyle = this.barColor;
    ctx.fillRect(2, 2, 92 * fraction, 8);
    this.hpTexture.needsUpdate = true;
  }
}
