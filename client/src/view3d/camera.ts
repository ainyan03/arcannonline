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

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchStartDist = 0;
  private pinchStartCamDist = 0;

  constructor(dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );

    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dom.setPointerCapture(e.pointerId);
      if (this.pointers.size === 2) {
        // 2本指: ピンチズーム開始 (回転ドラッグは中断)
        this.dragging = false;
        this.pinchStartDist = this.pinchDist();
        this.pinchStartCamDist = this.distance;
      } else if (this.pointers.size === 1) {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    });
    dom.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size >= 2) {
        const d = this.pinchDist();
        if (d > 10 && this.pinchStartDist > 10) {
          // 指を広げる → 近づく (ズームイン)
          this.distance = THREE.MathUtils.clamp(
            (this.pinchStartCamDist * this.pinchStartDist) / d,
            DIST_MIN,
            DIST_MAX,
          );
        }
        return;
      }
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.yaw -= dx * 0.005;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch + dy * 0.005,
        PITCH_MIN,
        PITCH_MAX,
      );
    });
    const endDrag = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 1) {
        // ピンチから片指が離れた: 残った指で回転ドラッグを継続する
        const rest = this.pointers.values().next().value as {
          x: number;
          y: number;
        };
        this.lastX = rest.x;
        this.lastY = rest.y;
        this.dragging = true;
      } else if (this.pointers.size === 0) {
        this.dragging = false;
      }
    };
    dom.addEventListener('pointerup', endDrag);
    dom.addEventListener('pointercancel', endDrag);
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

  private pinchDist(): number {
    const it = this.pointers.values();
    const a = it.next().value as { x: number; y: number };
    const b = it.next().value as { x: number; y: number };
    return Math.hypot(a.x - b.x, a.y - b.y);
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
