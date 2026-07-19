import * as THREE from 'three';

const MAX_PARTICLES = 512;
const BULLET_Y = 0.9;
const GRAVITY = -9;

/**
 * 弾の消滅時などに使う軽量パーティクル (弾けて消える火花)。
 * 加算合成 + 残り寿命での減光でフェードアウトさせる。
 */
export class Particles {
  private readonly mesh: THREE.InstancedMesh;
  private readonly mat = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly colTmp = new THREE.Color();

  private readonly x = new Float32Array(MAX_PARTICLES);
  private readonly y = new Float32Array(MAX_PARTICLES);
  private readonly z = new Float32Array(MAX_PARTICLES);
  private readonly vx = new Float32Array(MAX_PARTICLES);
  private readonly vy = new Float32Array(MAX_PARTICLES);
  private readonly vz = new Float32Array(MAX_PARTICLES);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly maxLife = new Float32Array(MAX_PARTICLES);
  private readonly size = new Float32Array(MAX_PARTICLES);
  private readonly colors: THREE.Color[] = [];
  private cursor = 0;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 4),
      new THREE.MeshBasicMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      MAX_PARTICLES,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.colors.push(new THREE.Color());
    }
  }

  /** (x, y) はフィールド座標。scale で弾の大きさに応じた火花にする */
  burst(fx: number, fy: number, color: THREE.Color, scale = 1): void {
    const count = 7;
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      const ang = Math.random() * Math.PI * 2;
      const spd = 3 + Math.random() * 6;
      this.x[i] = fx;
      this.y[i] = BULLET_Y;
      this.z[i] = fy;
      this.vx[i] = Math.cos(ang) * spd;
      this.vz[i] = Math.sin(ang) * spd;
      this.vy[i] = 1 + Math.random() * 3;
      this.maxLife[i] = this.life[i] = 0.25 + Math.random() * 0.15;
      this.size[i] = (0.1 + Math.random() * 0.12) * Math.max(scale, 0.5) * 2;
      this.colors[i].copy(color);
    }
  }

  update(dt: number): void {
    let n = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
      this.vy[i] += GRAVITY * dt;
      if (this.y[i] < 0.05) this.y[i] = 0.05;

      const k = this.life[i] / this.maxLife[i];
      this.pos.set(this.x[i], this.y[i], this.z[i]);
      this.scl.setScalar(this.size[i] * (0.5 + 0.5 * k));
      this.mat.compose(this.pos, this.quat, this.scl);
      this.mesh.setMatrixAt(n, this.mat);
      // 加算合成なので黒へ近づける = フェードアウト
      this.colTmp.copy(this.colors[i]).multiplyScalar(k);
      this.mesh.setColorAt(n, this.colTmp);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
