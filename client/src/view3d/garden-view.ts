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

/** ブルームガーデンの魔法陣・花弁・最終開花を描画する。 */
export class GardenView {
  private readonly gardens: GardenVisual[] = [];

  constructor(private readonly scene: THREE.Scene) {}

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
