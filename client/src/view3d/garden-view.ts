import * as THREE from 'three';
import {
  GARDEN_DURATION_MS,
  GARDEN_FINAL_RADIUS,
  GARDEN_RADIUS,
} from '../../../shared/src/protocol';

const FINAL_FLASH_MS = 800;

interface GardenVisual {
  group: THREE.Group;
  disc: THREE.Mesh;
  rings: THREE.Mesh[];
  petals: THREE.Mesh[];
  startedAt: number;
}

interface GardenAimVisual {
  target: THREE.Group;
  guide: THREE.Line;
  guidePositions: THREE.BufferAttribute;
  label: THREE.Sprite;
  labelCanvas: HTMLCanvasElement;
  labelTexture: THREE.CanvasTexture;
  distance: number;
}

/** ブルームガーデンの魔法陣・花弁・最終開花を描画する。 */
export class GardenView {
  private readonly gardens: GardenVisual[] = [];
  private aim: GardenAimVisual | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  /** 長押し中の設置範囲・中心・自機からの距離を表示する。 */
  showAim(
    originX: number,
    originY: number,
    targetX: number,
    targetY: number,
    distance: number,
  ): void {
    const aim = this.aim ?? this.createAim();
    aim.target.visible = true;
    aim.guide.visible = true;
    aim.label.visible = true;
    aim.target.position.set(targetX, 0.12, targetY);
    aim.label.position.set(targetX, 2.6, targetY);
    aim.guidePositions.setXYZ(0, originX, 0.2, originY);
    aim.guidePositions.setXYZ(1, targetX, 0.2, targetY);
    aim.guidePositions.needsUpdate = true;
    const rounded = Math.round(distance);
    if (rounded !== aim.distance) {
      aim.distance = rounded;
      const ctx = aim.labelCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, aim.labelCanvas.width, aim.labelCanvas.height);
        ctx.fillStyle = 'rgba(15, 35, 30, 0.82)';
        ctx.roundRect(18, 10, 220, 82, 18);
        ctx.fill();
        ctx.strokeStyle = '#9dffcf';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.font = 'bold 32px sans-serif';
        ctx.fillText(`距離 ${rounded}`, 128, 48);
        ctx.fillStyle = '#b8ffe1';
        ctx.font = '18px sans-serif';
        ctx.fillText('離して発動', 128, 76);
        aim.labelTexture.needsUpdate = true;
      }
    }
  }

  hideAim(): void {
    if (!this.aim) return;
    this.aim.target.visible = false;
    this.aim.guide.visible = false;
    this.aim.label.visible = false;
  }

  private createAim(): GardenAimVisual {
    const target = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(GARDEN_RADIUS, 64),
      new THREE.MeshBasicMaterial({
        color: 0x66ffb0,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    target.add(disc);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(GARDEN_RADIUS - 0.32, GARDEN_RADIUS, 64),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    target.add(ring);
    const crossGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-2.2, 0.08, 0),
      new THREE.Vector3(2.2, 0.08, 0),
      new THREE.Vector3(0, 0.08, -2.2),
      new THREE.Vector3(0, 0.08, 2.2),
    ]);
    target.add(
      new THREE.LineSegments(
        crossGeometry,
        new THREE.LineBasicMaterial({
          color: 0xffd4f0,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );

    const guideGeometry = new THREE.BufferGeometry();
    const guidePositions = new THREE.BufferAttribute(new Float32Array(6), 3);
    guideGeometry.setAttribute('position', guidePositions);
    const guide = new THREE.Line(
      guideGeometry,
      new THREE.LineDashedMaterial({
        color: 0x9dffcf,
        transparent: true,
        opacity: 0.85,
        dashSize: 1.2,
        gapSize: 0.7,
        depthWrite: false,
      }),
    );
    guide.computeLineDistances();

    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 256;
    labelCanvas.height = 104;
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: labelTexture,
        transparent: true,
        depthWrite: false,
      }),
    );
    label.scale.set(7, 2.85, 1);
    this.scene.add(target, guide, label);
    const aim = {
      target,
      guide,
      guidePositions,
      label,
      labelCanvas,
      labelTexture,
      distance: -1,
    };
    this.aim = aim;
    return aim;
  }

  plant(x: number, y: number, startedAt: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0.08, y);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(GARDEN_RADIUS, 64),
      new THREE.MeshBasicMaterial({
        color: 0x72ffb5,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    group.add(disc);

    const rings: THREE.Mesh[] = [];
    for (const ratio of [0.38, 0.68, 1]) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(
          GARDEN_RADIUS * ratio - 0.18,
          GARDEN_RADIUS * ratio,
          64,
        ),
        new THREE.MeshBasicMaterial({
          color: ratio === 1 ? 0xffa8e8 : 0x9dffcf,
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      group.add(ring);
      rings.push(ring);
    }

    const petals: THREE.Mesh[] = [];
    for (let i = 0; i < 12; i++) {
      const petal = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 8, 5),
        new THREE.MeshBasicMaterial({
          color: i % 2 ? 0xff9cdd : 0xb8ffe1,
          transparent: true,
          opacity: 0.8,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      petal.scale.set(0.55, 0.16, 1.6);
      const a = (i / 12) * Math.PI * 2;
      petal.position.set(Math.cos(a) * 2.1, 0.28, Math.sin(a) * 2.1);
      petal.rotation.y = -a;
      group.add(petal);
      petals.push(petal);
    }
    group.scale.setScalar(0.05);
    this.scene.add(group);
    this.gardens.push({ group, disc, rings, petals, startedAt });
  }

  update(now: number): void {
    if (this.aim?.target.visible) {
      const pulse = 1 + Math.sin(now * 0.012) * 0.025;
      this.aim.target.scale.setScalar(pulse);
      this.aim.target.rotation.y = now * 0.0005;
      this.aim.guide.computeLineDistances();
    }
    for (let i = this.gardens.length - 1; i >= 0; i--) {
      const garden = this.gardens[i];
      const elapsed = now - garden.startedAt;
      const growing = Math.min(Math.max(elapsed / 450, 0), 1);
      const finalT = Math.min(
        Math.max((elapsed - GARDEN_DURATION_MS) / FINAL_FLASH_MS, 0),
        1,
      );
      const pulse = 0.5 + Math.sin(elapsed * 0.012) * 0.5;
      const normalScale = 0.05 + growing * 0.95;
      const finalScale = 1 + finalT * (GARDEN_FINAL_RADIUS / GARDEN_RADIUS - 1);
      garden.group.scale.setScalar(normalScale * finalScale);
      garden.group.rotation.y = elapsed * 0.00035;
      for (let r = 0; r < garden.rings.length; r++) {
        const material = garden.rings[r].material as THREE.MeshBasicMaterial;
        material.opacity = (0.38 + pulse * 0.28) * (1 - finalT);
        garden.rings[r].rotation.z = elapsed * (r % 2 ? -0.0005 : 0.0004);
      }
      for (let p = 0; p < garden.petals.length; p++) {
        garden.petals[p].position.y = 0.25 + Math.sin(elapsed * 0.006 + p) * 0.2;
        (garden.petals[p].material as THREE.MeshBasicMaterial).opacity =
          0.8 * (1 - finalT);
      }
      (garden.disc.material as THREE.MeshBasicMaterial).opacity =
        (0.08 + pulse * 0.06) * (1 - finalT);
      if (elapsed < GARDEN_DURATION_MS + FINAL_FLASH_MS) continue;
      this.scene.remove(garden.group);
      garden.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      });
      this.gardens.splice(i, 1);
    }
  }

  dispose(): void {
    if (this.aim) {
      this.scene.remove(this.aim.target, this.aim.guide, this.aim.label);
      this.aim.target.traverse((object) => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      });
      this.aim.guide.geometry.dispose();
      (this.aim.guide.material as THREE.Material).dispose();
      (this.aim.label.material as THREE.SpriteMaterial).dispose();
      this.aim.labelTexture.dispose();
      this.aim = null;
    }
    for (const garden of this.gardens) {
      this.scene.remove(garden.group);
      garden.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      });
    }
    this.gardens.length = 0;
  }
}
