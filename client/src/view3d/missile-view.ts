import * as THREE from 'three';
import { MISSILE_TRAVEL_MS } from '../../../shared/src/protocol';

/** 標的の現在の表示位置を返す (居なくなったら null) */
export type MissileTargetResolver = (
  targetId: string,
) => { x: number; y: number } | null;

interface Missile {
  head: THREE.Mesh;
  targetId: string;
  /** 発射位置 */
  fromX: number;
  fromY: number;
  /** 最後に見えた標的位置 (標的消滅後はここへ飛び込む) */
  lastX: number;
  lastY: number;
  /** 横方向の膨らみ (符号込み)。個体ごとに散らして扇状の軌道にする */
  curve: number;
  startedAt: number;
  arriveAt: number;
  done: boolean;
}

/**
 * 追尾ミサイルの純粋な視覚エフェクト。
 * 当たり判定・ダメージはここでは扱わない (担当ピアが到達時刻に確定する)
 * ため、軌道は各クライアントで一致していなくてよい。
 */
export class MissileView {
  private readonly missiles: Missile[] = [];
  private readonly material: THREE.MeshBasicMaterial;

  /** 到達時の演出用コールバック (爆発パーティクル等) */
  onArrive?: (x: number, y: number) => void;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly resolveTarget: MissileTargetResolver,
  ) {
    this.material = new THREE.MeshBasicMaterial({ color: 0xbf99ff });
  }

  /** ミサイル群を発射する (index で軌道の膨らみを左右へ散らす) */
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
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 8, 6),
        this.material,
      );
      head.position.set(fromX, 1.4, fromY);
      this.scene.add(head);
      this.missiles.push({
        head,
        targetId,
        fromX,
        fromY,
        lastX: fromX,
        lastY: fromY,
        curve: side * spread,
        startedAt: now,
        arriveAt: now + Math.max(remainingMs, 50),
        done: false,
      });
    });
  }

  /** 毎フレーム進める。二次ベジェで標的の現在表示位置へ吸い込まれる */
  update(now: number): void {
    for (const m of this.missiles) {
      if (m.done) continue;
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
      m.head.position.set(x, 1.4 + Math.sin(t * Math.PI) * 1.2, y);
      if (t >= 1) {
        m.done = true;
        this.scene.remove(m.head);
        m.head.geometry.dispose();
        this.onArrive?.(m.lastX, m.lastY);
      }
    }
    // 終了分をまとめて除去
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      if (this.missiles[i].done) this.missiles.splice(i, 1);
    }
  }
}
