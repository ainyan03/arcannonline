// リモート機のシミュレーション。描画に依存しない純粋な演算。
// 受信スナップショットのバッファを遅延再生し、補間済みの姿勢を返す。
import type { StatePayload } from '../../../shared/src/protocol';

/** 受信スナップショットをこの時間だけ遅らせて再生し、補間を効かせる */
export const INTERP_DELAY_MS = 120;

interface Snapshot {
  t: number; // 受信時刻
  x: number;
  y: number;
  h: number;
}

export interface RemoteSample {
  x: number;
  y: number;
  h: number;
  /** まだ一度も state を受けていない間は false (位置不明) */
  visible: boolean;
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export class RemotePlayerSim {
  /** 最後に state を受信した時刻。無通信ピア (ゴースト) の除去判定に使う */
  lastSeenAt: number;

  /** 最後に受信した生の位置 (補間なし)。弾の発射元の追従などに使う */
  lastX = 0;
  lastY = 0;
  hasPos = false;

  /**
   * この相手との「時計ずれ + 最小伝送遅延」の推定値 (ms)。
   * (受信時刻 - 送信時刻) の観測最小値。相手の時計が進んでいれば負にもなる。
   * 発射イベントの遅延計算からこれを差し引くと、時計が揃っていない
   * 端末間でも正味の伝送遅延だけを見積もれる。
   */
  clockSkewMin = Infinity;

  private readonly buf: Snapshot[] = [];
  private lastSeq = -1;
  private readonly sampleTmp: RemoteSample = { x: 0, y: 0, h: 0, visible: false };

  constructor(
    readonly name: string,
    now: number,
  ) {
    this.lastSeenAt = now;
  }

  push(msg: StatePayload, now: number): void {
    this.lastSeenAt = now;
    if (msg.seq <= this.lastSeq) return; // 非順序チャネルの追い越し・重複を破棄
    this.lastSeq = msg.seq;
    this.lastX = msg.x;
    this.lastY = msg.y;
    this.hasPos = true;
    const skew = Date.now() - msg.ts;
    if (skew < this.clockSkewMin) this.clockSkewMin = skew;
    this.buf.push({ t: now, x: msg.x, y: msg.y, h: msg.h });
    if (this.buf.length > 60) this.buf.shift();
  }

  /** 現在時刻に対する補間済みの姿勢を返す (返り値は内部バッファの再利用) */
  sample(now: number): RemoteSample {
    const out = this.sampleTmp;
    const renderTime = now - INTERP_DELAY_MS;
    while (this.buf.length >= 2 && this.buf[1].t <= renderTime) {
      this.buf.shift();
    }
    if (this.buf.length === 0) return out; // visible は前回値を維持

    const a = this.buf[0];
    out.visible = true;
    if (this.buf.length >= 2) {
      const b = this.buf[1];
      const k = Math.min(Math.max((renderTime - a.t) / (b.t - a.t), 0), 1);
      out.x = lerp(a.x, b.x, k);
      out.y = lerp(a.y, b.y, k);
      out.h = lerpAngle(a.h, b.h, k);
    } else {
      out.x = a.x;
      out.y = a.y;
      out.h = a.h;
    }
    return out;
  }
}
