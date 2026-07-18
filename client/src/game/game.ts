import { STATE_INTERVAL_MS, type Vec2 } from '../../../shared/src/protocol';
import { GameRoom } from '../net/room';
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
  private readonly room: GameRoom;
  private readonly hud: HTMLElement;

  private lastFrame = 0;
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

    this.room = new GameRoom();
    this.room.onState = (id, state) => {
      let remote = this.remotes.get(id);
      if (!remote) {
        remote = new RemotePlayer(state.n);
        this.remotes.set(id, remote);
        this.world.scene.add(remote.object);
        this.updateHud();
      }
      remote.pushState(state);
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
    window.addEventListener('beforeunload', () => this.room.leave());

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
      if (this.room.peerCount > 0) {
        this.room.broadcastState(this.player.makeState());
      }
      // HUD は rAF (描画) 停止中のバックグラウンドでも最新値を保つ
      this.updateHud();
    }, STATE_INTERVAL_MS);
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

  private updateHud(): void {
    this.hud.textContent =
      `${this.name} (${this.room.selfId.slice(0, 8)})\n` +
      `relays: ${this.room.relayStatus}\n` +
      `peers: ${this.room.peerCount}\n` +
      `${this.room.stats}`;
  }
}
