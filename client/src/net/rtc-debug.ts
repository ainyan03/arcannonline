// WebRTC 接続の診断機構。RTCPeerConnection を差し替えて、ページ内で生成される
// 全接続の ICE 状態遷移と採用経路を観測する。
// 「シグナリングは届くのに映らない」= ICE 失敗 (AP間分離・NAT非対応等) の
// 切り分けを現地の HUD / コンソールだけで行えるようにするための試作用機構。

const live = new Set<RTCPeerConnection>();
let seq = 0;

/** HUD 表示用: 現在生きている接続の ICE 状態の内訳 (例 "connected:2 checking:1") */
export function iceSummary(): string {
  const counts = new Map<string, number>();
  for (const pc of live) {
    const s = pc.iceConnectionState;
    if (s === 'new') continue; // ネゴシエーション開始前の接続は表示しない
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  if (counts.size === 0) return '-';
  return [...counts.entries()].map(([k, v]) => `${k}:${v}`).join(' ');
}

async function logRoute(pc: RTCPeerConnection, tag: string): Promise<void> {
  try {
    const stats = await pc.getStats();
    const candidates = new Map<string, { candidateType?: string }>();
    let pair: { localCandidateId?: string; remoteCandidateId?: string } | null =
      null;
    stats.forEach((r) => {
      if (r.type === 'local-candidate' || r.type === 'remote-candidate') {
        candidates.set(r.id, r as { candidateType?: string });
      }
      if (
        r.type === 'candidate-pair' &&
        (r as { state?: string }).state === 'succeeded' &&
        ((r as { selected?: boolean }).selected ||
          (r as { nominated?: boolean }).nominated)
      ) {
        pair = r as { localCandidateId?: string; remoteCandidateId?: string };
      }
    });
    if (pair) {
      const p = pair as { localCandidateId?: string; remoteCandidateId?: string };
      const local = candidates.get(p.localCandidateId ?? '')?.candidateType;
      const remote = candidates.get(p.remoteCandidateId ?? '')?.candidateType;
      console.info(`[rtc ${tag}] route: ${local} -> ${remote}`);
    }
  } catch {
    /* stats が取れない環境では黙ってスキップ */
  }
}

/** RTCPeerConnection を診断付きに差し替える。Game 初期化より前に一度だけ呼ぶ */
export function installRtcDebug(): void {
  const Native = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Native {
    constructor(config?: RTCConfiguration) {
      super(config);
      const tag = `#${++seq}`;
      live.add(this);
      this.addEventListener('iceconnectionstatechange', () => {
        const s = this.iceConnectionState;
        console.debug(`[rtc ${tag}] ice: ${s}`);
        if (s === 'connected' || s === 'completed') {
          void logRoute(this, tag);
        } else if (s === 'failed') {
          console.warn(
            `[rtc ${tag}] ICE 失敗: 直接経路を確立できません` +
              ' (無線APのプライバシーセパレーター/NAT hairpin 非対応の可能性)',
          );
        } else if (s === 'closed') {
          live.delete(this);
        }
      });
      this.addEventListener('connectionstatechange', () => {
        if (this.connectionState === 'closed') live.delete(this);
      });
    }
  };
}
