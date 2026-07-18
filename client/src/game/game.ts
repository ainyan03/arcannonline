import {
  DEFAULT_SIGNALING_PORT,
  P2P_STATE_INTERVAL_MS,
  POS_REPORT_INTERVAL_MS,
  type Vec2,
} from '../../../shared/src/protocol';
import { PeerManager } from '../net/peer-manager';
import { SignalingClient, type SignalingStatus } from '../net/signaling';
import { FollowCamera } from './camera';
import { Keyboard } from './input';
import { LocalPlayer } from './local-player';
import { RemotePlayer } from './remote-player';
import { createWorld, type World } from './world';

const SPAWN_RANGE = 30;

/** ゲーム全体のオーケストレーション: 描画ループ・入力・ネットワーク送受信。 */
export class Game {
  private readonly world: World;
  private readonly camera: FollowCamera;
  private readonly input = new Keyboard();
  private readonly player: LocalPlayer;
  private readonly remotes = new Map<string, RemotePlayer>();
  private readonly signaling = new SignalingClient();
  private readonly peers: PeerManager;
  private readonly hud: HTMLElement;

  private serverStatus: SignalingStatus = 'connecting';
  private lastFrame = 0;
  private stateTimer = 0;
  private posTimer = 0;
  private hudTimer = 0;

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

    this.peers = new PeerManager(this.signaling);
    this.peers.onPeerOpen = (info) => {
      if (this.remotes.has(info.id)) return;
      const remote = new RemotePlayer(info);
      this.remotes.set(info.id, remote);
      this.world.scene.add(remote.object);
    };
    this.peers.onPeerClosed = (id) => {
      const remote = this.remotes.get(id);
      if (remote) {
        this.remotes.delete(id);
        this.world.scene.remove(remote.object);
      }
    };
    this.peers.onRemoteState = (id, msg) => {
      this.remotes.get(id)?.pushState(msg);
    };

    this.signaling.onStatus = (s) => {
      this.serverStatus = s;
      this.updateHud();
    };
    this.signaling.onWelcome = () => this.updateHud();

    window.addEventListener('resize', () => {
      this.world.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.resize(window.innerWidth / window.innerHeight);
    });

    const url = `ws://${location.hostname}:${DEFAULT_SIGNALING_PORT}`;
    this.signaling.connect(url, name, spawn);
  }

  start(): void {
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private frame(now: number): void {
    const dtMs = Math.min(now - this.lastFrame, 50);
    this.lastFrame = now;
    const dt = dtMs / 1000;

    this.player.update(dt, this.input.moveDir(this.camera.yaw));

    this.stateTimer += dtMs;
    if (this.stateTimer >= P2P_STATE_INTERVAL_MS) {
      this.stateTimer = 0;
      this.peers.broadcastState(this.player.makeState());
    }

    this.posTimer += dtMs;
    if (this.posTimer >= POS_REPORT_INTERVAL_MS) {
      this.posTimer = 0;
      this.signaling.sendPos(this.player.pos);
    }

    for (const remote of this.remotes.values()) remote.update();

    this.camera.update(this.player.worldPos);
    this.world.renderer.render(this.world.scene, this.camera.camera);

    this.hudTimer += dtMs;
    if (this.hudTimer >= 500) {
      this.hudTimer = 0;
      this.updateHud();
    }
  }

  private updateHud(): void {
    const id = this.signaling.id ? this.signaling.id.slice(0, 8) : '--------';
    this.hud.textContent =
      `${this.name} (${id})\n` +
      `server: ${this.serverStatus}\n` +
      `peers: ${this.peers.openCount}/${this.peers.totalCount} open`;
  }
}
