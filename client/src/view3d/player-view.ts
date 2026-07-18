import * as THREE from 'three';
import { colorFromString, createAvatar } from './avatar';

/**
 * プレイヤー1体の 3D 表示。sim 層の姿勢 (2D 座標 + 向き) を受け取って
 * XZ 平面へ写像する。演算には一切関与しない。
 */
export class PlayerView {
  readonly object: THREE.Group;

  private readonly hpBar: THREE.Sprite;
  private readonly hpColor = new THREE.Color();

  constructor(name: string) {
    this.object = createAvatar(colorFromString(name), name);

    // 頭上のHPバー (名前の下)。Sprite は常にカメラを向く
    const bg = new THREE.Sprite(
      new THREE.SpriteMaterial({ color: 0x222222, depthTest: false }),
    );
    bg.scale.set(1.9, 0.16, 1);
    bg.position.y = 2.15;
    this.object.add(bg);
    this.hpBar = new THREE.Sprite(
      new THREE.SpriteMaterial({ color: 0x44dd44, depthTest: false }),
    );
    this.hpBar.scale.set(1.8, 0.1, 1);
    // 左端を基準にスケールさせ、減少時に右から左へ縮むようにする
    // (既定の center=(0.5,0.5) だと両端から中央へ縮んで見える)
    this.hpBar.center.set(0, 0.5);
    this.hpBar.position.set(-0.9, 2.15, 0.001);
    this.object.add(this.hpBar);
  }

  sync(x: number, y: number, heading: number, visible = true): void {
    this.object.visible = visible;
    this.object.position.set(x, 0, y);
    this.object.rotation.y = -heading;
  }

  /** HP 割合 (0..1) をバーに反映する */
  setHp(fraction: number): void {
    const f = Math.min(Math.max(fraction, 0), 1);
    this.hpBar.scale.x = Math.max(1.8 * f, 0.02);
    // 緑 (満タン) → 赤 (瀕死)
    this.hpColor.setHSL(0.33 * f, 0.8, 0.5);
    (this.hpBar.material as THREE.SpriteMaterial).color.copy(this.hpColor);
  }
}
