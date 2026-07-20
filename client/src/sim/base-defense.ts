import {
  BASE_DAMAGE_WINDOW_MS,
  BASE_MAX_HP,
  BASE_SYNC_HITS_MAX,
  type BaseHitEvent,
} from '../../../shared/src/protocol';

const HIT_CACHE_MAX = BASE_SYNC_HITS_MAX * 2;
const FUTURE_TOLERANCE_MS = 10_000;

/**
 * 直近の拠点命中を集合としてマージする、管理者不要の拠点耐久状態。
 * 同じIDは一度しか加算されず、古いダメージは時間経過で自然回復する。
 */
export class BaseDefense {
  private readonly hits = new Map<string, BaseHitEvent>();
  /**
   * 点灯状態。消灯後はゲージが全快するまで点灯に戻さない (HP が 0 付近で
   * 揺れるたびに消灯/再点火がちらつくのを防ぐヒステリシス)。
   * 初期値は消灯側: 途中参加者は全快を確認できるまで消灯扱いにする
   * (点灯と誤認して自分の担当NPCが回復中の拠点を叩き続けるより害が小さい。
   * まっさらな部屋では初回の lit() が即座に点灯へ倒す)
   */
  private litState = false;

  apply(event: BaseHitEvent, now = Date.now()): boolean {
    if (
      this.hits.has(event.id) ||
      !event.id ||
      !Number.isFinite(event.damage) ||
      event.damage < 1 ||
      event.damage > BASE_MAX_HP ||
      !Number.isFinite(event.at) ||
      event.at > now + FUTURE_TOLERANCE_MS ||
      event.at <= now - BASE_DAMAGE_WINDOW_MS
    ) {
      return false;
    }
    this.hits.set(event.id, event);
    this.prune(now);
    return true;
  }

  merge(events: readonly BaseHitEvent[], now = Date.now()): number {
    let accepted = 0;
    for (const event of events) accepted += Number(this.apply(event, now));
    return accepted;
  }

  hp(now = Date.now()): number {
    this.prune(now);
    let damage = 0;
    for (const hit of this.hits.values()) damage += hit.damage;
    return Math.max(0, BASE_MAX_HP - damage);
  }

  /** 点灯中か。HP 0 で消灯し、全快で再点火する (途中では変化しない) */
  lit(now = Date.now()): boolean {
    const hp = this.hp(now);
    if (this.litState) {
      if (hp <= 0) this.litState = false;
    } else if (hp >= BASE_MAX_HP) {
      this.litState = true;
    }
    return this.litState;
  }

  snapshot(now = Date.now()): BaseHitEvent[] {
    this.prune(now);
    return [...this.hits.values()]
      .sort((a, b) => b.at - a.at)
      .slice(0, BASE_SYNC_HITS_MAX);
  }

  private prune(now: number): void {
    for (const [id, hit] of this.hits) {
      if (hit.at <= now - BASE_DAMAGE_WINDOW_MS) this.hits.delete(id);
    }
    if (this.hits.size <= HIT_CACHE_MAX) return;
    const oldest = [...this.hits.values()].sort((a, b) => a.at - b.at);
    for (let i = 0; i < oldest.length - HIT_CACHE_MAX; i++) {
      this.hits.delete(oldest[i].id);
    }
  }
}
