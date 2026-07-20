// ヘッドレス bot モード (?bot=1 で起動)。負荷試験用:
// 描画なしでルームに参加し、ランダム徘徊と定期発射を行う。
// 通常クライアントと同様に担当NPCもホストし (AI・5Hz配信・NPC発射)、
// 複数起動すれば「プレイヤーN + 敵4N」のフルクライアントN機分の負荷を再現できる。
// 弾エンジンは持たないため bot の NPC は被弾しない (常時満数 = 負荷の上限側)。
import {
  DANMAKU_SCRIPTS,
} from '../../shared/src/danmaku-scripts';
import {
  NPC_FIRE_SCRIPT_ID,
} from '../../shared/src/npc-scripts';
import {
  FIELD_SIZE,
  NPC_STATE_INTERVAL_MS,
  NPCS_PER_PEER,
  STATE_INTERVAL_MS,
  type FireEvent,
} from '../../shared/src/protocol';
import { GameRoom } from './net/room';
import { LocalPlayerSim } from './sim/local-player';
import { LocalNpcSim, type NpcTarget } from './sim/npc';

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
    // bot はランダムな見た目で参加する
    {
      s: Math.floor(Math.random() * 4),
      c: `#${Math.floor(Math.random() * 0xffffff)
        .toString(16)
        .padStart(6, '0')}`,
      a: Math.floor(Math.random() * 3),
    },
  );

  let sent = 0;
  let fired = 0;
  let npcFired = 0;

  // 担当NPC: 通常クライアントと同数をホストする
  const npcs = Array.from(
    { length: NPCS_PER_PEER },
    (_, i) => new LocalNpcSim(`${room.selfId}:npc:${i}`, performance.now()),
  );
  // NPC の追跡対象にするため、リモートの最新位置を保持する
  const remotePos = new Map<string, { x: number; y: number; at: number }>();
  room.onState = (id, state) => {
    remotePos.set(id, { x: state.x, y: state.y, at: performance.now() });
  };

  const fireNpc = (npc: LocalNpcSim, targetId: string, tx: number, ty: number) => {
    room.broadcastFire({
      id: crypto.randomUUID(),
      script: NPC_FIRE_SCRIPT_ID,
      seed: (Math.random() * 0x100000000) >>> 0,
      x: npc.pos.x,
      y: npc.pos.y,
      dir: Math.atan2(ty - npc.pos.y, tx - npc.pos.x),
      at: Date.now(),
      target: targetId,
      tx,
      ty,
      npc: npc.id,
    });
    npcFired++;
  };

  // 移動と状態送信 (バックグラウンドタブでは自動的に間引かれる)
  let last = performance.now();
  let lastNpcSentAt = 0;
  setInterval(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.5);
    last = now;
    sim.update(dt, { x: 0, y: 0 });
    if (room.peerCount > 0) {
      room.broadcastState(sim.makeState());
      sent++;
    }

    // 担当NPCのAIを進める (追跡対象 = 自分 + 既知のリモート)
    const targets: NpcTarget[] = [{ id: room.selfId, pos: sim.pos }];
    for (const [id, p] of remotePos) {
      if (now - p.at > 10_000) remotePos.delete(id);
      else targets.push({ id, pos: p });
    }
    for (const npc of npcs) {
      const attack = npc.update(dt, now, targets);
      if (attack) fireNpc(npc, attack.targetId, attack.targetPos.x, attack.targetPos.y);
    }
    if (room.peerCount > 0 && now - lastNpcSentAt >= NPC_STATE_INTERVAL_MS) {
      lastNpcSentAt = now;
      room.broadcastNpcs(npcs.map((npc) => npc.makeState()));
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
      `state sent: ${sent}  fired: ${fired}\n` +
      `npcs: ${npcs.length}  npc fired: ${npcFired}`;
  }, 500);

  window.addEventListener('pagehide', () => room.leave());
}
