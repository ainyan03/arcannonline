import * as THREE from 'three';
import {
  MISSILE_STAGGER_MS,
  MISSILE_TRAVEL_MS,
} from '../../../shared/src/protocol';

/** 標的の現在の表示位置を返す (居なくなったら null) */
export type MissileTargetResolver = (
  targetId: string,
) => { x: number; y: number } | null;

/** 軌跡リボンの頂点数 (長いほど尾が伸びる) */
const TRAIL_POINTS = 18;
const CORE_COLOR = 0xe8ccff;
const GLOW_COLOR = 0xb57bff;

interface Missile {
  group: THREE.Group;
  trail: THREE.Line;
  trailGeometry: THREE.BufferGeometry;
  trailPositions: THREE.Vector3[];
  targetId: string;
  fromX: number;
  fromY: number;
  lastX: number;
  lastY: number;
  /** 横方向の膨らみ (符号込み)。個体ごとに散らして扇状の軌道にする */
  curve: number;
  startedAt: number;
  arriveAt: number;
  launched: boolean;
  done: boolean;
}

/** 放射グラデーションのハロー用テクスチャ (全ミサイル共有) */
function makeHaloTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.35, 'rgba(200, 150, 255, 0.65)');
  gradient.addColorStop(1, 'rgba(160, 90, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/**
 * 追尾ミサイルの純粋な視覚エフェクト。
 * 当たり判定・ダメージはここでは扱わない (担当ピアが到達時刻に確定する)
 * ため、軌道は各クライアントで一致していなくてよい。
 * 発射は1発ずつの時差 (MISSILE_STAGGER_MS) をつけ、連射の見た目にする。
 */
export class MissileView {
  private readonly missiles: Missile[] = [];
  private readonly coreMaterial: THREE.MeshBasicMaterial;
  private readonly haloMaterial: THREE.SpriteMaterial;
  private readonly trailMaterial: THREE.LineBasicMaterial;

  /** 到達時の演出用コールバック (爆発パーティクル等) */
  onArrive?: (x: number, y: number) => void;
  /** 各ミサイルが実際に飛び出した瞬間 (連射音などに使う) */
  onLaunch?: () => void;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly resolveTarget: MissileTargetResolver,
  ) {
    this.coreMaterial = new THREE.MeshBasicMaterial({ color: CORE_COLOR });
    this.haloMaterial = new THREE.SpriteMaterial({
      map: makeHaloTexture(),
      color: GLOW_COLOR,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.trailMaterial = new THREE.LineBasicMaterial({
      color: GLOW_COLOR,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  /** ミサイル群を発射する (index で軌道の膨らみと発射時差を散らす) */
  launch(
    fromX: number,
    fromY: number,
    targets: readonly string[],
    now: number,
    remainingMs = MISSILE_TRAVEL_MS,
  ): void {
    targets.forEach((targetId, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      const spread = 6 + (i % 3) * 5;

      const group = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.26, 8, 6),
        this.coreMaterial,
      );
      group.add(core);
      const halo = new THREE.Sprite(this.haloMaterial);
      halo.scale.set(2.6, 2.6, 1);
      group.add(halo);
      group.visible = false;
      group.position.set(fromX, 1.4, fromY);
      this.scene.add(group);

      const trailPositions = Array.from(
        { length: TRAIL_POINTS },
        () => new THREE.Vector3(fromX, 1.4, fromY),
      );
      const trailGeometry = new THREE.BufferGeometry().setFromPoints(
        trailPositions,
      );
      const trail = new THREE.Line(trailGeometry, this.trailMaterial);
      trail.visible = false;
      trail.frustumCulled = false;
      this.scene.add(trail);

      const startedAt = now + i * MISSILE_STAGGER_MS;
      this.missiles.push({
        group,
        trail,
        trailGeometry,
        trailPositions,
        targetId,
        fromX,
        fromY,
        lastX: fromX,
        lastY: fromY,
        curve: side * spread,
        startedAt,
        arriveAt: startedAt + Math.max(remainingMs, 50),
        launched: false,
        done: false,
      });
    });
  }

  /** 毎フレーム進める。二次ベジェで標的の現在表示位置へ吸い込まれる */
  update(now: number): void {
    for (const m of this.missiles) {
      if (m.done || now < m.startedAt) continue;
      if (!m.launched) {
        m.launched = true;
        m.group.visible = true;
        m.trail.visible = true;
        this.onLaunch?.();
      }
      const span = Math.max(m.arriveAt - m.startedAt, 1);
      const t = Math.min((now - m.startedAt) / span, 1);
      const target = this.resolveTarget(m.targetId);
      if (target) {
        m.lastX = target.x;
        m.lastY = target.y;
      }
      // 発射点→標的への直線に対し、垂直方向へ膨らませた制御点を取る
      const mx = (m.fromX + m.lastX) / 2;
      const my = (m.fromY + m.lastY) / 2;
      const dx = m.lastX - m.fromX;
      const dy = m.lastY - m.fromY;
      const len = Math.max(Math.hypot(dx, dy), 0.001);
      const cx = mx + (-dy / len) * m.curve;
      const cy = my + (dx / len) * m.curve;
      const u = 1 - t;
      const x = u * u * m.fromX + 2 * u * t * cx + t * t * m.lastX;
      const y = u * u * m.fromY + 2 * u * t * cy + t * t * m.lastY;
      const h = 1.4 + Math.sin(t * Math.PI) * 1.2;
      m.group.position.set(x, h, y);

      // 軌跡: 先頭へ現在位置を押し込み、古い頂点を順送りにして尾を引く
      m.trailPositions.pop();
      m.trailPositions.unshift(new THREE.Vector3(x, h, y));
      m.trailGeometry.setFromPoints(m.trailPositions);

      if (t >= 1) {
        m.done = true;
        this.scene.remove(m.group);
        this.scene.remove(m.trail);
        m.trailGeometry.dispose();
        for (const child of m.group.children) {
          if (child instanceof THREE.Mesh) child.geometry.dispose();
        }
        this.onArrive?.(m.lastX, m.lastY);
      }
    }
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      if (this.missiles[i].done) this.missiles.splice(i, 1);
    }
  }
}
