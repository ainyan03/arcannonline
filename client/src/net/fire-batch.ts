import { MAX_FIRE_BATCH, type FireEvent } from '../../../shared/src/protocol';

/** fires メッセージを理解する最初のプロトコル版。 */
export const FIRE_BATCH_PROTO_VERSION = 19;

export function supportsFireBatch(version: number | undefined): boolean {
  return version !== undefined && version >= FIRE_BATCH_PROTO_VERSION;
}

/** ピアごとの短時間通常弾キュー。上限到達時は呼び出し側が即時送信する。 */
export class FireBatchQueue {
  private pending: FireEvent[] = [];

  push(event: FireEvent): FireEvent[] | null {
    this.pending.push(event);
    return this.pending.length >= MAX_FIRE_BATCH ? this.drain() : null;
  }

  drain(): FireEvent[] {
    const events = this.pending;
    this.pending = [];
    return events;
  }

  get size(): number {
    return this.pending.length;
  }
}
