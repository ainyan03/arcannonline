import * as THREE from 'three';
import { MAX_BULLETS } from '../../../shared/src/protocol';
import type { Bullet } from '../sim/danmaku/engine';
import { colorFromString } from './avatar';

const BULLET_Y = 0.9;

/**
 * 弾の一括描画。InstancedMesh 1枚 + インスタンスカラーで全弾を描く。
 * 弾の色は所有者のアバター色と連動し、自弾は白寄りの明色で区別する。
 */
export class BulletView {
  private readonly mesh: THREE.InstancedMesh;
  private readonly mat = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly ownColor = new THREE.Color(0xfff2b0);
  private readonly white = new THREE.Color(0xffffff);
  private readonly colorCache = new Map<string, THREE.Color>();

  /**
   * @param resolveAppearance 所有者ID → カスタム体色 (未設定なら null) と表示名。
   *   弾の色をアバターと一致させるために使う
   */
  constructor(
    scene: THREE.Scene,
    private readonly resolveAppearance: (owner: string) => {
      color: string | null;
      name: string;
    },
  ) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      MAX_BULLETS,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  sync(bullets: readonly Bullet[], selfId: string): void {
    let i = 0;
    for (const b of bullets) {
      if (!b.alive) continue;
      this.pos.set(b.x, BULLET_Y, b.y);
      this.scale.setScalar(b.radius);
      this.mat.compose(this.pos, this.quat, this.scale);
      this.mesh.setMatrixAt(i, this.mat);
      this.mesh.setColorAt(
        i,
        b.owner === selfId ? this.ownColor : this.ownerColor(b.owner),
      );
      i++;
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** 所有者ID → 弾色。アバター色を少し白に寄せて発光弾らしくする */
  private ownerColor(owner: string): THREE.Color {
    const ap = this.resolveAppearance(owner);
    const key = ap.color ?? `n:${ap.name}`;
    let c = this.colorCache.get(key);
    if (!c) {
      c = (ap.color ? new THREE.Color(ap.color) : colorFromString(ap.name))
        .clone()
        .lerp(this.white, 0.25);
      this.colorCache.set(key, c);
    }
    return c;
  }
}
