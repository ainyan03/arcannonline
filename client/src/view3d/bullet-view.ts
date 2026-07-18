import * as THREE from 'three';
import { MAX_BULLETS } from '../../../shared/src/protocol';
import type { Bullet } from '../sim/danmaku/engine';

const BULLET_Y = 0.9;

/**
 * 弾の一括描画。InstancedMesh 2枚 (自弾=暖色 / 他弾=寒色) で全弾を描く。
 */
export class BulletView {
  private readonly own: THREE.InstancedMesh;
  private readonly other: THREE.InstancedMesh;
  private readonly mat = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.SphereGeometry(1, 8, 6);
    this.own = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: 0xffb347 }),
      MAX_BULLETS,
    );
    this.other = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: 0x7fd4ff }),
      MAX_BULLETS,
    );
    for (const mesh of [this.own, this.other]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
    }
  }

  sync(bullets: readonly Bullet[], selfId: string): void {
    let o = 0;
    let x = 0;
    for (const b of bullets) {
      if (!b.alive) continue;
      const mesh = b.owner === selfId ? this.own : this.other;
      const index = b.owner === selfId ? o++ : x++;
      this.pos.set(b.x, BULLET_Y, b.y);
      this.scale.setScalar(b.radius);
      this.mat.compose(this.pos, this.quat, this.scale);
      mesh.setMatrixAt(index, this.mat);
    }
    this.own.count = o;
    this.other.count = x;
    this.own.instanceMatrix.needsUpdate = true;
    this.other.instanceMatrix.needsUpdate = true;
  }
}
