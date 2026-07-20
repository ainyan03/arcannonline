// オーケストレータ: sim (演算) / view3d (描画) / net (通信) を配線する。
// sim と net は描画に依存しないため、表示部を差し替えたクライアント
// (2D 描画・ヘッドレス bot 等) は view3d と本ファイル相当を置き換えれば作れる。
import * as THREE from 'three';
import {
  DANMAKU_SCRIPTS,
  DEFAULT_SCRIPT_ID,
  NORMAL_SHOT_SCRIPT_ID,
  NORMAL_SHOT_SCRIPT_SOURCE,
} from '../../../shared/src/danmaku-scripts';
import {
  NPC_FIRE_SCRIPT_ID,
  NPC_RUSHER_SCRIPT_ID,
  NPC_SCRIPT_SOURCES,
  NPC_TURRET_SCRIPT_ID,
} from '../../../shared/src/npc-scripts';
import {
  AUTO_SHOT_COOLDOWN_MS,
  AUTO_SHOT_RANGE,
  BASE_HIT_RADIUS,
  BASE_ID,
  BASE_MAX_HP,
  BULLET_INHERIT_VELOCITY,
  ENERGY_MAX,
  FIRE_COOLDOWN_MS,
  MAX_FIRE_CATCHUP_TICKS,
  MAX_HP,
  NPC_KINDS,
  NPC_STATE_INTERVAL_MS,
  NPCS_PER_PEER,
  PROTO_VERSION,
  STATE_INTERVAL_MS,
  TICK_MS,
  type Appearance,
  type BaseHitEvent,
  type FireEvent,
  type NpcKind,
  type Vec2,
} from '../../../shared/src/protocol';
import { isNpcId, npcBelongsToPeer } from '../../../shared/src/validation';
import { isBlocked, OBSTACLES } from '../../../shared/src/obstacles';
import { currentAccount, onAccountChange } from '../auth/github';
import { RemoteProfiles } from '../auth/remote-profiles';
import type { VerifiedProfile } from '../auth/verify-token';
import { GameAudio } from '../audio/game-audio';
import { GameRoom } from '../net/room';
import { iceSummary } from '../net/rtc-debug';
import { benchEngine } from '../sim/danmaku/bench';
import { BaseDefense } from '../sim/base-defense';
import { BulletEngine } from '../sim/danmaku/engine';
import { ChatUI } from '../ui/chat';
import { BaseStatusUI } from '../ui/base-status';
import { FireButtonUI } from '../ui/fire-button';
import { StickUI } from '../ui/stick';
import { UpdateBannerUI } from '../ui/update-banner';
import { WaveBannerUI } from '../ui/wave-banner';
import { LocalPlayerSim } from '../sim/local-player';
import { isInFront } from '../sim/targeting';
import {
  WAVE_CALM_MS,
  WAVE_COMPOSITION,
  WAVES_PER_ROUND,
  waveAggression,
  waveStateAt,
  type WaveState,
} from '../sim/wave';
import { RemotePlayerSim } from '../sim/remote-player';
import {
  LocalNpcSim,
  RemoteNpcSim,
  type NpcAttack,
  type NpcTarget,
} from '../sim/npc';
import { BulletView } from '../view3d/bullet-view';
import { FollowCamera } from '../view3d/camera';
import { EdgeMarkers, type MarkerTarget } from '../view3d/edge-markers';
import { EnemyView } from '../view3d/enemy-view';
import { Particles } from '../view3d/particles';
import { PlayerView } from '../view3d/player-view';
import { BaseView } from '../view3d/base-view';
import { createObstacles } from '../view3d/obstacle-view';
import { createWorld, type World } from '../view3d/world';
import { cameraRelativeDir, Keyboard } from './input';
import { BulletSync } from './bullet-sync';

const SPAWN_RANGE = 30;

/** 障害物 (魔力灯コライダー含む) と重ならないスポーン地点を選ぶ */
function pickSpawnPoint(): Vec2 {
  for (let attempt = 0; attempt < 20; attempt++) {
    const x = (Math.random() * 2 - 1) * SPAWN_RANGE;
    const y = (Math.random() * 2 - 1) * SPAWN_RANGE;
    if (!isBlocked(x, y, 1)) return { x, y };
  }
  return { x: SPAWN_RANGE, y: SPAWN_RANGE };
}

/** この時間 state を受信しないリモートはゴーストとみなして除去する */
const STALE_REMOTE_MS = 10_000;

/**
 * タブが裏に回ったままこの時間なんの入力もなければ AFK とみなして自動退室する。
 * バックグラウンドタブは生存維持で他画面に残り続けるため、放置された
 * タブが「動かないキャラ」として溜まり続けるのを防ぐ (bot モードは対象外)。
 * タブが前面にある間は観戦などの意図的な放置とみなして退室させない
 */
const AFK_TIMEOUT_MS = 300_000;

/** タップ判定: この時間・移動量以内の単押しをタップとみなす (ドラッグと区別) */
const TAP_MS = 400;
const TAP_PX = 6;

/**
 * タッチの移動入力を確定するまでの猶予。2本指操作は着地タイミングが
 * わずかにずれるため、1本目に即反応すると意図しない移動が発生する
 */
const TOUCH_GRACE_MS = 120;

/** 被弾フラッシュの長さ */
const FLASH_MS = 160;

interface Remote {
  sim: RemotePlayerSim;
  view: PlayerView;
  prevHp: number;
  flashUntil: number;
}

interface LocalNpc {
  sim: LocalNpcSim;
  view: EnemyView;
}

interface RemoteNpc {
  ownerId: string;
  sim: RemoteNpcSim;
  view: EnemyView;
}

export class Game {
  private readonly world: World;
  private readonly camera: FollowCamera;
  private readonly input = new Keyboard();
  private readonly player: LocalPlayerSim;
  private readonly playerView: PlayerView;
  private readonly remotes = new Map<string, Remote>();
  private readonly localNpcs: LocalNpc[] = [];
  private readonly remoteNpcs = new Map<string, RemoteNpc>();
  private readonly room: GameRoom;
  private readonly audio = new GameAudio();
  private readonly hud: HTMLElement;
  private readonly engine = new BulletEngine();
  private readonly bulletView: BulletView;
  private readonly particles: Particles;
  private readonly markers: EdgeMarkers;
  private selfFlashUntil = 0;
  private readonly worldPosTmp = new THREE.Vector3();
  private readonly rayTmp = new THREE.Vector3();
  private readonly markerTargets = new Map<string, MarkerTarget>();
  private readonly seenFireIds = new Set<string>();
  private readonly bulletSync: BulletSync;
  private readonly profiles: RemoteProfiles;
  private readonly baseDefense = new BaseDefense();
  private readonly baseView: BaseView;
  private readonly baseStatus: BaseStatusUI;
  private lastBaseLit = true;
  private readonly waveBanner: WaveBannerUI;
  /** 直前フレームのウェーブ状態 (フェーズ遷移の告知判定用)。参加直後は告知しない */
  private lastWave: WaveState | null = null;

