import type { BulletCollisionEvent } from '../../../shared/src/protocol';
import { BulletEngine } from '../sim/danmaku/engine';
import {
  canResolveCollisionLocally,
  collisionAuthority,
  isAuthorizedCollision,
} from '../sim/collision-authority';
import { GameRoom } from '../net/room';

const COLLISION_AUTHORITY_VERSION = 6;
const SEEN_COLLISIONS_MAX = 2_000;

/** 衝突担当選出、耐久同期、旧プロトコル互換をGame本体から分離する。 */
export class BulletSync {
  private readonly peerVersions = new Map<string, number>();
  private readonly seen = new Set<string>();

  constructor(
    private readonly engine: BulletEngine,
    private readonly room: GameRoom,
  ) {
    engine.canResolveCollision = (a, b) => {
      const authority = collisionAuthority(a.owner, b.owner);
      return canResolveCollisionLocally(
        room.selfId,
        authority,
        this.peerVersions.get(authority),
        COLLISION_AUTHORITY_VERSION,
      );
    };
    engine.onCollision = (a, b, damageA, damageB) => {
      if (!a.fireId || !b.fireId) return;
      const event: BulletCollisionEvent = {
        id: crypto.randomUUID(),
        a: { f: a.fireId, i: a.spawnIdx, o: a.owner },
        b: { f: b.fireId, i: b.spawnIdx, o: b.owner },
        da: damageA,
        db: damageB,
      };
      this.remember(event.id);
      room.broadcastBulletCollision(event);
    };
    room.onBulletCollision = (fromId, event) => this.receive(fromId, event);
  }

  notePeerVersion(peerId: string, version: number): void {
    this.peerVersions.set(peerId, version);
  }

  removePeer(peerId: string): void {
    this.peerVersions.delete(peerId);
  }

  private receive(fromId: string, event: BulletCollisionEvent): void {
    if (this.seen.has(event.id) || !isAuthorizedCollision(fromId, event)) return;
    this.remember(event.id);
    this.engine.damageByFire(event.a.f, event.a.i, event.da, event.a.o);
    this.engine.damageByFire(event.b.f, event.b.i, event.db, event.b.o);
  }

  private remember(id: string): void {
    this.seen.add(id);
    if (this.seen.size <= SEEN_COLLISIONS_MAX) return;
    const it = this.seen.values();
    for (let i = 0; i < SEEN_COLLISIONS_MAX / 2; i++) {
      this.seen.delete(it.next().value as string);
    }
  }
}
