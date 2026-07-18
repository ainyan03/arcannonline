// オーケストレータ: sim (演算) / view3d (描画) / net (通信) を配線する。
// sim と net は描画に依存しないため、表示部を差し替えたクライアント
// (2D 描画・ヘッドレス bot 等) は view3d と本ファイル相当を置き換えれば作れる。
import * as THREE from 'three';
import {
  DANMAKU_SCRIPTS,
  DEFAULT_SCRIPT_ID,
} from '../../../shared/src/danmaku-scripts';
import {
  FIRE_COOLDOWN_MS,
  MAX_FIRE_CATCHUP_TICKS,
  STATE_INTERVAL_MS,
  TICK_MS,
  type FireEvent,
  type Vec2,
} from '../../../shared/src/protocol';
import { GameRoom } from '../net/room';
import { iceSummary } from '../net/rtc-debug';
import { BulletEngine } from '../sim/danmaku/engine';
import { LocalPlayerSim } from '../sim/local-player';
import { RemotePlayerSim } from '../sim/remote-player';
import { BulletView } from '../view3d/bullet-view';
import { FollowCamera } from '../view3d/camera';
import { EdgeMarkers, type MarkerTarget } from '../view3d/edge-markers';
import { PlayerView } from '../view3d/player-view';
import { createWorld, type World } from '../view3d/world';
import { Keyboard } from './input';

const SPAWN_RANGE = 30;

/** この時間 state を受信しないリモートはゴーストとみなして除去する */
const STALE_REMOTE_MS = 10_000;

