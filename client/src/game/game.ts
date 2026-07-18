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
  MAX_HP,
  MAX_SCRIPT_SRC_LEN,
  STATE_INTERVAL_MS,
  TICK_MS,
  type FireEvent,
  type Vec2,
} from '../../../shared/src/protocol';
import { GameRoom } from '../net/room';
import { iceSummary } from '../net/rtc-debug';
import { BulletEngine } from '../sim/danmaku/engine';
import { parse } from '../sim/danmaku/parser';
import { ChatUI } from '../ui/chat';
import { FireButtonUI } from '../ui/fire-button';
import { ScriptEditorUI } from '../ui/script-editor';
import { StickUI } from '../ui/stick';
import { LocalPlayerSim } from '../sim/local-player';
import { RemotePlayerSim } from '../sim/remote-player';
import { BulletView } from '../view3d/bullet-view';
import { FollowCamera } from '../view3d/camera';
import { EdgeMarkers, type MarkerTarget } from '../view3d/edge-markers';
import { PlayerView } from '../view3d/player-view';
import { createWorld, type World } from '../view3d/world';
import { cameraRelativeDir, Keyboard } from './input';

const SPAWN_RANGE = 30;

/** この時間 state を受信しないリモートはゴーストとみなして除去する */
const STALE_REMOTE_MS = 10_000;

