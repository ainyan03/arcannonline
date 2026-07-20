import * as THREE from 'three';

const TRAIL_FADE_MS = 2_800;
const TRAIL_GAP_MS = 350;

interface TrailRibbon {
  ownerId: string;
  line: THREE.Line;
  glow: THREE.Line;
  points: THREE.Vector3[];
  lastAt: number;
  finishedAt: number | null;
}

/** スターダストトレイルの連続した二重リボン表示。 */
export class TrailView {
  private readonly trails: TrailRibbon[] = [];
  private readonly active = new Map<string, TrailRibbon>();

  constructor(private readonly scene: THREE.Scene) {}

  addPoint(ownerId: string, x: number, y: number, now: number): void {
    let trail = this.active.get(ownerId);
    if (!trail || now - trail.lastAt > TRAIL_GAP_MS) {
      if (trail) trail.finishedAt = trail.lastAt;
      trail = this.createTrail(ownerId, now);
      this.active.set(ownerId, trail);
    }
    trail.lastAt = now;
    trail.points.push(new THREE.Vector3(x, 0.34, y));
    trail.line.geometry.setFromPoints(trail.points);
    trail.glow.geometry.setFromPoints(trail.points);
  }

  finish(ownerId: string, now: number): void {
    const trail = this.active.get(ownerId);
    if (!trail) return;
    trail.finishedAt = now;
    this.active.delete(ownerId);
  }

  update(now: number): void {
    for (const [ownerId, trail] of this.active) {
      if (now - trail.lastAt > TRAIL_GAP_MS) {
        trail.finishedAt = trail.lastAt;
        this.active.delete(ownerId);
      }
    }
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const trail = this.trails[i];
      const fadeStart = trail.finishedAt ?? trail.lastAt;
      const fade = Math.min(Math.max((now - fadeStart) / TRAIL_FADE_MS, 0), 1);
      (trail.line.material as THREE.LineBasicMaterial).opacity = 0.9 * (1 - fade);
      (trail.glow.material as THREE.LineBasicMaterial).opacity = 0.35 * (1 - fade);
      if (fade < 1) continue;
      this.disposeTrail(trail);
      this.trails.splice(i, 1);
    }
  }

  dispose(): void {
    for (const trail of this.trails) this.disposeTrail(trail);
    this.trails.length = 0;
    this.active.clear();
  }

  private createTrail(ownerId: string, now: number): TrailRibbon {
    const line = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0xf6dcff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    line.frustumCulled = false;
    const glow = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x9b65ff,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    glow.position.y = -0.08;
    glow.scale.set(1.01, 1, 1.01);
    glow.frustumCulled = false;
    this.scene.add(glow, line);
    const trail = {
      ownerId,
      line,
      glow,
      points: [],
      lastAt: now,
      finishedAt: null,
    };
    this.trails.push(trail);
    return trail;
  }

  private disposeTrail(trail: TrailRibbon): void {
    this.scene.remove(trail.line, trail.glow);
    trail.line.geometry.dispose();
    (trail.line.material as THREE.Material).dispose();
    trail.glow.geometry.dispose();
    (trail.glow.material as THREE.Material).dispose();
  }
}
