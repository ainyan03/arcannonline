import { STATE_INTERVAL_MS, type Vec2 } from '../../../shared/src/protocol';
import { GameRoom } from '../net/room';
import { iceSummary } from '../net/rtc-debug';
import { FollowCamera } from './camera';
import { Keyboard } from './input';
import { LocalPlayer } from './local-player';
import { RemotePlayer } from './remote-player';
import { createWorld, type World } from './world';

const SPAWN_RANGE = 30;

/** この時間 state を受信しないリモートはゴーストとみなして除去する */
const STALE_REMOTE_MS = 10_000;

/** ゲーム全体のオーケストレーション: 描画ループ・入力・ネットワーク送受信。 */
export class Game {
  private readonly world: World;
  private readonly camera: FollowCamera;
  private readonly input = new Keyboard();
  private readonly player: LocalPlayer;
  private readonly remotes = new Map<string, RemotePlayer>();
  private readonly room: GameRoom;
  private readonly hud: HTMLElement;

  private lastFrame = 0;
  private hudTimer = 0;
  private lastSentAt = 0;
  private lastPeerAt = performance.now();
  private rejoinBackoffMs = 20_000;

  constructor(container: HTMLElement, private readonly name: string) {
    this.world = createWorld(container);
    this.camera = new FollowCamera(this.world.renderer.domElement);

    const spawn: Vec2 = {
      x: (Math.random() * 2 - 1) * SPAWN_RANGE,
      y: (Math.random() * 2 - 1) * SPAWN_RANGE,
    };
    this.player = new LocalPlayer(spawn, name);
    this.world.scene.add(this.player.object);

    this.hud = document.createElement('div');
    this.hud.className = 'hud';
    container.appendChild(this.hud);

    this.room = new GameRoom();
    // 接続確立の瞬間に1発送る: 新規参加者が、アイドル中(タイマー間引き中)の
    // 既存プレイヤーの位置も即座に受け取れるようにする
    this.room.onPeerJoin = () => this.sendStateNow();
    this.room.onState = (id, state) => {
      let remote = this.remotes.get(id);
      if (!remote) {
        remote = new RemotePlayer(state.n);
        this.remotes.set(id, remote);
        this.world.scene.add(remote.object);
        this.updateHud();
      }
      remote.pushState(state);
      // バックグラウンドタブは setInterval が最悪 1回/分 まで間引かれる
      // (Chrome の intensive throttling)。受信イベントは間引かれないため、
      // 相手からの受信を契機に生存応答を返して presence を維持する
      if (performance.now() - this.lastSentAt > 1000) {
        this.sendStateNow();
      }
    };
    this.room.onPeerLeave = (id) => {
      const remote = this.remotes.get(id);
      if (remote) {
        this.remotes.delete(id);
        this.world.scene.remove(remote.object);
      }
      this.updateHud();
    };

    window.addEventListener('resize', () => {
      this.world.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.resize(window.innerWidth / window.innerHeight);
    });
    // beforeunload はモバイルで発火しないことが多い。pagehide なら
    // 画面ロックやタブ切替による破棄・凍結時にも比較的確実に呼ばれるため、
    // ここで退室してゴースト (残留ピア情報) を残さないようにする
    window.addEventListener('pagehide', () => this.room.leave());
    // bfcache から復元された場合、凍結中に WebRTC もリレー接続も死んでいる
    // ので、再読み込みしてクリーンに再参加させる (自動参加で即復帰する)
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) location.reload();
    });

    this.updateHud();
  }

  start(): void {
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    // 状態送信は rAF から独立させる。バックグラウンドタブでは rAF が完全停止
    // するが、setInterval は (~1Hz に間引かれつつも) 動き続けるため、
    // 裏に回ったプレイヤーも相手画面から消えない。
    window.setInterval(() => {
      this.sendStateNow();
      // HUD は rAF (描画) 停止中のバックグラウンドでも最新値を保つ
      this.updateHud();
    }, STATE_INTERVAL_MS);

    // 回復ウォッチドッグ: ピアを長時間発見できない場合はルームへ入り直す。
    // リレーの不調・レート制限・ゴーストピアからの自動回復手段
    // (間隔は指数バックオフで最大5分まで延ばし、リレーへの負荷増を防ぐ)
    window.setInterval(() => {
      // 生きているピアはこちらの送信への応答 (受信駆動 keepalive) が必ず
      // 1秒以内に返る。長時間無通信のリモートは死んだ接続の残骸とみなして
      // 除去する (スマホの画面ロック等で leave なしに消えたゴースト対策)
      for (const [id, remote] of this.remotes) {
        if (performance.now() - remote.lastSeenAt > STALE_REMOTE_MS) {
          console.debug(`[game] remove stale remote ${id} (${remote.name})`);
          this.remotes.delete(id);
          this.world.scene.remove(remote.object);
        }
      }

      if (this.room.peerCount > 0) {
        this.lastPeerAt = performance.now();
        this.rejoinBackoffMs = 20_000;
        return;
      }
      if (performance.now() - this.lastPeerAt > this.rejoinBackoffMs) {
        this.lastPeerAt = performance.now();
        this.rejoinBackoffMs = Math.min(this.rejoinBackoffMs * 2, 300_000);
        for (const remote of this.remotes.values()) {
          this.world.scene.remove(remote.object);
        }
        this.remotes.clear();
        this.room.rejoin();
      }
    }, 5_000);
  }

  private frame(now: number): void {
    const dtMs = Math.min(now - this.lastFrame, 50);
    this.lastFrame = now;
    const dt = dtMs / 1000;

    this.player.update(dt, this.input.moveDir(this.camera.yaw));

    for (const remote of this.remotes.values()) remote.update();

    this.camera.update(this.player.worldPos);
    this.world.renderer.render(this.world.scene, this.camera.camera);

    this.hudTimer += dtMs;
    if (this.hudTimer >= 500) {
      this.hudTimer = 0;
      this.updateHud();
    }
  }

  private sendStateNow(): void {
    if (this.room.peerCount === 0) return;
    this.lastSentAt = performance.now();
    this.room.broadcastState(this.player.makeState());
  }

  private updateHud(): void {
    this.hud.textContent =
      `${this.name} (${this.room.selfId.slice(0, 8)})\n` +
      `relays: ${this.room.relayStatus}\n` +
      `peers: ${this.room.peerCount}\n` +
      `ice: ${iceSummary()}\n` +
      `${this.room.stats}`;
  }
}
