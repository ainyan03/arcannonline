import * as THREE from 'three';
import type { Appearance } from '../../../shared/src/protocol';
import {
  colorFromString,
  createBody,
  HEAD_ANCHOR_Y,
  NameLabel,
} from './avatar';

/**
 * プレイヤー1体の 3D 表示。sim 層の姿勢 (2D 座標 + 向き) を受け取って
 * XZ 平面へ写像する。演算には一切関与しない。
 */
const HP_W = 128;
const HP_H = 24; // 上段: HP、下段: エネルギー (自機のみ)

export class PlayerView {
  readonly object: THREE.Group;

  private readonly body: THREE.Group;
  private readonly hpCanvas: HTMLCanvasElement;
  private readonly hpTexture: THREE.CanvasTexture;
  private lastHpFraction = -1;
  /** null のまま (リモート機) なら下段は描かない */
  private lastEnergyFraction: number | null = null;
  private readonly flashMats: THREE.MeshLambertMaterial[] = [];
  private readonly flightPhase: number;
  private readonly label: NameLabel;
  private flashing = false;

  constructor(name: string, appearance?: Appearance, idSeed?: string) {
    // ルートは位置のみを持ち、向き (rotation) は胴体だけに適用する。
    // 名前・HPバーはルート直下に置き、自機の向きで位置が回らないようにする
    this.object = new THREE.Group();
    const color = appearance?.c
      ? new THREE.Color(appearance.c)
      : colorFromString(name);
    this.body = createBody(color, appearance?.s ?? 0, appearance?.a ?? 0);
    this.flightPhase = [...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) * 0.17;
    const headAnchorY = appearance?.a === 1 ? 3.35 : HEAD_ANCHOR_Y;
    this.object.add(this.body);
    this.label = new NameLabel(name, headAnchorY, idSeed);
    this.object.add(this.label.sprite);
    // 被弾フラッシュ用に胴体のマテリアルを収集しておく
    this.body.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && (mesh.material as THREE.MeshLambertMaterial).emissive) {
        this.flashMats.push(mesh.material as THREE.MeshLambertMaterial);
      }
    });

    // 足元の影 (接地感を出す)
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 24),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.28,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.04;
    this.object.add(shadow);

    // 頭上のHPバー。複数スプライトを重ねるとカメラ角度で相対位置が
    // ずれるため、1枚のスプライトに Canvas でバーを描き込む
    this.hpCanvas = document.createElement('canvas');
    this.hpCanvas.width = HP_W;
    this.hpCanvas.height = HP_H;
    this.hpTexture = new THREE.CanvasTexture(this.hpCanvas);
    const bar = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.hpTexture,
        depthTest: false,
        transparent: true,
      }),
    );
    bar.scale.set(1.9, 0.36, 1);
    // 名前と同じアンカー点から、スクリーン空間で下方向へオフセットする
    bar.center.set(0.5, 1.15);
    bar.position.y = headAnchorY;
    this.object.add(bar);
    this.setHp(1);
  }

  /** identicon のシード (ピアID)。自機は room 生成後に判明するため後付けする */
  setIdSeed(seed: string): void {
    this.label.setIdSeed(seed);
  }

  /** 頭上ラベルの表示名を差し替える (検証済みの GitHub アカウント名) */
  setName(name: string): void {
    this.label.setName(name);
  }

  /**
   * 認証済みアバター画像を読み込んでラベルに反映する。
   * 読み込み失敗時は identicon のまま (何もしない)。
   */
  setAvatarUrl(url: string, verified: boolean): void {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => this.label.setAvatar(img, verified);
    img.src = url;
  }

  sync(x: number, y: number, heading: number, visible = true): void {
    this.object.visible = visible;
    this.object.position.set(x, 0, y);
    this.body.rotation.y = -heading;
  }

  /** 杖/箒で浮遊しているよう、描画だけを緩やかに上下させる。 */
  animate(now: number): void {
    const wave = Math.sin(now * 0.003 + this.flightPhase);
    this.body.position.y = 0.24 + wave * 0.07;
    this.body.rotation.z = wave * 0.025;
  }

  /** 被弾フラッシュ (発光) の ON/OFF。ON の間は白っぽく光る */
  setFlash(on: boolean): void {
    if (on === this.flashing) return;
    this.flashing = on;
    for (const m of this.flashMats) {
      m.emissive.setHex(on ? 0xffbbaa : 0x000000);
      m.emissiveIntensity = on ? 1.2 : 0;
    }
  }

  /** HP 割合 (0..1) をバーに反映する (左端固定で右から左へ減る) */
  setHp(fraction: number): void {
    const f = Math.min(Math.max(fraction, 0), 1);
    if (Math.abs(f - this.lastHpFraction) < 0.001) return;
    this.lastHpFraction = f;
    this.redraw();
  }

  /** エネルギー割合 (0..1)。自機のみ呼ばれ、下段の水色バーとして描く */
  setEnergy(fraction: number): void {
    const f = Math.min(Math.max(fraction, 0), 1);
    if (
      this.lastEnergyFraction !== null &&
      Math.abs(f - this.lastEnergyFraction) < 0.005
    ) {
      return;
    }
    this.lastEnergyFraction = f;
    this.redraw();
  }

  private redraw(): void {
    const ctx = this.hpCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, HP_W, HP_H);
    // 上段: HP (緑=満タン → 赤=瀕死)
    ctx.fillStyle = 'rgba(20, 20, 20, 0.75)';
    ctx.fillRect(0, 0, HP_W, 15);
    ctx.fillStyle = `hsl(${Math.round(120 * this.lastHpFraction)}, 75%, 48%)`;
    ctx.fillRect(2, 2, (HP_W - 4) * this.lastHpFraction, 11);
    // 下段: エネルギー (自機のみ)
    if (this.lastEnergyFraction !== null) {
      ctx.fillStyle = 'rgba(20, 20, 20, 0.75)';
      ctx.fillRect(0, 17, HP_W, 7);
      ctx.fillStyle = '#4db8ff';
      ctx.fillRect(2, 18, (HP_W - 4) * this.lastEnergyFraction, 5);
    }
    this.hpTexture.needsUpdate = true;
  }
}
