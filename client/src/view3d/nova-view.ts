import * as THREE from 'three';
import { NOVA_RADIUS } from '../../../shared/src/protocol';

/** 衝撃波の広がる時間 */
const NOVA_EXPAND_MS = 550;

interface Nova {
  ring: THREE.Mesh;
  flash: THREE.Mesh;
  startedAt: number;
  done: boolean;
}

/**
 * スターノヴァの純粋な視覚エフェクト。中心から NOVA_RADIUS まで
 * 拡大する光のリングと、足元のフラッシュ円を描く。
 * 判定 (敵弾消去・ダメージ・ノックバック) は game 側で行う。
 */
export class NovaView {
  private readonly novas: Nova[] = [];
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private readonly flashMaterial: THREE.MeshBasicMaterial;

  constructor(private readonly scene: THREE.Scene) {
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff2a8,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffe9c8,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  burst(x: number, y: number, now: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1, 64),
      this.ringMaterial.clone(),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.4, y);
    this.scene.add(ring);
    const flash = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      this.flashMaterial.clone(),
    );
    flash.rotation.x = -Math.PI / 2;
    flash.position.set(x, 0.35, y);
    this.scene.add(flash);
    this.novas.push({ ring, flash, startedAt: now, done: false });
  }

  update(now: number): void {
    for (const nova of this.novas) {
      if (nova.done) continue;
      const t = Math.min((now - nova.startedAt) / NOVA_EXPAND_MS, 1);
      // 減速しながら広がる衝撃波 (easeOut)
      const eased = 1 - (1 - t) * (1 - t);
      const scale = Math.max(eased * NOVA_RADIUS, 0.001);
      nova.ring.scale.setScalar(scale);
      nova.flash.scale.setScalar(scale * 0.92);
      (nova.ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
      (nova.flash.material as THREE.MeshBasicMaterial).opacity =
        0.35 * (1 - t);
      if (t >= 1) {
        nova.done = true;
        this.scene.remove(nova.ring);
        this.scene.remove(nova.flash);
        nova.ring.geometry.dispose();
        (nova.ring.material as THREE.Material).dispose();
        nova.flash.geometry.dispose();
        (nova.flash.material as THREE.Material).dispose();
      }
    }
    for (let i = this.novas.length - 1; i >= 0; i--) {
      if (this.novas[i].done) this.novas.splice(i, 1);
    }
  }

  dispose(): void {
    for (const nova of this.novas) {
      this.scene.remove(nova.ring);
      this.scene.remove(nova.flash);
      nova.ring.geometry.dispose();
      (nova.ring.material as THREE.Material).dispose();
      nova.flash.geometry.dispose();
      (nova.flash.material as THREE.Material).dispose();
    }
    this.novas.length = 0;
    this.ringMaterial.dispose();
    this.flashMaterial.dispose();
  }
}
