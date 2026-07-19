import * as THREE from 'three';
import { NPC_MAX_HP, type NpcMode } from '../../../shared/src/protocol';

/** 小型敵「ウィスプ」の軽量3D表示。演算や所有権には関与しない。 */
export class EnemyView {
  readonly object = new THREE.Group();

  private readonly body = new THREE.Group();
  private readonly hpCanvas: HTMLCanvasElement;
  private readonly hpTexture: THREE.CanvasTexture;
  private readonly phase: number;
  private hp = NPC_MAX_HP;
  private mode: NpcMode = 'spawn';

  constructor(id: string, local: boolean) {
    this.phase = [...id].reduce((n, ch) => n + ch.charCodeAt(0), 0) * 0.11;
    const main = new THREE.MeshLambertMaterial({
      color: local ? 0x9b63da : 0x7550bd,
      emissive: 0x281044,
      emissiveIntensity: 0.55,
    });
    const accent = new THREE.MeshLambertMaterial({ color: 0x63e6ff });
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

    // 耳/角と、後方へ流れる魔力の尾。
    for (const z of [-0.4, 0.4]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.48, 7), accent);
      horn.position.set(-0.02, 1.56, z);
      horn.rotation.x = z > 0 ? -0.32 : 0.32;
      this.body.add(horn);
    }
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 8), main);
    tail.rotation.z = Math.PI / 2;
    tail.position.set(-0.86, 0.98, 0);
    this.body.add(tail);
    this.object.add(this.body);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.58, 20),
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
    bar.position.y = 1.92;
    this.object.add(bar);
    this.redrawHp();
  }

  sync(x: number, y: number, heading: number, visible = true): void {
    this.object.visible = visible && this.mode !== 'dead';
    this.object.position.set(x, 0, y);
    this.body.rotation.y = -heading;
  }

  setState(hp: number, mode: NpcMode): void {
    if (hp !== this.hp) {
      this.hp = hp;
      this.redrawHp();
    }
    this.mode = mode;
    if (mode === 'dead') this.object.visible = false;
  }

  animate(now: number): void {
    const wave = Math.sin(now * 0.004 + this.phase);
    this.body.position.y = 0.22 + wave * 0.1;
    this.body.rotation.z = wave * 0.06;
    const spawnScale = this.mode === 'spawn' ? 0.72 + Math.sin(now * 0.012) * 0.08 : 1;
    this.body.scale.setScalar(spawnScale);
  }

  private redrawHp(): void {
    const ctx = this.hpCanvas.getContext('2d')!;
    const fraction = Math.min(Math.max(this.hp / NPC_MAX_HP, 0), 1);
    ctx.clearRect(0, 0, 96, 12);
    ctx.fillStyle = 'rgba(20, 12, 28, 0.8)';
    ctx.fillRect(0, 0, 96, 12);
    ctx.fillStyle = '#d86cff';
    ctx.fillRect(2, 2, 92 * fraction, 8);
    this.hpTexture.needsUpdate = true;
  }
}

