import type { Vec2 } from '../../../shared/src/protocol';

const KEYMAP: Record<string, readonly [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

/** WASD / 矢印キーの移動入力。カメラの向きに相対な移動方向を返す。 */
export class Keyboard {
  private readonly pressed = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code in KEYMAP) {
        this.pressed.add(e.code);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.pressed.delete(e.code));
    window.addEventListener('blur', () => this.pressed.clear());
  }

  /** カメラの yaw を基準に、フィールド座標系での単位移動ベクトルを返す。無入力なら (0,0)。 */
  moveDir(camYaw: number): Vec2 {
    let ix = 0;
    let iy = 0;
    for (const code of this.pressed) {
      const m = KEYMAP[code];
      if (m) {
        ix += m[0];
        iy += m[1];
      }
    }
    if (ix === 0 && iy === 0) return { x: 0, y: 0 };
    return cameraRelativeDir(ix, iy, camYaw);
  }
}

/**
 * 画面基準の入力 (ix: 右+, iy: 前+) を、カメラ yaw 基準のフィールド座標系の
 * 単位ベクトルへ写像する。仮想スティックとキーボードで共用。
 */
export function cameraRelativeDir(ix: number, iy: number, camYaw: number): Vec2 {
  // カメラ前方 (2D) = (-sin yaw, -cos yaw)、右方 = (cos yaw, -sin yaw)
  const fx = -Math.sin(camYaw);
  const fy = -Math.cos(camYaw);
  const rx = Math.cos(camYaw);
  const ry = -Math.sin(camYaw);
  const x = fx * iy + rx * ix;
  const y = fy * iy + ry * ix;
  const len = Math.hypot(x, y);
  if (len < 1e-6) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}
