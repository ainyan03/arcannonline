import * as THREE from 'three';
import { colorFromString, createAvatar } from './avatar';

/**
 * プレイヤー1体の 3D 表示。sim 層の姿勢 (2D 座標 + 向き) を受け取って
 * XZ 平面へ写像する。演算には一切関与しない。
 */
export class PlayerView {
  readonly object: THREE.Group;

  constructor(name: string) {
    this.object = createAvatar(colorFromString(name), name);
  }

  sync(x: number, y: number, heading: number, visible = true): void {
    this.object.visible = visible;
    this.object.position.set(x, 0, y);
    this.object.rotation.y = -heading;
  }
}
