import type { BulletCollisionEvent } from '../../../shared/src/protocol';
import { isNpcId } from '../../../shared/src/validation';

export function ownerPeerId(owner: string): string {
  return isNpcId(owner) ? owner.slice(0, 64) : owner;
}

/** 管理者を置かず、弾所有ピアIDだけから衝突確定担当を選ぶ。 */
export function collisionAuthority(ownerA: string, ownerB: string): string {
  const a = ownerPeerId(ownerA);
  const b = ownerPeerId(ownerB);
  return a < b ? a : b;
}

/**
 * 相手の版が未判明な接続直後は、両端が同じ衝突を確定しないよう短時間保留する。
 * 旧版だと判明した場合だけ、新版側が互換処理として代理確定する。
 */
export function canResolveCollisionLocally(
  selfId: string,
  authority: string,
  authorityVersion: number | undefined,
  distributedCollisionVersion: number,
): boolean {
  return authority === selfId || (
    authorityVersion !== undefined &&
    authorityVersion < distributedCollisionVersion
  );
}

export function isAuthorizedCollision(
  fromId: string,
  event: BulletCollisionEvent,
): boolean {
  if (isNpcId(event.a.o) === isNpcId(event.b.o)) return false;
  return collisionAuthority(event.a.o, event.b.o) === fromId;
}