/** タップ判定: この時間・移動量以内の単押しをタップとみなす (ドラッグと区別) */
const TAP_MS = 400;
const TAP_PX = 6;

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
  private fireHeld = false;
  private downAt = 0;
  private downX = 0;
  private downY = 0;
  private readonly activePointers = new Set<number>();
  private gestureMulti = false;
  /** 移動追従中のポインタ (押している位置へ移動し続ける) */
  private followId: number | null = null;
  private stickVec: Vec2 | null = null;
  private targetId: string | null = null;
  private readonly targetRing: THREE.Mesh;
  private readonly projTmp = new THREE.Vector3();
  private readonly chat: ChatUI;
  private readonly editor: ScriptEditorUI;
  private readonly fireBtn: FireButtonUI;
  private readonly hitFlash: HTMLElement;
  private customSource: string | null = null;

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

    this.hitFlash = document.createElement('div');
    this.hitFlash.className = 'hitflash';
    container.appendChild(this.hitFlash);

    this.chat = new ChatUI(container);
    this.chat.onSend = (text) => {
      this.room.broadcastChat(text);
      this.chat.addLine(this.name, text);
    };

    // 仮想発射ボタン: 押している間はクールダウン毎に連射される
    this.fireBtn = new FireButtonUI(container);
    this.fireBtn.onHoldChange = (held) => {
      this.fireHeld = held;
      if (held) this.fire();
    };
    this.fireBtn.onCycleScript = () => this.cycleScript();

    // 仮想スティック (左下): 発射ボタンと同時に使える移動手段
    const stick = new StickUI(container);
    stick.onMove = (v) => {
      this.stickVec = v && Math.hypot(v.x, v.y) > 0.25 ? v : null;
    };

    this.editor = new ScriptEditorUI(container);
    this.editor.onApply = (source) => {
      if (source.length > MAX_SCRIPT_SRC_LEN) {
        return `スクリプトが長すぎます (${source.length}/${MAX_SCRIPT_SRC_LEN})`;
      }
      try {
        parse(source);
      } catch (err) {
        return String(err instanceof Error ? err.message : err);
      }
      this.customSource = source;
      this.scriptId = 'custom';
      this.updateHud();
      return null;
    };
    // 過去に適用したカスタムスクリプトを復元 (保存時に構文検証済み)
    const savedScript = localStorage.getItem('blt-custom-script');
    if (savedScript) this.customSource = savedScript;

    // ターゲット指定中の相手の足元に表示するリング
    this.targetRing = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.25, 32),
      new THREE.MeshBasicMaterial({ color: 0xff5544, side: THREE.DoubleSide }),
    );
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.position.y = 0.05;
    this.targetRing.visible = false;
    this.world.scene.add(this.targetRing);

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
        this.chat.addLine('', `* ${state.n} が参加しました`, true);
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
    this.room.onBulletKill = (fireId, spawnIdx) =>
      this.engine.killByFire(fireId, spawnIdx);
    this.room.onChat = (id, text) => {
      const name = this.remotes.get(id)?.sim.name ?? id.slice(0, 8);
      this.chat.addLine(name, text, text.startsWith('* '));
    };
    this.room.onPeerLeave = (id) => {
      const name = this.remotes.get(id)?.sim.name;
      if (name) this.chat.addLine('', `* ${name} が退出しました`, true);
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

    // 移動入力: キーボード > 仮想スティック > タップ地点への自動移動 (sim側)
    let move = this.input.moveDir(this.camera.yaw);
    if (move.x === 0 && move.y === 0 && this.stickVec) {
      move = cameraRelativeDir(this.stickVec.x, this.stickVec.y, this.camera.yaw);
    }
    if (this.player.update(dt, move)) {
      this.playerView.sync(this.player.pos.x, this.player.pos.y, this.player.heading);
    }

    // 仮想発射ボタンの長押し連射 (クールダウンは fire() 側で効く)
    if (this.fireHeld) this.fire();

    this.tickToNow(now);
    this.checkHits(now);

    // 無敵時間中は点滅させる
    const invuln = now < this.player.invulnUntil;
    this.playerView.object.visible = !invuln || Math.floor(now / 120) % 2 === 0;
    this.playerView.setHp(this.player.hp / MAX_HP);

    this.markerTargets.clear();
    for (const [id, remote] of this.remotes) {
      const s = remote.sim.sample(now);
      if (s.visible) {
        remote.view.sync(s.x, s.y, s.h);
        remote.view.setHp(remote.sim.hp / MAX_HP);
        this.markerTargets.set(id, { name: remote.sim.name, x: s.x, z: s.y });
        if (id === this.targetId) {
          this.targetRing.position.set(s.x, 0.05, s.y);
        }
      }
    }
    this.targetRing.visible = this.targetId !== null;

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

  // --- 被弾 (自己申告制: 自機の判定は自分だけが行う) -------------------------

  private checkHits(now: number): void {
    if (now < this.player.invulnUntil) return;
    const px = this.player.pos.x;
    const py = this.player.pos.y;
    const pr = 0.7; // 自機の当たり半径
    const bs = this.engine.bullets;
    let died = false;
    let killerId = '';
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (!b.alive || b.owner === this.room.selfId) continue;
      const dx = b.x - px;
      const dy = b.y - py;
      const rr = b.radius + pr;
      if (dx * dx + dy * dy > rr * rr) continue;
      const dead = this.player.takeHit(b.dur, now);
      this.engine.killAt(i); // 当たった弾は消費する
      // 他クライアントにも消滅を通知 (発射イベントID + 生成順で特定)
      this.room.broadcastBulletKill(b.fireId, b.spawnIdx);
      this.flashHit();
      if (dead) {
        died = true;
        killerId = b.owner;
        break;
      }
    }
    if (died) {
      const killer =
        this.remotes.get(killerId)?.sim.name ?? killerId.slice(0, 8);
      const announce = `* ${this.name} は ${killer} に撃墜されました`;
      this.chat.addLine('', announce, true);
      this.room.broadcastChat(announce);
      this.player.respawn(
        (Math.random() * 2 - 1) * SPAWN_RANGE,
        (Math.random() * 2 - 1) * SPAWN_RANGE,
        now,
      );
      this.playerView.sync(this.player.pos.x, this.player.pos.y, this.player.heading);
      this.sendStateNow();
    }
  }

  private flashHit(): void {
    this.hitFlash.classList.add('on');
    window.setTimeout(() => this.hitFlash.classList.remove('on'), 120);
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
    const source =
      this.scriptId === 'custom'
        ? this.customSource
        : (DANMAKU_SCRIPTS[this.scriptId]?.source ?? null);
    if (!source) return;
    const ev: FireEvent = {
      id: crypto.randomUUID(),
      script: this.scriptId,
      seed: (Math.random() * 0x100000000) >>> 0,
      x: this.player.pos.x,
      y: this.player.pos.y,
      dir: this.player.heading,
      at: Date.now(),
      target: this.targetId ?? undefined,
      // カスタムスクリプトはソースを同梱して他クライアントでも再現できるようにする
      src: this.scriptId === 'custom' ? source : undefined,
    };
    this.seenFireIds.add(ev.id);
    // 発射元は自機の現在位置に追従する (移動しながらの多段発射に対応)
    this.engine.startScript(
      source,
      ev.seed,
      () => this.player.pos,
      ev.dir,
      this.room.selfId,
      this.makeTargetResolver(ev.target),
      0,
      ev.id,
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
    const source =
      DANMAKU_SCRIPTS[ev.script]?.source ??
      (ev.src && ev.src.length <= MAX_SCRIPT_SRC_LEN ? ev.src : null);
    if (!source) return;
    // 伝送遅延ぶんを追いつき再生して、発射側との弾位置のずれを抑える。
    // ev.at は相手の時計なので、位置同期から推定した時計ずれを差し引いて
    // 正味の遅延に直す (時計が数秒ずれた端末間で弾が一気に出現する事故対策)
    const sim = this.remotes.get(fromId)?.sim;
    const skew =
      sim && Number.isFinite(sim.clockSkewMin) ? sim.clockSkewMin : 0;
    const delayMs = Date.now() - ev.at - skew;
    const catchup = Math.min(
      Math.max(Math.floor(delayMs / TICK_MS), 0),
      MAX_FIRE_CATCHUP_TICKS,
    );
    // 発射元は同期済みの相手最新位置に追従する。位置未受信・退室後は
    // イベントに載っている発射時位置へフォールバック
    const origin = () => {
      const sim = this.remotes.get(fromId)?.sim;
      return sim?.hasPos ? { x: sim.lastX, y: sim.lastY } : { x: ev.x, y: ev.y };
    };
    this.engine.startScript(
      source,
      ev.seed,
      origin,
      ev.dir,
      fromId,
      this.makeTargetResolver(ev.target),
      catchup,
      ev.id,
    );
  }

  /**
   * ターゲット位置の解決関数を作る。自分がターゲットなら自機の現在位置
   * (回避が正確に反映される)、他プレイヤーなら同期済みの最新位置を返す。
   */
  private makeTargetResolver(targetId?: string): () => Vec2 | null {
    if (!targetId) return () => null;
    if (targetId === this.room.selfId) return () => this.player.pos;
    return () => {
      const sim = this.remotes.get(targetId)?.sim;
      return sim?.hasPos ? { x: sim.lastX, y: sim.lastY } : null;
    };
  }

  // --- 入力 -----------------------------------------------------------------

  private setupInput(container: HTMLElement): void {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.fire();
        return;
      }
      if (e.code === 'Enter') {
        e.preventDefault();
        this.chat.open();
        return;
      }
      if (e.code === 'KeyE') {
        this.editor.toggle();
        return;
      }
      const scriptIds = Object.keys(DANMAKU_SCRIPTS);
      const digit = e.code.match(/^Digit([1-9])$/);
      if (digit) {
        const idx = Number(digit[1]) - 1;
        if (idx < scriptIds.length) {
          this.scriptId = scriptIds[idx];
          this.updateHud();
        } else if (idx === scriptIds.length && this.customSource) {
          this.scriptId = 'custom';
          this.updateHud();
        }
      }
    });

    const dom = this.world.renderer.domElement;

    // 1本指 (マウスは左ボタン) = 移動追従:
    //   押した瞬間からその地点へ移動を始め、ドラッグ中は移動先が指に追従する。
    //   離しても最後の地点へ向かい続ける (フリック移動)。
    //   プレイヤーの上で短くタップした場合はターゲット指定/解除。
    //   2本指になったらカメラ操作 (camera.ts) に譲り、追従を打ち切る。
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.activePointers.add(e.pointerId);
      if (this.activePointers.size >= 2) {
        this.gestureMulti = true;
        this.followId = null;
        return;
      }
      this.downAt = performance.now();
      this.downX = e.clientX;
      this.downY = e.clientY;
      // プレイヤーの上ならタップ判定 (pointerup) に委ねる。地面なら即移動開始
      if (this.pickRemoteAt(e.clientX, e.clientY, container)) return;
      this.followId = e.pointerId;
      const ground = this.raycastGround(e.clientX, e.clientY, container);
      if (ground) this.player.setTarget(ground.x, ground.y);
    });
    dom.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.followId || this.gestureMulti) return;
      const ground = this.raycastGround(e.clientX, e.clientY, container);
      if (ground) this.player.setTarget(ground.x, ground.y);
    });
    const endPointer = (e: PointerEvent) => {
      this.activePointers.delete(e.pointerId);
      if (e.pointerId === this.followId) this.followId = null;
      const wasMulti = this.gestureMulti;
      if (this.activePointers.size === 0) this.gestureMulti = false;
      if (wasMulti) return; // ピンチ/回転操作の指離しはタップ扱いしない
      // プレイヤーへの短いタップ = ターゲット指定/解除
      const dt = performance.now() - this.downAt;
      const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
      if (dt > TAP_MS || moved > TAP_PX) return;
      const hit = this.pickRemoteAt(e.clientX, e.clientY, container);
      if (hit) {
        this.targetId = this.targetId === hit ? null : hit;
        this.updateHud();
      }
    };
    dom.addEventListener('pointerup', endPointer);
    dom.addEventListener('pointercancel', endPointer);
  }

  /** 発射スクリプトを次へ切り替える (仮想ボタン横のチップ用) */
  private cycleScript(): void {
    const ids = Object.keys(DANMAKU_SCRIPTS);
    if (this.customSource) ids.push('custom');
    const idx = ids.indexOf(this.scriptId);
    this.scriptId = ids[(idx + 1) % ids.length];
    this.updateHud();
  }

  /** 画面座標に一番近い他プレイヤーを拾う (しきい値以内)。ID を返す */
  private pickRemoteAt(
    clientX: number,
    clientY: number,
    container: HTMLElement,
  ): string | null {
    const w = container.clientWidth;
    const h = container.clientHeight;
    let best: string | null = null;
    let bestDist = 40; // px
    for (const [id, remote] of this.remotes) {
      if (!remote.view.object.visible) continue;
      const p = remote.view.object.position;
      this.projTmp.set(p.x, 1.0, p.z).project(this.camera.camera);
      if (this.projTmp.z > 1) continue; // カメラ背後
      const sx = ((this.projTmp.x + 1) / 2) * w;
      const sy = ((1 - this.projTmp.y) / 2) * h;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    return best;
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
    if (this.targetId === id) {
      this.targetId = null;
      this.updateHud();
    }
  }

  private sendStateNow(): void {
    if (this.room.peerCount === 0) return;
    this.lastSentAt = performance.now();
    this.room.broadcastState(this.player.makeState());
  }

  private updateHud(): void {
    const scriptName =
      this.scriptId === 'custom'
        ? '自作スクリプト'
        : (DANMAKU_SCRIPTS[this.scriptId]?.name ?? this.scriptId);
    this.fireBtn.setScriptName(scriptName);
    const targetName = this.targetId
      ? (this.remotes.get(this.targetId)?.sim.name ?? '?')
      : 'なし (クリックで指定)';
    this.hud.textContent =
      `${this.name} (${this.room.selfId.slice(0, 8)})\n` +
      `HP: ${this.player.hp}/${MAX_HP}\n` +
      `relays: ${this.room.relayStatus}\n` +
      `peers: ${this.room.peerCount}\n` +
      `ice: ${iceSummary()}\n` +
      `${this.room.stats}\n` +
      `bullets: ${this.engine.aliveCount}\n` +
      `[Space]発射 [1-5]切替: ${scriptName}\n` +
      `[Enter]チャット [E]スクリプト編集\n` +
      `target: ${targetName}`;
  }
}
