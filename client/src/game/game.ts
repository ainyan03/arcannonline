// オーケストレータ: sim (演算) / view3d (描画) / net (通信) を配線する。
// sim と net は描画に依存しないため、表示部を差し替えたクライアント
// (2D 描画・ヘッドレス bot 等) は view3d と本ファイル相当を置き換えれば作れる。
import * as THREE from 'three';
import { STATE_INTERVAL_MS, type Vec2 } from '../../../shared/src/protocol';
import { GameRoom } from '../net/room';
import { iceSummary } from '../net/rtc-debug';
import { LocalPlayerSim } from '../sim/local-player';
import { RemotePlayerSim } from '../sim/remote-player';
import { FollowCamera } from '../view3d/camera';
import { PlayerView } from '../view3d/player-view';
import { createWorld, type World } from '../view3d/world';
import { Keyboard } from './input';

const SPAWN_RANGE = 30;

/** この時間 state を受信しないリモートはゴーストとみなして除去する */
const STALE_REMOTE_MS = 10_000;

interface Remote {
  sim: RemotePlayerSim;
  view: PlayerView;
}

export class Game {
  private readonly world: World;
  private readonly camera: FollowCamera;
  private readonly input = new Keyboard();
  private readonly player: LocalPlayerSim;
  private readonly playerView: PlayerView;
  private readonly remotes = new Map<string, Remote>();
  private readonly room: GameRoom;
  private readonly hud: HTMLElement;
  private readonly worldPosTmp = new THREE.Vector3();

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
    this.player = new LocalPlayerSim(spawn, name);
    this.playerView = new PlayerView(name);
    this.playerView.sync(spawn.x, spawn.y, 0);
    this.world.scene.add(this.playerView.object);

    this.hud = document.createElement('div');
    this.hud.className = 'hud';
    container.appendChild(this.hud);

    this.room = new GameRoom();
    // 接続確立の瞬間に1発送る: 新規参加者が、アイドル中(タイマー間引き中)の
    // 既存プレイヤーの位置も即座に受け取れるようにする
    this.room.onPeerJoin = () => this.sendStateNow();
    this.room.onState = (id, state) => {
      const now = performance.now();
      let remote = this.remotes.get(id);
      if (!remote) {
        remote = {
          sim: new RemotePlayerSim(state.n, now),
          view: new PlayerView(state.n),
        };
        remote.view.sync(state.x, state.y, state.h, false);
        this.remotes.set(id, remote);
        this.world.scene.add(remote.view.object);
        this.updateHud();
      }
      remote.sim.push(state, now);
      // バックグラウンドタブは setInterval が最悪 1回/分 まで間引かれる
      // (Chrome の intensive throttling)。受信イベントは間引かれないため、
      // 相手からの受信を契機に生存応答を返して presence を維持する
      if (now - this.lastSentAt > 1000) {
        this.sendStateNow();
      }
    };
    this.room.onPeerLeave = (id) => {
      this.removeRemote(id);
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

    // 開発時のコンソール調査用ハンドル (本体ロジックからは参照しない)
    (window as unknown as { __blt?: unknown }).__blt = this;
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

    // 回復ウォッチドッグ: ピアを長時間発見できない場合は回復を要求する。
    // (間隔は指数バックオフで最大5分まで延ばし、リレーへの負荷増を防ぐ)
    window.setInterval(() => {
      // 長時間無通信のリモートは死んだ接続の残骸とみなして除去する
      const now = performance.now();
      for (const [id, remote] of this.remotes) {
        if (now - remote.sim.lastSeenAt > STALE_REMOTE_MS) {
          console.debug(`[game] remove stale remote ${id.slice(0, 8)}`);
          this.removeRemote(id);
        }
      }

      if (this.room.peerCount > 0) {
        this.lastPeerAt = now;
        this.rejoinBackoffMs = 20_000;
        return;
      }
      if (now - this.lastPeerAt > this.rejoinBackoffMs) {
        this.lastPeerAt = now;
        this.rejoinBackoffMs = Math.min(this.rejoinBackoffMs * 2, 300_000);
        this.room.rejoin();
      }
    }, 5_000);
  }

  private frame(now: number): void {
    const dtMs = Math.min(now - this.lastFrame, 50);
    this.lastFrame = now;
    const dt = dtMs / 1000;

    if (this.player.update(dt, this.input.moveDir(this.camera.yaw))) {
      this.playerView.sync(this.player.pos.x, this.player.pos.y, this.player.heading);
    }

    for (const remote of this.remotes.values()) {
      const s = remote.sim.sample(now);
      if (s.visible) remote.view.sync(s.x, s.y, s.h);
    }

    this.camera.update(
      this.worldPosTmp.set(this.player.pos.x, 0, this.player.pos.y),
    );
    this.world.renderer.render(this.world.scene, this.camera.camera);

    this.hudTimer += dtMs;
    if (this.hudTimer >= 500) {
      this.hudTimer = 0;
      this.updateHud();
    }
  }

  private removeRemote(id: string): void {
    const remote = this.remotes.get(id);
    if (!remote) return;
    this.remotes.delete(id);
    this.world.scene.remove(remote.view.object);
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