  private lastFrame = 0;
  private hudTimer = 0;
  private fpsFrames = 0;
  private fps = 0;
  private lastSentAt = 0;
  private lastPeerAt = performance.now();
  private lastInputAt = performance.now();
  private rejoinBackoffMs = 20_000;
  private lastTickTime = performance.now();
  private lastNpcUpdate = performance.now();
  private lastNpcSentAt = 0;
  private scriptId = DEFAULT_SCRIPT_ID;
  private lastFireAt = 0;
  private lastAutoFireAt = 0;
  private viewportW = 0;
  private viewportH = 0;
  private fireHeld = false;
  private downAt = 0;
  private downX = 0;
  private downY = 0;
  private readonly activePointers = new Set<number>();
  private gestureMulti = false;
  /** 移動追従中のポインタ (押している位置へ移動し続ける) */
  private followId: number | null = null;
  /** 猶予期間中の移動入力候補 (2本目の指が来たら破棄する) */
  private pendingFollow: {
    id: number;
    x: number;
    y: number;
    timer: number;
  } | null = null;
  private stickVec: Vec2 | null = null;
  private targetId: string | null = null;
  private readonly targetRing: THREE.Mesh;
  private readonly projTmp = new THREE.Vector3();
  private readonly chat: ChatUI;
  private readonly fireBtn: FireButtonUI;
  private accountUnsubscribe: () => void = () => {};
  private animationFrameId = 0;
  private readonly intervalIds: number[] = [];
  private readonly windowDisposers: Array<() => void> = [];
  private disposed = false;