/** ダブルタップ判定: 2回目のタップがこの時間・距離以内 */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 30;

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
  private readonly engine = new BulletEngine();
  private readonly bulletView: BulletView;
  private readonly markers: EdgeMarkers;
  private readonly worldPosTmp = new THREE.Vector3();
  private readonly rayTmp = new THREE.Vector3();
  private readonly markerTargets = new Map<string, MarkerTarget>();
  private readonly seenFireIds = new Set<string>();

  private lastFrame = 0;
  private hudTimer = 0;
  private lastSentAt = 0;
  private lastPeerAt = performance.now();
  private rejoinBackoffMs = 20_000;
  private lastTickTime = performance.now();
  private scriptId = DEFAULT_SCRIPT_ID;
  private lastFireAt = 0;
  private lastTapAt = 0;
  private lastTapX = 0;
  private lastTapY = 0;

  constructor(container: HTMLElement, private readonly name: string) {
    this.world = createWorld(container);
    this.camera = new FollowCamera(this.world.renderer.domElement);
    this.bulletView = new BulletView(this.world.scene);
    this.markers = new EdgeMarkers(container);

    const spawn: Vec2 = {
      x: (Math.random() * 2 - 1) * SPAWN_RANGE,
      y: (Math.random() * 2 - 1) * SPAWN_RANGE,
    };
    this.player = new LocalPlayerSim(spawn, name);
    this.playerView = new PlayerView(name);
    this.playerView.sync(spawn.x, spawn.y, 0);
    this.world.scene.add(this.playerView.object);
    // 初回フレーム前でもレイキャスト等が正しく動くようカメラを初期化する
    this.camera.update(this.worldPosTmp.set(spawn.x, 0, spawn.y));
    this.camera.camera.updateMatrixWorld();

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
    this.room.onFire = (id, ev) => this.handleRemoteFire(id, ev);
    this.room.onPeerLeave = (id) => {
      this.removeRemote(id);
      this.updateHud();
    };

    this.setupInput(container);

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
      // 弾幕 tick と HUD は rAF (描画) 停止中のバックグラウンドでも進める
      this.tickToNow(performance.now());
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

    this.tickToNow(now);

    this.markerTargets.clear();
    for (const [id, remote] of this.remotes) {
      const s = remote.sim.sample(now);
      if (s.visible) {
        remote.view.sync(s.x, s.y, s.h);
        this.markerTargets.set(id, { name: remote.sim.name, x: s.x, z: s.y });
      }
    }

    this.bulletView.sync(this.engine.bullets, this.room.selfId);

    this.camera.update(
      this.worldPosTmp.set(this.player.pos.x, 0, this.player.pos.y),
    );
    this.world.renderer.render(this.world.scene, this.camera.camera);
    this.markers.update(this.camera.camera, this.markerTargets);

    this.hudTimer += dtMs;
    if (this.hudTimer >= 500) {
      this.hudTimer = 0;
      this.updateHud();
    }
  }

  // --- 弾幕 -----------------------------------------------------------------

  /**
   * 弾幕シミュレーションを実時間に追いつかせる (固定タイムステップ)。
   * rAF と setInterval の両方から呼ばれるため、バックグラウンドタブでも
   * (間引かれた setInterval の頻度で) シミュレーションが進み続ける。
   */
  private tickToNow(now: number): void {
    let behind = now - this.lastTickTime;
    if (behind > 5_000) {
      // 長時間の停止後は5秒ぶんだけ追いつく (spiral of death 回避)
      this.lastTickTime = now - 5_000;
      behind = 5_000;
    }
    while (behind >= TICK_MS) {
      this.engine.tick();
      this.lastTickTime += TICK_MS;
      behind -= TICK_MS;
    }
  }

  private fire(): void {
    const now = performance.now();
    if (now - this.lastFireAt < FIRE_COOLDOWN_MS) return;
    this.lastFireAt = now;
    const script = DANMAKU_SCRIPTS[this.scriptId];
    if (!script) return;
    const ev: FireEvent = {
      id: crypto.randomUUID(),
      script: this.scriptId,
      seed: (Math.random() * 0x100000000) >>> 0,
      x: this.player.pos.x,
      y: this.player.pos.y,
      dir: this.player.heading,
      at: Date.now(),
    };
    this.seenFireIds.add(ev.id);
    this.engine.startScript(
      script.source,
      ev.seed,
      ev.x,
      ev.y,
      ev.dir,
      this.room.selfId,
    );
    this.room.broadcastFire(ev);
  }

  private handleRemoteFire(fromId: string, ev: FireEvent): void {
    if (this.seenFireIds.has(ev.id)) return;
    this.seenFireIds.add(ev.id);
    if (this.seenFireIds.size > 1000) {
      const it = this.seenFireIds.values();
      for (let i = 0; i < 500; i++) this.seenFireIds.delete(it.next().value as string);
    }
    const script = DANMAKU_SCRIPTS[ev.script];
    if (!script) return;
    // 伝送遅延ぶんを追いつき再生して、発射側との弾位置のずれを抑える
    const catchup = Math.min(
      Math.max(Math.floor((Date.now() - ev.at) / TICK_MS), 0),
      MAX_FIRE_CATCHUP_TICKS,
    );
    this.engine.startScript(
      script.source,
      ev.seed,
      ev.x,
      ev.y,
      ev.dir,
      fromId,
      catchup,
    );
  }

  // --- 入力 -----------------------------------------------------------------

  private setupInput(container: HTMLElement): void {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.fire();
        return;
      }
      const scriptIds = Object.keys(DANMAKU_SCRIPTS);
      const digit = e.code.match(/^Digit([1-9])$/);
      if (digit) {
        const idx = Number(digit[1]) - 1;
        if (idx < scriptIds.length) {
          this.scriptId = scriptIds[idx];
          this.updateHud();
        }
      }
    });

    // ダブルタップ (ダブルクリック) した地点への自動移動。スマホ対応のため
    // dblclick イベントではなく pointerdown 2連で自前判定する
    this.world.renderer.domElement.addEventListener('pointerdown', (e) => {
      const now = performance.now();
      const isDouble =
        now - this.lastTapAt < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - this.lastTapX, e.clientY - this.lastTapY) <
          DOUBLE_TAP_PX;
      this.lastTapAt = now;
      this.lastTapX = e.clientX;
      this.lastTapY = e.clientY;
      if (!isDouble) return;
      const ground = this.raycastGround(e.clientX, e.clientY, container);
      if (ground) this.player.setTarget(ground.x, ground.y);
    });
  }

  /** 画面座標から地面 (y=0 平面) 上のフィールド座標を求める */
  private raycastGround(
    clientX: number,
    clientY: number,
    container: HTMLElement,
  ): Vec2 | null {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const cam = this.camera.camera;
    this.rayTmp
      .set((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1, 0.5)
      .unproject(cam)
      .sub(cam.position)
      .normalize();
    if (this.rayTmp.y >= -1e-6) return null; // 地平線より上
    const t = -cam.position.y / this.rayTmp.y;
    return {
      x: cam.position.x + this.rayTmp.x * t,
      y: cam.position.z + this.rayTmp.z * t,
    };
  }

  // --- その他 ---------------------------------------------------------------

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
    const script = DANMAKU_SCRIPTS[this.scriptId];
    this.hud.textContent =
      `${this.name} (${this.room.selfId.slice(0, 8)})\n` +
      `relays: ${this.room.relayStatus}\n` +
      `peers: ${this.room.peerCount}\n` +
      `ice: ${iceSummary()}\n` +
      `${this.room.stats}\n` +
      `bullets: ${this.engine.aliveCount}\n` +
      `[Space]発射 [1-3]切替: ${script?.name ?? this.scriptId}`;
  }
}
