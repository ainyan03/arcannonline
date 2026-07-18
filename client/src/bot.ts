// ヘッドレス bot モード (?bot=1 で起動)。負荷試験用:
// 描画なしでルームに参加し、ランダム徘徊と定期発射を行う。
// 複数タブで開けば多人数接続の負荷を再現できる。
import {
  DANMAKU_SCRIPTS,
} from '../../shared/src/danmaku-scripts';
import {
  FIELD_SIZE,
  STATE_INTERVAL_MS,
  type FireEvent,
} from '../../shared/src/protocol';
import { GameRoom } from './net/room';
import { LocalPlayerSim } from './sim/local-player';

const WANDER_RANGE = FIELD_SIZE / 2 - 20;

export function startBot(): void {
  const name = `bot${Math.floor(Math.random() * 1000)}`;
  const status = document.createElement('pre');
  status.style.cssText = 'color:#8f8;background:#111;margin:0;padding:16px;height:100vh;font:12px/1.6 monospace';
  document.body.appendChild(status);

  const room = new GameRoom();
  const sim = new LocalPlayerSim(
    {
      x: (Math.random() * 2 - 1) * 30,
      y: (Math.random() * 2 - 1) * 30,
    },
    name,
  );

  let sent = 0;
  let fired = 0;

  // 移動と状態送信 (バックグラウンドタブでは自動的に間引かれる)
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.5);
    last = now;
    sim.update(dt, { x: 0, y: 0 });
    if (room.peerCount > 0) {
      room.broadcastState(sim.makeState());
      sent++;
    }
  }, STATE_INTERVAL_MS);

  // 徘徊先の更新
  const newWaypoint = () =>
    sim.setTarget(
      (Math.random() * 2 - 1) * WANDER_RANGE,
      (Math.random() * 2 - 1) * WANDER_RANGE,
    );
  newWaypoint();
  setInterval(newWaypoint, 4_000 + Math.random() * 4_000);

  // 定期発射
  setInterval(() => {
    if (room.peerCount === 0) return;
    const ids = Object.keys(DANMAKU_SCRIPTS);
    const scriptId = ids[Math.floor(Math.random() * ids.length)];
    const ev: FireEvent = {
      id: crypto.randomUUID(),
      script: scriptId,
      seed: (Math.random() * 0x100000000) >>> 0,
      x: sim.pos.x,
      y: sim.pos.y,
      dir: sim.heading,
      at: Date.now(),
    };
    room.broadcastFire(ev);
    fired++;
  }, 5_000 + Math.random() * 5_000);

  setInterval(() => {
    status.textContent =
      `BOT MODE: ${name} (${room.selfId.slice(0, 8)})\n` +
      `relays: ${room.relayStatus}\n` +
      `peers:  ${room.peerCount}\n` +
      `${room.stats}\n` +
      `pos: (${sim.pos.x.toFixed(1)}, ${sim.pos.y.toFixed(1)})\n` +
      `state sent: ${sent}  fired: ${fired}`;
  }, 500);

  window.addEventListener('pagehide', () => room.leave());
}
