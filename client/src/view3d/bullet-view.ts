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
  private readonly halo: THREE.InstancedMesh;
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
    const geometry = new THREE.SphereGeometry(1, 10, 8);
    this.mesh = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      MAX_BULLETS,
    );
    // 発光しているように見せるハロー (加算合成の外殻)
    this.halo = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      MAX_BULLETS,
    );
    for (const m of [this.mesh, this.halo]) {
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
    }
  }

  sync(bullets: readonly Bullet[], selfId: string): void {
    let i = 0;
    for (const b of bullets) {
      if (!b.alive) continue;
      const color = b.owner === selfId ? this.ownColor : this.ownerColor(b.owner);
      this.pos.set(b.x, BULLET_Y, b.y);
      this.scale.setScalar(b.radius);
      this.mat.compose(this.pos, this.quat, this.scale);
      this.mesh.setMatrixAt(i, this.mat);
      this.mesh.setColorAt(i, color);
      this.scale.setScalar(b.radius * 2.0);
      this.mat.compose(this.pos, this.quat, this.scale);
      this.halo.setMatrixAt(i, this.mat);
      this.halo.setColorAt(i, color);
      i++;
    }
    this.mesh.count = i;
    this.halo.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.halo.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.halo.instanceColor) this.halo.instanceColor.needsUpdate = true;
  }

  /** 弾の表示色 (パーティクル等の演出と色を合わせるために公開) */
  colorFor(owner: string, selfId: string): THREE.Color {
    return owner === selfId ? this.ownColor : this.ownerColor(owner);
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
