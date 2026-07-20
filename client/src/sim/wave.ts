// ウェーブ制の決定論スケジュール。
// サーバもリーダーも置かず、壁時計 (エポックms) から全クライアントが
// 独立に同じウェーブ番号・フェーズを算出する。端末間の時計ずれは
// 高々数秒で、フェーズ境界の見え方がずれるだけに留まる
// (敵の実体は担当ピアの時計に従うため、1体の敵の挙動は常に一貫する)。
import type { NpcKind } from '../../../shared/src/protocol';

/** 襲来フェーズの長さ */
export const WAVE_ASSAULT_MS = 75_000;
/** 小休止フェーズの長さ (この間は倒された敵が再出現しない) */
export const WAVE_CALM_MS = 15_000;
/** 1ウェーブの周期 */
export const WAVE_CYCLE_MS = WAVE_ASSAULT_MS + WAVE_CALM_MS;
/** 1ラウンドのウェーブ数。最終波が最も強く、次のラウンドで振り出しに戻る */
export const WAVES_PER_ROUND = 5;

export interface WaveState {
  /** エポックからの通算ウェーブ番号 (内部用) */
  index: number;
  /** 表示用のラウンド内ウェーブ番号 (1〜WAVES_PER_ROUND) */
  number: number;
  /** 難易度段階 (0〜WAVES_PER_ROUND-1) */
  tier: number;
  phase: 'assault' | 'calm';
  /** 現フェーズの終了時刻 (エポックms) */
  phaseEndsAt: number;
}

/** 壁時計 (Date.now) から現在のウェーブ状態を決定論的に算出する */
export function waveStateAt(nowMs: number): WaveState {
  const index = Math.floor(nowMs / WAVE_CYCLE_MS);
  const cycleStart = index * WAVE_CYCLE_MS;
  const inCycle = nowMs - cycleStart;
  const assault = inCycle < WAVE_ASSAULT_MS;
  const tier = ((index % WAVES_PER_ROUND) + WAVES_PER_ROUND) % WAVES_PER_ROUND;
  return {
    index,
    number: tier + 1,
    tier,
    phase: assault ? 'assault' : 'calm',
    phaseEndsAt: cycleStart + (assault ? WAVE_ASSAULT_MS : WAVE_CYCLE_MS),
  };
}

/**
 * ウェーブ段階に応じた敵の強さ (1 = 基準)。
 * 攻撃間隔は 1/aggression 倍、移動速度は緩やかに追従する (npc.ts 参照)
 */
export function waveAggression(tier: number): number {
  return 1 + tier * 0.25;
}

/**
 * ウェーブ段階ごとの敵編成 (スロット順)。波が進むほど特殊型が混ざる。
 * 倒された敵は次の再出現からこの編成に従う (生存中の敵は変化しない)
 */
export const WAVE_COMPOSITION: readonly (readonly NpcKind[])[] = [
  ['wisp', 'wisp', 'wisp', 'wisp'],
  ['wisp', 'wisp', 'wisp', 'rusher'],
  ['wisp', 'wisp', 'rusher', 'turret'],
  ['wisp', 'rusher', 'turret', 'shield'],
  ['rusher', 'rusher', 'turret', 'shield'],
];
