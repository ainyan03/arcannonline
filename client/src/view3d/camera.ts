import * as THREE from 'three';

const PITCH_MIN = 0.15;
const PITCH_MAX = 1.35;
const DIST_MIN = 6;
const DIST_MAX = 80;

/** 自機を追従する俯瞰カメラ。ドラッグで回転、ホイールでズーム。 */
export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0.9;
  distance = 24;

  private mouseRotating = false;
  private lastX = 0;
  private lastY = 0;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchStartDist = 0;
  private pinchStartCamDist = 0;
  private prevAngle = 0;
  private prevCentroidY = 0;

  constructor(dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );

    // カメラ操作の割り当て:
    //   タッチ2本指 (地図/CADアプリ風): ピンチ=ズーム, ひねり=回転, 上下=チルト
    //   マウス: 右ドラッグ=回転/チルト, ホイール=ズーム
    //   ※1本指/左ドラッグはゲーム側 (移動追従) が使うためここでは触らない
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') {
        if (e.button === 2) {
          this.mouseRotating = true;
          this.lastX = e.clientX;
          this.lastY = e.clientY;
        }
        return;
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        dom.setPointerCapture(e.pointerId);
      } catch {
        /* 合成イベントは無視 */
      }
      if (this.pointers.size === 2) {
        this.pinchStartDist = this.pinchDist();
        this.pinchStartCamDist = this.distance;
        this.prevAngle = this.pinchAngle();
        this.prevCentroidY = this.centroidY();
      }
    });
    dom.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        if (!this.mouseRotating) return;
        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.rotate(dx * 0.005, dy * 0.005);
        return;
      }
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size < 2) return;

      // ズーム (ピンチ距離)
      const d = this.pinchDist();
      if (d > 10 && this.pinchStartDist > 10) {
        this.distance = THREE.MathUtils.clamp(
          (this.pinchStartCamDist * this.pinchStartDist) / d,
          DIST_MIN,
          DIST_MAX,
        );
      }
      // 回転 (2本指のひねり)
      const ang = this.pinchAngle();
      let dAng = ang - this.prevAngle;
      while (dAng > Math.PI) dAng -= Math.PI * 2;
      while (dAng < -Math.PI) dAng += Math.PI * 2;
      this.prevAngle = ang;
      // チルト (2本指そろえて上下)
      const cy = this.centroidY();
      const dCy = cy - this.prevCentroidY;
      this.prevCentroidY = cy;
      this.rotate(-dAng, dCy * 0.004);
    });
    const endTouch = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        if (e.button === 2) this.mouseRotating = false;
        return;
      }
      this.pointers.delete(e.pointerId);
    };
    dom.addEventListener('pointerup', endTouch);
    dom.addEventListener('pointercancel', endTouch);
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const k = e.deltaY > 0 ? 1.1 : 1 / 1.1;
        this.distance = THREE.MathUtils.clamp(
          this.distance * k,
          DIST_MIN,
          DIST_MAX,
        );
      },
      { passive: false },
    );
  }

  private rotate(dYaw: number, dPitch: number): void {
    this.yaw -= dYaw;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + dPitch,
      PITCH_MIN,
      PITCH_MAX,
    );
  }

  private pinchDist(): number {
    const it = this.pointers.values();
    const a = it.next().value as { x: number; y: number };
    const b = it.next().value as { x: number; y: number };
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private pinchAngle(): number {
    const it = this.pointers.values();
    const a = it.next().value as { x: number; y: number };
    const b = it.next().value as { x: number; y: number };
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  private centroidY(): number {
    let sum = 0;
    for (const p of this.pointers.values()) sum += p.y;
    return sum / this.pointers.size;
  }

  update(target: THREE.Vector3): void {
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      target.x + this.distance * cp * Math.sin(this.yaw),
      target.y + this.distance * Math.sin(this.pitch),
      target.z + this.distance * cp * Math.cos(this.yaw),
    );
    this.camera.lookAt(target.x, target.y + 1.2, target.z);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