  constructor(
    container: HTMLElement,
    private readonly name: string,
    private readonly appearance?: Appearance,
    privkey?: Uint8Array,
  ) {
    // 参加ボタンのユーザー操作中に初期化し、ブラウザの自動再生制限を解除する。
    void this.audio.unlock();
    this.world = createWorld(container);
    this.baseView = new BaseView();
    this.world.scene.add(this.baseView.object);
    this.world.scene.add(createObstacles());
    this.baseStatus = new BaseStatusUI(container);
    this.baseStatus.update(BASE_MAX_HP, BASE_MAX_HP, true);
    this.profiles = new RemoteProfiles((id, profile) => {
      const remote = this.remotes.get(id);
      if (!remote) return;
      if (profile) this.applyVerifiedProfile(remote.view, profile);
      else remote.view.clearVerifiedProfile(remote.sim.name);
    });
    this.camera = new FollowCamera(this.world.renderer.domElement);
    this.bulletView = new BulletView(this.world.scene, (owner) => {
      if (isNpcId(owner)) return { color: '#9b63da', name: 'ウィスプ' };
      const sim = this.remotes.get(owner)?.sim;
      return { color: sim?.ap?.c ?? null, name: sim?.name ?? owner };
    });
    // 協力プレイ: 同陣営 (プレイヤー同士・敵同士) の弾は干渉しない。
    // プレイヤー弾と敵弾だけが相殺し合う (撃ち落とし = 防御アクション)
    this.engine.areAllied = (a, b) => isNpcId(a) === isNpcId(b);
    this.particles = new Particles(this.world.scene);
    // 弾同士の相殺・被弾消費で弾けて消えるエフェクト (寿命切れ等では出さない)
    this.engine.onKill = (b, cause) => {
      if (cause === 'collide' || cause === 'hit') {
        this.particles.burst(
          b.x,
          b.y,
          this.bulletView.colorFor(b.owner, this.room.selfId),
          b.radius,
        );
      }
      if (cause === 'collide') this.audio.playCollision(b.radius);
    };
    this.markers = new EdgeMarkers(container);

    const spawn = pickSpawnPoint();
    this.player = new LocalPlayerSim(spawn, name, appearance);
    this.playerView = new PlayerView(name, appearance);
    this.playerView.sync(spawn.x, spawn.y, 0);
    this.world.scene.add(this.playerView.object);
    // 初回フレーム前でもレイキャスト等が正しく動くようカメラを初期化する
    this.camera.update(this.worldPosTmp.set(spawn.x, 0, spawn.y));
    this.camera.camera.updateMatrixWorld();

    this.hud = document.createElement('div');
    this.hud.className = 'hud';
    container.appendChild(this.hud);

    // 入り直しボタン: 自動再参加を解除して参加画面 (名前・見た目の変更) に戻る
    const leaveBtn = document.createElement('button');
    leaveBtn.type = 'button';
    leaveBtn.className = 'leave-btn';
    leaveBtn.textContent = '入り直す';
    leaveBtn.addEventListener('click', () => {
      sessionStorage.removeItem('arcn-autojoin');
      this.dispose();
      location.reload();
    });
    container.appendChild(leaveBtn);

    const soundBtn = document.createElement('button');
    soundBtn.type = 'button';
    soundBtn.className = 'sound-btn';
    const refreshSoundButton = () => {
      soundBtn.textContent = this.audio.enabled ? '🔊' : '🔇';
      soundBtn.title = this.audio.enabled ? '音声をミュート' : '音声をオン';
      soundBtn.setAttribute('aria-label', soundBtn.title);
      soundBtn.setAttribute('aria-pressed', String(!this.audio.enabled));
    };
    soundBtn.addEventListener('click', () => {
      this.audio.toggle();
      refreshSoundButton();
    });
    refreshSoundButton();
    container.appendChild(soundBtn);

    this.chat = new ChatUI(container);
    this.chat.onSend = (text) => {
      this.room.broadcastChat(text);
      this.chat.addLine(this.name, text);
    };

    // 仮想発射ボタン: 押している間はクールダウン毎に連射される
    this.fireBtn = new FireButtonUI(container);
    this.waveBanner = new WaveBannerUI(container);
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

    // ターゲット指定中の相手の足元に表示するリング
    this.targetRing = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.25, 32),
      new THREE.MeshBasicMaterial({ color: 0xff5544, side: THREE.DoubleSide }),
    );
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.position.y = 0.05;
    this.targetRing.visible = false;
    this.world.scene.add(this.targetRing);

    this.room = new GameRoom(privkey);
    this.bulletSync = new BulletSync(this.engine, this.room);
    // 自機の identicon シード (= ピアID) は room 生成後に判明するため後付け
    this.playerView.setIdSeed(this.room.selfId);
    const npcNow = performance.now();
    const joinComposition = WAVE_COMPOSITION[waveStateAt(Date.now()).tier];
    for (let i = 0; i < NPCS_PER_PEER; i++) {
      const kind = joinComposition[i] ?? 'wisp';
      const sim = new LocalNpcSim(`${this.room.selfId}:npc:${i}`, npcNow, kind);
      const view = new EnemyView(sim.id, true, kind);
      view.sync(sim.pos.x, sim.pos.y, sim.heading);
      this.localNpcs.push({ sim, view });
      this.world.scene.add(view.object);
    }
    // 接続確立の瞬間に1発送る: 新規参加者が、アイドル中(タイマー間引き中)の
    // 既存プレイヤーの位置も即座に受け取れるようにする。
    // 拠点履歴は開通した相手だけへ送る (全員ブロードキャストだと
    // N人ルームへの1人参加で N×N 通に膨らむ)
    this.room.onPeerJoin = (id) => {
      this.sendStateNow();
      this.sendNpcsNow();
      this.sendProfileNow();
      this.room.sendBaseSyncTo(id, this.baseDefense.snapshot());
    };
    this.room.onState = (id, state) => {
      const now = performance.now();
      let remote = this.remotes.get(id);
      if (!remote) {
        remote = {
          sim: new RemotePlayerSim(state.n, now),
          view: new PlayerView(state.n, state.ap, id),
          prevHp: state.hp ?? MAX_HP,
          flashUntil: 0,
        };
        remote.view.sync(state.x, state.y, state.h, false);
        this.remotes.set(id, remote);
        this.world.scene.add(remote.view.object);
        // 検証済みプロフィールがあれば適用する (profile が state より先に
        // 届いた場合と、無通信で一時除去された表示の再作成時の両方をカバー)
        const profile = this.profiles.get(id);
        if (profile) this.applyVerifiedProfile(remote.view, profile);
        this.chat.addLine('', `* ${state.n} が参加しました`, true);
        this.audio.playJoin();
        this.updateHud();
      }
      remote.sim.push(state, now);
      // 受信イベントはバックグラウンドタブでも届くため、担当NPCのAIも
      // ここで進めてタイマー間引きによる停止を緩和する。
      this.updateNpcsToNow(now);
      // バックグラウンドタブは setInterval が最悪 1回/分 まで間引かれる
      // (Chrome の intensive throttling)。受信イベントは間引かれないため、
      // 相手からの受信を契機に生存応答を返して presence を維持する
      if (now - this.lastSentAt > 1000) {
        this.sendStateNow();
      }
    };
    this.room.onNpcs = (ownerId, states) => {
      const now = performance.now();
      const seen = new Set<string>();
      for (const state of states) {
        if (seen.has(state.id) || !npcBelongsToPeer(state.id, ownerId)) continue;
        seen.add(state.id);
        let npc = this.remoteNpcs.get(state.id);
        const existed = npc !== undefined;
        if (!npc) {
          npc = {
            ownerId,
            sim: new RemoteNpcSim(state.id, now),
            view: new EnemyView(state.id, false, state.k ?? 'wisp'),
          };
          this.remoteNpcs.set(state.id, npc);
          this.world.scene.add(npc.view.object);
        }
        const wasAlive = existed && npc.sim.mode !== 'dead';
        npc.sim.push(state, now);
        this.ensureNpcViewKind(npc, false);
        npc.view.setState(state.hp, state.mode);
        if (wasAlive && state.mode === 'dead') {
          this.particles.burst(state.x, state.y, new THREE.Color(0x9b63da), 1.2);
          if (
            Math.hypot(state.x - this.player.pos.x, state.y - this.player.pos.y) < 48
          ) {
            this.audio.playDefeat();
          }
        }
        if (state.mode === 'dead' && this.targetId === state.id) {
          this.targetId = null;
        }
      }
    };
    this.room.onFire = (id, ev) => this.handleRemoteFire(id, ev);
    this.room.onBulletKill = (fireId, spawnIdx) =>
      this.engine.killByFire(fireId, spawnIdx);
    this.room.onBaseHit = (id, event) => {
      if (!npcBelongsToPeer(event.npc, id)) return;
      // event.at は送信者の時計。handleRemoteFire と同様に推定時計ずれを
      // 差し引いて自分の時計に直し、ずれた端末間で受理判定が食い違って
      // 魔力灯 HP の見え方が分岐するのを防ぐ
      const skew = this.remotes.get(id)?.sim.clockSkewMin;
      const at = Number.isFinite(skew) ? event.at + (skew as number) : event.at;
      if (this.baseDefense.apply({ ...event, at })) this.showBaseHit();
    };
    this.room.onBaseSync = (_id, hits) => {
      this.baseDefense.merge(hits);
    };
    this.room.onChat = (id, text) => {
      const name = this.remotes.get(id)?.sim.name ?? id.slice(0, 8);
      // リモートの通常発言を「* 」だけでシステム通知扱いにしない。
      this.chat.addLine(name, text);
      this.audio.playChat();
    };
    this.room.onPeerLeave = (id) => {
      const name = this.remotes.get(id)?.sim.name;
      if (name) {
        this.chat.addLine('', `* ${name} が退出しました`, true);
        this.audio.playLeave();
      }
      this.removeRemote(id);
      this.removeRemoteNpcsOwnedBy(id);
      // メッシュから居なくなったピアの認証キャッシュは破棄する
      // (再接続時は接続確立の契機で相手が profile を送り直してくる)
      this.profiles.remove(id);
      this.bulletSync.removePeer(id);
      this.updateHud();
    };
    // 自分より新しいバージョンを申告するピアが居たらアップデートを促す
    const updateBanner = new UpdateBannerUI(container);
    this.room.onPeerVersion = (id, version) => {
      this.bulletSync.notePeerVersion(id, version);
      if (version > PROTO_VERSION) updateBanner.show();
    };

    // GitHub 認証: 自分のアバターを反映し、ログイン/トークン更新のたびに
    // ピアへ再配布する。受信側 (onProfile) は署名を独立検証してから表示する
    this.room.onProfile = (id, token) => this.profiles.receive(id, token);
    const applyOwnAccount = () => {
      const acc = currentAccount();
      if (!acc || acc.boundPeerId !== this.room.selfId) {
        this.playerView.clearVerifiedProfile(this.name);
        if (this.room.peerCount > 0) this.room.broadcastProfileClear();
        return;
      }
      // 頭上ラベルは検証済みアカウント名 (フル) に差し替える
      this.playerView.setName(acc.name);
      if (acc.picture) this.playerView.setAvatarUrl(acc.picture, true);
      this.sendProfileNow();
    };
    applyOwnAccount();
    this.accountUnsubscribe = onAccountChange(applyOwnAccount);

    this.setupInput(container);

    // AFK 判定用の入力検知。チャット入力欄は keydown を stopPropagation
    // するため、capture 段階で拾ってあらゆる操作を活動として数える
    for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
      this.listenWindow(
        type,
        () => {
          this.lastInputAt = performance.now();
        },
        { capture: true, passive: true },
      );
    }

    // resize イベントは iOS の画面回転で取りこぼしたり回転前の寸法で
    // 発火したりするため、イベントに加えて毎フレーム実寸比較でも追従する
    // (syncViewportSize)。ここは即応用
    this.listenWindow('resize', () => this.syncViewportSize());
    // beforeunload はモバイルで発火しないことが多い。pagehide なら
    // 画面ロックやタブ切替による破棄・凍結時にも比較的確実に呼ばれるため、
    // ここで退室してゴースト (残留ピア情報) を残さないようにする
    this.listenWindow('pagehide', () => this.dispose());
    // bfcache から復元された場合、凍結中に WebRTC もリレー接続も死んでいる
    // ので、再読み込みしてクリーンに再参加させる (自動参加で即復帰する)
    this.listenWindow('pageshow', (e) => {
      if (e.persisted) location.reload();
    });

    this.updateHud();

    // 開発時のコンソール調査用ハンドル (本体ロジックからは参照しない)
    (window as unknown as { __arc?: unknown }).__arc = this;
    (window as unknown as { __arcBench?: unknown }).__arcBench = benchEngine;
  }

  start(): void {
    if (this.disposed || this.animationFrameId !== 0) return;
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      this.frame(now);
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);

    // 状態送信は rAF から独立させる。バックグラウンドタブでは rAF が完全停止
    // するが、setInterval は (~1Hz に間引かれつつも) 動き続けるため、
    // 裏に回ったプレイヤーも相手画面から消えない。
    this.intervalIds.push(window.setInterval(() => {
      const now = performance.now();
      this.updateNpcsToNow(now);
      this.sendStateNow();
      if (now - this.lastNpcSentAt >= NPC_STATE_INTERVAL_MS) this.sendNpcsNow();
      // 弾幕 tick と HUD は rAF (描画) 停止中のバックグラウンドでも進める
      this.tickToNow(now);
      // 被弾判定も rAF 停止中に止めない。判定を rAF だけに置くと、裏に
      // 回ったタブが「攻撃の効かない置物」として他画面に残り続けてしまう
      this.checkNpcHits(now);
      this.checkHits(now);
      this.checkBaseHits();
      this.checkObstacleHits();
      this.updateHud();
    }, STATE_INTERVAL_MS));

    // 回復ウォッチドッグ: ピアを長時間発見できない場合は回復を要求する。
    // (間隔は指数バックオフで最大5分まで延ばし、リレーへの負荷増を防ぐ)
    this.intervalIds.push(window.setInterval(() => {
      const now = performance.now();
      // タブが前面にある間は AFK とみなさない (観戦などの意図的な放置を許容)。
      // 裏に回った時点から無入力タイマーが進み始める
      if (document.visibilityState === 'visible') {
        this.lastInputAt = now;
      } else if (now - this.lastInputAt > AFK_TIMEOUT_MS) {
        // 裏に回ったまま長時間入力がなければ AFK として退室し、参加画面へ
        // 戻る (放置タブのキャラが他画面に残り続けるのを防ぐ)
        sessionStorage.removeItem('arcn-autojoin');
        this.dispose();
        location.reload();
        return;
      }
      // 長時間無通信のリモートは死んだ接続の残骸とみなして除去する
      for (const [id, remote] of this.remotes) {
        if (now - remote.sim.lastSeenAt > STALE_REMOTE_MS) {
          console.debug(`[game] remove stale remote ${id.slice(0, 8)}`);
          this.removeRemote(id);
        }
      }
      for (const [id, npc] of this.remoteNpcs) {
        if (now - npc.sim.lastSeenAt > STALE_REMOTE_MS) this.removeRemoteNpc(id);
      }
      this.profiles.expire();

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
    }, 5_000));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.animationFrameId !== 0) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = 0;
    }
    for (const id of this.intervalIds) window.clearInterval(id);
    this.intervalIds.length = 0;
    for (const remove of this.windowDisposers.splice(0)) remove();
    this.accountUnsubscribe();
    this.input.dispose();
    this.chat.dispose();
    this.audio.dispose();
    this.room.leave();
  }

  private listenWindow<K extends keyof WindowEventMap>(
    type: K,
    listener: (event: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean,
  ): void {
    window.addEventListener(type, listener, options);
    this.windowDisposers.push(() =>
      window.removeEventListener(type, listener, options),
    );
  }

  /**
   * 描画サイズを実際のウィンドウ寸法に一致させる。resize イベント頼みだと
   * iOS Safari の画面回転で「発火しない/回転前の寸法で発火する」ことが
   * あるため、毎フレーム呼んで寸法変化を検知したときだけ適用する
   */
  private syncViewportSize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w === this.viewportW && h === this.viewportH) return;
    this.viewportW = w;
    this.viewportH = h;
    this.world.renderer.setSize(w, h);
    this.camera.resize(w / h);
  }

  private frame(now: number): void {
    this.syncViewportSize();
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
    // 通常ショット: 索敵距離内かつ自機前方に敵がいれば自動発射
    // (エネルギー消費なし)
    this.autoFire(now);

    this.updateNpcsToNow(now);
    this.tickToNow(now);
    this.checkNpcHits(now);
    this.checkHits(now);
    this.checkBaseHits();
    this.checkObstacleHits();
    this.updateBaseView(now);

    // 無敵時間中は点滅、被弾直後は発光フラッシュ
    const invuln = now < this.player.invulnUntil;
    this.playerView.object.visible = !invuln || Math.floor(now / 120) % 2 === 0;
    this.playerView.setFlash(now < this.selfFlashUntil);
    this.playerView.setHp(this.player.hp / MAX_HP);
    this.playerView.setEnergy(this.player.energy / ENERGY_MAX);
    this.playerView.animate(now);

    this.markerTargets.clear();
    let targetVisible = false;
    for (const [id, remote] of this.remotes) {
      const s = remote.sim.sample(now);
      if (s.visible) {
        remote.view.sync(s.x, s.y, s.h);
        remote.view.setHp(remote.sim.hp / MAX_HP);
        // HP減少を検知して被弾フラッシュ (被弾判定は本人のみが行うため、
        // 他機の被弾はHPの自己申告値の変化から推定する)
        if (remote.sim.hp < remote.prevHp) {
          remote.flashUntil = now + FLASH_MS;
        }
        remote.prevHp = remote.sim.hp;
        remote.view.setFlash(now < remote.flashUntil);
        remote.view.animate(now);
        this.markerTargets.set(id, {
          name: remote.sim.name,
          x: s.x,
          z: s.y,
          kind: 'player',
          dist: Math.hypot(s.x - this.player.pos.x, s.y - this.player.pos.y),
        });
        if (id === this.targetId) {
          this.targetRing.position.set(s.x, 0.05, s.y);
          targetVisible = true;
        }
      }
    }

    for (const npc of this.localNpcs) {
      this.ensureNpcViewKind(npc, true);
      npc.view.setState(npc.sim.hp, npc.sim.mode);
      npc.view.sync(npc.sim.pos.x, npc.sim.pos.y, npc.sim.heading, npc.sim.alive);
      npc.view.animate(now);
      if (npc.sim.alive) {
        this.markerTargets.set(npc.sim.id, {
          name: NPC_KINDS[npc.sim.kind].name,
          x: npc.sim.pos.x,
          z: npc.sim.pos.y,
          kind: 'enemy',
          dist: Math.hypot(
            npc.sim.pos.x - this.player.pos.x,
            npc.sim.pos.y - this.player.pos.y,
          ),
        });
      }
      if (npc.sim.alive && npc.sim.id === this.targetId) {
        this.targetRing.position.set(npc.sim.pos.x, 0.05, npc.sim.pos.y);
        targetVisible = true;
      }
    }
    for (const npc of this.remoteNpcs.values()) {
      const s = npc.sim.sample(now);
      this.ensureNpcViewKind(npc, false);
      npc.view.setState(npc.sim.hp, npc.sim.mode);
      npc.view.sync(s.x, s.y, s.h, s.visible);
      npc.view.animate(now);
      if (s.visible) {
        this.markerTargets.set(npc.sim.id, {
          name: NPC_KINDS[npc.sim.kind].name,
          x: s.x,
          z: s.y,
          kind: 'enemy',
          dist: Math.hypot(s.x - this.player.pos.x, s.y - this.player.pos.y),
        });
      }
      if (s.visible && npc.sim.id === this.targetId) {
        this.targetRing.position.set(s.x, 0.05, s.y);
        targetVisible = true;
      }
    }
    this.targetRing.visible = targetVisible;

    this.bulletView.sync(this.engine.bullets, this.room.selfId);
    this.particles.update(dt);

    this.camera.update(
      this.worldPosTmp.set(this.player.pos.x, 0, this.player.pos.y),
    );
    this.world.renderer.render(this.world.scene, this.camera.camera);
    this.markers.update(this.camera.camera, this.markerTargets);

    this.fpsFrames++;
    this.hudTimer += dtMs;
    if (this.hudTimer >= 500) {
      this.fps = Math.round((this.fpsFrames * 1000) / this.hudTimer);
      this.fpsFrames = 0;
      this.hudTimer = 0;
      this.updateHud();
    }
  }

  // --- 分散NPC (このクライアントの担当分だけAI・被弾を判定) ------------------

  private updateNpcsToNow(now: number): void {
    const dt = Math.min(Math.max((now - this.lastNpcUpdate) / 1000, 0), 0.25);
    if (dt <= 0) return;
    this.lastNpcUpdate = now;
    const wave = waveStateAt(Date.now());
    this.announceWaveTransition(wave);
    const waveMod = {
      respawnPaused: wave.phase === 'calm',
      aggression: waveAggression(wave.tier),
      kinds: WAVE_COMPOSITION[wave.tier],
    };
    // 拠点防衛ループ: 敵はプレイヤーではなく中央の魔力灯を主目標にする。
    // 消灯中の魔力灯は狙わない (再点火までの回復時間を作る)
    const targets: NpcTarget[] = this.baseDefense.lit()
      ? [{ id: BASE_ID, pos: { x: 0, y: 0 } }]
      : [];
    for (const npc of this.localNpcs) {
      const attack = npc.sim.update(dt, now, targets, waveMod);
      if (attack) this.fireNpc(npc.sim, attack);
    }
  }

  /** ウェーブのフェーズ遷移を告知する (参加直後の初回は現在地の記録のみ) */
  private announceWaveTransition(wave: WaveState): void {
    const prev = this.lastWave;
    this.lastWave = wave;
    if (!prev || (prev.index === wave.index && prev.phase === wave.phase)) return;
    if (wave.phase === 'assault') {
      this.waveBanner.show(`第${wave.number}波 襲来!`);
      this.chat.addLine('', `* 第${wave.number}波が襲来!`, true);
    } else {
      this.chat.addLine(
        '',
        `* 敵の波が引いた (次の波まで${Math.round(WAVE_CALM_MS / 1000)}秒)`,
        true,
      );
    }
  }

  /** 再出現で種別が変わった敵のビューを作り直す */
  private ensureNpcViewKind(
    npc: { sim: { id: string; kind: NpcKind }; view: EnemyView },
    local: boolean,
  ): void {
    if (npc.view.kind === npc.sim.kind) return;
    this.world.scene.remove(npc.view.object);
    npc.view = new EnemyView(npc.sim.id, local, npc.sim.kind);
    this.world.scene.add(npc.view.object);
  }

  private fireNpc(npc: LocalNpcSim, attack: NpcAttack): void {
    const origin = { x: npc.pos.x, y: npc.pos.y };
    const dir = Math.atan2(
      attack.targetPos.y - origin.y,
      attack.targetPos.x - origin.x,
    );
    const script = attack.explode
      ? NPC_RUSHER_SCRIPT_ID
      : npc.kind === 'turret'
        ? NPC_TURRET_SCRIPT_ID
        : NPC_FIRE_SCRIPT_ID;
    const ev: FireEvent = {
      id: crypto.randomUUID(),
      script,
      seed: (Math.random() * 0x100000000) >>> 0,
      x: origin.x,
      y: origin.y,
      dir,
      at: Date.now(),
      target: attack.targetId,
      tx: attack.targetPos.x,
      ty: attack.targetPos.y,
      npc: npc.id,
    };
    this.seenFireIds.add(ev.id);
    this.engine.startScript(
      NPC_SCRIPT_SOURCES[script],
      ev.seed,
      () => origin,
      dir,
      npc.id,
      () => attack.targetPos,
      0,
      ev.id,
    );
    if (attack.explode) {
      // 自爆の消滅演出 (リモート側は mode=dead 遷移の既存演出で光る)
      this.particles.burst(origin.x, origin.y, new THREE.Color(0xffb347), 1.4);
    }
    this.room.broadcastFire(ev);
    this.audio.playEnemyFire(
      Math.hypot(origin.x - this.player.pos.x, origin.y - this.player.pos.y),
    );
  }

  /**
   * 拠点に達した弾の処理。担当NPCの弾だけを権威的に命中させて全ピアへ
   * 共有し、それ以外の弾 (プレイヤー弾・他ピア担当のNPC弾) は魔力灯が
   * 実体化したためローカルで遮って消す (ダメージ確定は担当ピアの権威のまま)
   */
  private checkBaseHits(): void {
    const lit = this.baseDefense.lit();
    this.engine.forEachNearby(0, 0, BASE_HIT_RADIUS, (bullet, index) => {
      const rr = bullet.radius + BASE_HIT_RADIUS;
      if (bullet.x * bullet.x + bullet.y * bullet.y > rr * rr) return;
      if (!lit || !npcBelongsToPeer(bullet.owner, this.room.selfId)) {
        // 消灯中は流れ弾のダメージ履歴を作らない (全快までの回復を妨げない)。
        // 履歴のマージ自体はゲートせず、収束性は保つ
        this.engine.killAt(index);
        return;
      }
      const event: BaseHitEvent = {
        id: crypto.randomUUID(),
        npc: bullet.owner,
        damage: Math.min(Math.max(bullet.dur, 1), 100),
        at: Date.now(),
      };
      if (!this.baseDefense.apply(event)) return;
      this.engine.killAt(index);
      this.room.broadcastBulletKill(bullet.fireId, bullet.spawnIdx);
      this.room.broadcastBaseHit(event);
      this.showBaseHit();
    });
  }

  /**
   * 岩に入った弾を消す。弾道は発射イベントから全クライアントが決定論的に
   * 再現しているため、岩との衝突も各自ローカルに消すだけで一致する
   * (同期メッセージ不要)。岩ごとに空間ハッシュを引くので tick 負荷も小さい
   */
  private checkObstacleHits(): void {
    for (const o of OBSTACLES) {
      this.engine.forEachNearby(o.x, o.y, o.r, (bullet, index) => {
        const dx = bullet.x - o.x;
        const dy = bullet.y - o.y;
        if (dx * dx + dy * dy > o.r * o.r) return;
        this.engine.killAt(index);
      });
    }
  }

  private showBaseHit(): void {
    this.particles.burst(0, 0, new THREE.Color(0x6bcfff), 1.25);
    this.audio.playHit();
  }

  private updateBaseView(now: number): void {
    const hp = this.baseDefense.hp();
    const lit = this.baseDefense.lit();
    this.baseView.update(now, hp, BASE_MAX_HP, lit);
    this.baseStatus.update(hp, BASE_MAX_HP, lit);
    if (this.lastBaseLit && !lit) {
      this.chat.addLine('', '* 魔力灯が消えました。全快すると再点火します', true);
      this.audio.playDefeat();
    } else if (!this.lastBaseLit && lit) {
      this.chat.addLine('', '* 魔力灯が再点火しました', true);
      this.audio.playJoin();
    }
    this.lastBaseLit = lit;
  }

  private checkNpcHits(now: number): void {
    for (const npc of this.localNpcs) {
      if (!npc.sim.alive) continue;
      let defeated = false;
      this.engine.forEachNearby(
        npc.sim.pos.x,
        npc.sim.pos.y,
        npc.sim.hitRadius,
        (bullet, index) => {
          if (defeated) return;
          // 共通敵同士ではダメージを与えない。
          if (isNpcId(bullet.owner)) return;
          const dx = bullet.x - npc.sim.pos.x;
          const dy = bullet.y - npc.sim.pos.y;
          const rr = bullet.radius + npc.sim.hitRadius;
          if (dx * dx + dy * dy > rr * rr) return;
          const died = npc.sim.takeHit(bullet.dur, now);
          this.engine.killAt(index);
          this.room.broadcastBulletKill(bullet.fireId, bullet.spawnIdx);
          this.audio.playHit();
          if (died) {
            defeated = true;
            this.particles.burst(
              npc.sim.pos.x,
              npc.sim.pos.y,
              new THREE.Color(0x9b63da),
              1.2,
            );
            this.audio.playDefeat();
            if (this.targetId === npc.sim.id) this.targetId = null;
          }
        },
      );
    }
  }

  // --- 被弾 (自己申告制: 自機の判定は自分だけが行う) -------------------------

  private checkHits(now: number): void {
    if (now < this.player.invulnUntil) return;
    const px = this.player.pos.x;
    const py = this.player.pos.y;
    const pr = 0.7; // 自機の当たり半径
    let died = false;
    let killerId = '';
    this.engine.forEachNearby(px, py, pr, (b, index) => {
      if (died) return;
      // 協力プレイ: ダメージを受けるのは敵 (NPC) の弾のみ。
      // プレイヤー同士はフレンドリーファイアなし (弾はすり抜ける)
      if (!isNpcId(b.owner)) return;
      const dx = b.x - px;
      const dy = b.y - py;
      const rr = b.radius + pr;
      if (dx * dx + dy * dy > rr * rr) return;
      const dead = this.player.takeHit(b.dur, now);
      this.engine.killAt(index); // 当たった弾は消費する
      // 他クライアントにも消滅を通知 (発射イベントID + 生成順で特定)
      this.room.broadcastBulletKill(b.fireId, b.spawnIdx);
      this.selfFlashUntil = now + FLASH_MS;
      this.audio.playHit();
      if (dead) {
        died = true;
        killerId = b.owner;
      }
    });
    if (died) {
      this.audio.playDefeat();
      const killer =
        (isNpcId(killerId) ? 'ウィスプ' : this.remotes.get(killerId)?.sim.name) ??
        killerId.slice(0, 8);
      const announce = `* ${this.name} は ${killer} に撃墜されました`;
      this.chat.addLine('', announce, true);
      this.room.broadcastChat(announce);
      const spawn = pickSpawnPoint();
      this.player.respawn(spawn.x, spawn.y, now);
      this.playerView.sync(this.player.pos.x, this.player.pos.y, this.player.heading);
      this.sendStateNow();
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
    const source = DANMAKU_SCRIPTS[this.scriptId]?.source ?? null;
    if (!source) return;

    // 発射ゲート: 前の発射指示 (自分のスクリプト) が完了するまで重ねられない。
    // 多段シーケンスの弾幕が意図した形のまま展開されるようにする
    if (this.engine.ownerHasRun(this.room.selfId)) return;

    const seed = (Math.random() * 0x100000000) >>> 0;
    // 発射位置と照準位置はイベント生成時点で固定する。各受信者が持つ最新stateは
    // 到着時刻が異なるため、実行中に参照すると同じseedでも弾道が分岐してしまう。
    const origin = { x: this.player.pos.x, y: this.player.pos.y };
    const sourceVelocity = this.player.getVelocity();
    const targetPos = this.resolveTargetPosition(this.targetId ?? undefined);
    const originResolver = () => origin;
    const targetResolver = () => targetPos;

    // 発射ゲート: エネルギー。総コストを同シードの空実行で算出して一括消費
    // (同時存在弾数の上限はエンジン側で「最古の弾の寿命前倒し」として処理)
    const cost = this.engine.estimateCost(
      source,
      seed,
      this.player.heading,
      originResolver,
      targetResolver,
    );
    if (cost === null || !this.player.trySpendEnergy(cost)) return;

    this.lastFireAt = now;
    const ev: FireEvent = {
      id: crypto.randomUUID(),
      script: this.scriptId,
      seed,
      x: origin.x,
      y: origin.y,
      dir: this.player.heading,
      vx: sourceVelocity.x,
      vy: sourceVelocity.y,
      at: Date.now(),
      target: this.targetId ?? undefined,
      tx: targetPos?.x,
      ty: targetPos?.y,
    };
    this.seenFireIds.add(ev.id);
    this.engine.startScript(
      source,
      ev.seed,
      originResolver,
      ev.dir,
      this.room.selfId,
      targetResolver,
      0,
      ev.id,
      {
        x: sourceVelocity.x * BULLET_INHERIT_VELOCITY,
        y: sourceVelocity.y * BULLET_INHERIT_VELOCITY,
      },
    );
    this.room.broadcastFire(ev);
    this.audio.playFire();
  }

  /**
   * 通常ショット: 索敵距離内かつ自機の前半面に敵がいる間、自機の向きへ
   * ランダムに拡散発射する基本攻撃 (自動照準はしない。狙いは移動で付ける)。
   * エネルギーを消費せず、強攻撃 (fire) とは独立したクールダウンで動く。
   * 単発の即時完了スクリプトなので、多段シーケンス保護の ownerHasRun
   * ゲートは通さない (強攻撃の展開中でも通常ショットは撃てる)
   */
  private autoFire(now: number): void {
    if (now - this.lastAutoFireAt < AUTO_SHOT_COOLDOWN_MS) return;
    if (!this.nearestEnemyAhead(AUTO_SHOT_RANGE)) return;
    this.lastAutoFireAt = now;

    const origin = { x: this.player.pos.x, y: this.player.pos.y };
    const sourceVelocity = this.player.getVelocity();
    const seed = (Math.random() * 0x100000000) >>> 0;
    const ev: FireEvent = {
      id: crypto.randomUUID(),
      script: NORMAL_SHOT_SCRIPT_ID,
      seed,
      x: origin.x,
      y: origin.y,
      dir: this.player.heading,
      vx: sourceVelocity.x,
      vy: sourceVelocity.y,
      at: Date.now(),
    };
    this.seenFireIds.add(ev.id);
    this.engine.startScript(
      NORMAL_SHOT_SCRIPT_SOURCE,
      ev.seed,
      () => origin,
      ev.dir,
      this.room.selfId,
      undefined,
      0,
      ev.id,
      {
        x: sourceVelocity.x * BULLET_INHERIT_VELOCITY,
        y: sourceVelocity.y * BULLET_INHERIT_VELOCITY,
      },
    );
    this.room.broadcastFire(ev);
    this.audio.playAutoFire();
  }

  /** 自機前方にいる生存中の敵から、最も近いものを拾う */
  private nearestEnemyAhead(maxDist: number): { id: string; pos: Vec2 } | null {
    const px = this.player.pos.x;
    const py = this.player.pos.y;
    const origin = this.player.pos;
    const heading = this.player.heading;
    let best: { id: string; pos: Vec2 } | null = null;
    let bestDist = maxDist;
    for (const npc of this.localNpcs) {
      if (!npc.sim.alive) continue;
      if (!isInFront(origin, heading, npc.sim.pos)) continue;
      const d = Math.hypot(npc.sim.pos.x - px, npc.sim.pos.y - py);
      if (d < bestDist) {
        bestDist = d;
        best = { id: npc.sim.id, pos: { x: npc.sim.pos.x, y: npc.sim.pos.y } };
      }
    }
    for (const [id, npc] of this.remoteNpcs) {
      if (npc.sim.mode === 'dead') continue;
      const pos = { x: npc.sim.lastX, y: npc.sim.lastY };
      if (!isInFront(origin, heading, pos)) continue;
      const d = Math.hypot(npc.sim.lastX - px, npc.sim.lastY - py);
      if (d < bestDist) {
        bestDist = d;
        best = { id, pos };
      }
    }
    return best;
  }

  private handleRemoteFire(fromId: string, ev: FireEvent): void {
    if (ev.npc && !npcBelongsToPeer(ev.npc, fromId)) return;
    if (this.seenFireIds.has(ev.id)) return;
    this.seenFireIds.add(ev.id);
    if (this.seenFireIds.size > 1000) {
      const it = this.seenFireIds.values();
      for (let i = 0; i < 500; i++) this.seenFireIds.delete(it.next().value as string);
    }
    const source =
      DANMAKU_SCRIPTS[ev.script]?.source ??
      NPC_SCRIPT_SOURCES[ev.script] ??
      (ev.script === NORMAL_SHOT_SCRIPT_ID ? NORMAL_SHOT_SCRIPT_SOURCE : null);
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
    const origin = { x: ev.x, y: ev.y };
    // 新プロトコルは照準位置もイベントへ固定保存する。旧クライアントからの
    // イベントは受信時点の位置を一度だけ解決し、以後は同じ値を使う。
    const targetPos =
      ev.tx !== undefined && ev.ty !== undefined
        ? { x: ev.tx, y: ev.ty }
        : this.resolveTargetPosition(ev.target);
    this.engine.startScript(
      source,
      ev.seed,
      () => origin,
      ev.dir,
      ev.npc ?? fromId,
      () => targetPos,
      catchup,
      ev.id,
      {
        x: (ev.vx ?? 0) * BULLET_INHERIT_VELOCITY,
        y: (ev.vy ?? 0) * BULLET_INHERIT_VELOCITY,
      },
    );
    if (ev.npc) {
      this.audio.playEnemyFire(
        Math.hypot(origin.x - this.player.pos.x, origin.y - this.player.pos.y),
      );
    }
  }

  /**
   * 現時点のターゲット位置をスナップショットする。発射イベント内で固定し、
   * その後の通信遅延や回避によって端末ごとの弾道が分岐するのを防ぐ。
   */
  private resolveTargetPosition(targetId?: string): Vec2 | null {
    if (!targetId) return null;
    if (targetId === BASE_ID) return { x: 0, y: 0 };
    if (targetId === this.room.selfId) {
      return { x: this.player.pos.x, y: this.player.pos.y };
    }
    if (isNpcId(targetId)) {
      const local = this.localNpcs.find((npc) => npc.sim.id === targetId)?.sim;
      if (local?.alive) return { x: local.pos.x, y: local.pos.y };
      const remoteNpc = this.remoteNpcs.get(targetId)?.sim;
      if (remoteNpc && remoteNpc.mode !== 'dead') {
        return { x: remoteNpc.lastX, y: remoteNpc.lastY };
      }
      return null;
    }
    const sim = this.remotes.get(targetId)?.sim;
    return sim?.hasPos ? { x: sim.lastX, y: sim.lastY } : null;
  }

  // --- 入力 -----------------------------------------------------------------

  private setupInput(container: HTMLElement): void {
    this.listenWindow('keydown', (e) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
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
        // 2本指: カメラ操作へ。移動入力 (確定済み・猶予中とも) は破棄する
        this.gestureMulti = true;
        this.followId = null;
        this.cancelPendingFollow();
        return;
      }
      this.downAt = performance.now();
      this.downX = e.clientX;
      this.downY = e.clientY;
      // プレイヤーの上ならタップ判定 (pointerup) に委ねる
      if (this.pickTargetAt(e.clientX, e.clientY, container)) return;
      if (e.pointerType === 'touch') {
        // タッチは猶予期間を置いてから移動を確定する (2本指操作の誤発動防止)
        this.cancelPendingFollow();
        const pending = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          timer: 0,
        };
        pending.timer = window.setTimeout(() => {
          if (this.pendingFollow !== pending) return;
          this.pendingFollow = null;
          if (this.gestureMulti || !this.activePointers.has(pending.id)) return;
          this.followId = pending.id;
          const ground = this.raycastGround(pending.x, pending.y, container);
          if (ground) this.player.setTarget(ground.x, ground.y);
        }, TOUCH_GRACE_MS);
        this.pendingFollow = pending;
      } else {
        // マウスは多点タッチがないため即時確定
        this.followId = e.pointerId;
        const ground = this.raycastGround(e.clientX, e.clientY, container);
        if (ground) this.player.setTarget(ground.x, ground.y);
      }
    });
    dom.addEventListener('pointermove', (e) => {
      if (this.pendingFollow?.id === e.pointerId) {
        this.pendingFollow.x = e.clientX;
        this.pendingFollow.y = e.clientY;
        return;
      }
      if (e.pointerId !== this.followId || this.gestureMulti) return;
      const ground = this.raycastGround(e.clientX, e.clientY, container);
      if (ground) this.player.setTarget(ground.x, ground.y);
    });
    const endPointer = (e: PointerEvent) => {
      this.activePointers.delete(e.pointerId);
      const wasPending = this.pendingFollow?.id === e.pointerId;
      if (wasPending) this.cancelPendingFollow();
      if (e.pointerId === this.followId) this.followId = null;
      const wasMulti = this.gestureMulti;
      if (this.activePointers.size === 0) this.gestureMulti = false;
      if (wasMulti) return; // ピンチ/回転操作の指離しはタップ扱いしない
      // プレイヤーへの短いタップ = ターゲット指定/解除
      const dt = performance.now() - this.downAt;
      const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
      if (dt <= TAP_MS && moved <= TAP_PX) {
        const hit = this.pickTargetAt(e.clientX, e.clientY, container);
        if (hit) {
          this.targetId = this.targetId === hit ? null : hit;
          this.updateHud();
          return;
        }
      }
      // 猶予中に離した = クイックタップ/フリック。移動として成立させる
      if (wasPending && e.type === 'pointerup') {
        const ground = this.raycastGround(e.clientX, e.clientY, container);
        if (ground) this.player.setTarget(ground.x, ground.y);
      }
    };
    dom.addEventListener('pointerup', endPointer);
    dom.addEventListener('pointercancel', endPointer);
  }

  private cancelPendingFollow(): void {
    if (this.pendingFollow) {
      clearTimeout(this.pendingFollow.timer);
      this.pendingFollow = null;
    }
  }

  /** 発射スクリプトを次へ切り替える (仮想ボタン横のチップ用) */
  private cycleScript(): void {
    const ids = Object.keys(DANMAKU_SCRIPTS);
    const idx = ids.indexOf(this.scriptId);
    this.scriptId = ids[(idx + 1) % ids.length];
    this.updateHud();
  }

  /** 画面座標に一番近い他プレイヤー/NPCを拾う (しきい値以内)。 */
  private pickTargetAt(
    clientX: number,
    clientY: number,
    container: HTMLElement,
  ): string | null {
    const w = container.clientWidth;
    const h = container.clientHeight;
    let best: string | null = null;
    let bestDist = 40; // px
    // 協力プレイ: ロックオン対象は敵 (NPC) のみ
    for (const npc of [...this.localNpcs, ...this.remoteNpcs.values()]) {
      if (!npc.view.object.visible) continue;
      const p = npc.view.object.position;
      this.projTmp.set(p.x, 1.0, p.z).project(this.camera.camera);
      if (this.projTmp.z > 1) continue;
      const sx = ((this.projTmp.x + 1) / 2) * w;
      const sy = ((1 - this.projTmp.y) / 2) * h;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestDist) {
        bestDist = d;
        best = npc.sim.id;
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

  private removeRemoteNpc(id: string): void {
    const npc = this.remoteNpcs.get(id);
    if (!npc) return;
    this.remoteNpcs.delete(id);
    this.world.scene.remove(npc.view.object);
    if (this.targetId === id) this.targetId = null;
  }

  private removeRemoteNpcsOwnedBy(ownerId: string): void {
    for (const [id, npc] of this.remoteNpcs) {
      if (npc.ownerId === ownerId) this.removeRemoteNpc(id);
    }
  }

  private sendStateNow(): void {
    if (this.room.peerCount === 0) return;
    this.lastSentAt = performance.now();
    this.room.broadcastState(this.player.makeState());
  }

  private sendNpcsNow(): void {
    if (this.room.peerCount === 0) return;
    this.lastNpcSentAt = performance.now();
    this.room.broadcastNpcs(this.localNpcs.map((npc) => npc.sim.makeState()));
  }

  /** GitHub 認証トークンを全ピアへ配る (未ログインなら何もしない) */
  private sendProfileNow(): void {
    const token = currentAccount()?.token;
    if (token && this.room.peerCount > 0) this.room.broadcastProfile(token);
  }

  /** 検証済みプロフィールをラベルへ反映 (名前はフル表示、アバターはバッジ付き) */
  private applyVerifiedProfile(view: PlayerView, profile: VerifiedProfile): void {
    if (profile.name) view.setName(profile.name);
    if (profile.picture) view.setAvatarUrl(profile.picture, true);
  }

  /** 選択中スクリプトのコスト目安 (シード固定なので乱数分は概算) */
  private estimateSelectedCost(): number | null {
    const source = DANMAKU_SCRIPTS[this.scriptId]?.source ?? null;
    if (!source) return null;
    const origin = { x: this.player.pos.x, y: this.player.pos.y };
    const target = this.resolveTargetPosition(this.targetId ?? undefined);
    return this.engine.estimateCost(
      source,
      1,
      this.player.heading,
      () => origin,
      () => target,
    );
  }

  private waveHudLine(): string {
    const wave = this.lastWave ?? waveStateAt(Date.now());
    const remain = Math.max(0, Math.ceil((wave.phaseEndsAt - Date.now()) / 1000));
    if (wave.phase === 'assault') {
      return `wave: 第${wave.number}波 襲来中 (残り${remain}s)`;
    }
    const nextNumber = (wave.number % WAVES_PER_ROUND) + 1;
    return `wave: 小休止 (第${nextNumber}波まで ${remain}s)`;
  }

  private updateHud(): void {
    const scriptName = DANMAKU_SCRIPTS[this.scriptId]?.name ?? this.scriptId;
    this.fireBtn.setScriptName(scriptName);
    const estCost = this.estimateSelectedCost();
    this.fireBtn.setEnabled(
      estCost !== null &&
        this.player.energy >= estCost &&
        !this.engine.ownerHasRun(this.room.selfId),
    );
    const targetName = this.targetId
      ? (isNpcId(this.targetId)
          ? NPC_KINDS[
              this.localNpcs.find((npc) => npc.sim.id === this.targetId)?.sim.kind ??
                this.remoteNpcs.get(this.targetId)?.sim.kind ??
                'wisp'
            ].name
          : (this.remotes.get(this.targetId)?.sim.name ?? '?'))
      : 'なし (クリックで指定)';
    this.hud.textContent =
      `${this.name} (${this.room.selfId.slice(0, 8)})\n` +
      `HP: ${this.player.hp}/${MAX_HP}  EN: ${Math.floor(this.player.energy)}/${ENERGY_MAX}` +
      ` (コスト目安 ${estCost === null ? '-' : Math.ceil(estCost)})\n` +
      `relays: ${this.room.relayStatus}\n` +
      `peers: ${this.room.peerCount}\n` +
      `ice: ${iceSummary()}\n` +
      `${this.room.stats}\n` +
      `魔力灯: ${Math.ceil(this.baseDefense.hp())}/${BASE_MAX_HP}` +
      `${this.baseDefense.lit() ? '' : ' (消灯中: 全快で再点火)'}\n` +
      `${this.waveHudLine()}\n` +
      `enemies: ${this.localNpcs.filter((npc) => npc.sim.alive).length}` +
      ` local / ${this.remoteNpcs.size} remote\n` +
      `bullets: ${this.engine.aliveCount} fps: ${this.fps}\n` +
      `[Space]強攻撃 [1-4]切替: ${scriptName} (通常ショットは自動)\n` +
      `[Enter]チャット\n` +
      `target: ${targetName}`;
  }
}
