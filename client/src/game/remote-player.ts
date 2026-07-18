import * as THREE from 'three';
import type { P2PStateMessage, PeerInfo } from '../../../shared/src/protocol';
import { colorFromString, createAvatar } from './avatar';

/** 受信スナップショットをこの時間だけ遅らせて再生し、補間を効かせる */
export const INTERP_DELAY_MS = 120;

interface Snapshot {
  t: number; // 受信時刻 (performance.now)
  x: number;
  y: number;
  h: number;
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/** リモート機。スナップショットバッファを遅延再生して滑らかに補間する。 */
export class RemotePlayer {
  readonly object: THREE.Group;

  private readonly buf: Snapshot[] = [];
  private lastSeq = -1;

  constructor(readonly info: PeerInfo) {
    this.object = createAvatar(colorFromString(info.name), info.name);
    this.object.position.set(info.pos.x, 0, info.pos.y);
  }

  pushState(msg: P2PStateMessage): void {
    if (msg.seq <= this.lastSeq) return; // 非順序チャネルの追い越しを破棄
    this.lastSeq = msg.seq;
    this.buf.push({ t: performance.now(), x: msg.x, y: msg.y, h: msg.h });
    if (this.buf.length > 60) this.buf.shift();
  }

  update(): void {
    const renderTime = performance.now() - INTERP_DELAY_MS;
    while (this.buf.length >= 2 && this.buf[1].t <= renderTime) {
      this.buf.shift();
    }
    if (this.buf.length === 0) return;

    const a = this.buf[0];
    let x = a.x;
    let y = a.y;
    let h = a.h;
    if (this.buf.length >= 2) {
      const b = this.buf[1];
      const k = THREE.MathUtils.clamp(
        (renderTime - a.t) / (b.t - a.t),
        0,
        1,
      );
      x = THREE.MathUtils.lerp(a.x, b.x, k);
      y = THREE.MathUtils.lerp(a.y, b.y, k);
      h = lerpAngle(a.h, b.h, k);
    }
    this.object.position.set(x, 0, y);
    this.object.rotation.y = -h;
  }
}
