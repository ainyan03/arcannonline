import * as THREE from 'three';
import {
  FIELD_SIZE,
  PLAYER_SPEED,
  type StatePayload,
  type Vec2,
} from '../../../shared/src/protocol';
import { colorFromString, createAvatar } from './avatar';

const BOUND = FIELD_SIZE / 2 - 1;

/** 自機。2D 座標で移動演算し、XZ 平面へ写像して描画する。 */
export class LocalPlayer {
  readonly object: THREE.Group;
  readonly pos: Vec2;
  heading = 0;

  private readonly vel: Vec2 = { x: 0, y: 0 };
  private readonly worldPosTmp = new THREE.Vector3();
  private seq = 0;

  constructor(spawn: Vec2, private readonly name: string) {
    this.pos = { ...spawn };
    this.object = createAvatar(colorFromString(name), name);
    this.syncObject();
  }

  update(dt: number, move: Vec2): void {
    this.vel.x = move.x * PLAYER_SPEED;
    this.vel.y = move.y * PLAYER_SPEED;
    if (move.x !== 0 || move.y !== 0) {
      this.pos.x = THREE.MathUtils.clamp(this.pos.x + this.vel.x * dt, -BOUND, BOUND);
      this.pos.y = THREE.MathUtils.clamp(this.pos.y + this.vel.y * dt, -BOUND, BOUND);
      this.heading = Math.atan2(move.y, move.x);
      this.syncObject();
    }
  }

  get worldPos(): THREE.Vector3 {
    return this.worldPosTmp.set(this.pos.x, 0, this.pos.y);
  }

  makeState(): StatePayload {
    return {
      n: this.name,
      seq: this.seq++,
      x: this.pos.x,
      y: this.pos.y,
      vx: this.vel.x,
      vy: this.vel.y,
      h: this.heading,
    };
  }

  private syncObject(): void {
    this.object.position.set(this.pos.x, 0, this.pos.y);
    this.object.rotation.y = -this.heading;
  }
}
