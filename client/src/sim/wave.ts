// ウェーブ制の決定論スケジュール。
// サーバもリーダーも置かず、壁時計 (エポックms) から全クライアントが
// 独立に同じウェーブ番号・フェーズを算出する。端末間の時計ずれは
// 接続ピア群の中央値へ寄せ、単一端末の大きな時計ずれを抑える
// (敵の実体は担当ピアの時計に従うため、1体の敵の挙動は常に一貫する)。
import type { NpcKind } from '../../../shared/src/protocol';

/** 襲来フェーズの長さ */
export const WAVE_ASSAULT_MS = 75_000;
/** 小休止フェーズの長さ (この間は倒された敵が再出現しない) */
export const WAVE_CALM_MS = 15_000;
/** 1ウェーブの周期 */
export const WAVE_CYCLE_MS = WAVE_ASSAULT_MS + WAVE_CALM_MS;
/** 1ラウンドのウェーブ数。最終波が最も強く、その後にボス段が来る */
export const WAVES_PER_ROUND = 5;
/** 1ラウンドの区分数 (第1〜5波 + ボス段) */
export const SEGMENTS_PER_ROUND = WAVES_PER_ROUND + 1;
/** 1ラウンドの長さ */
export const ROUND_MS = SEGMENTS_PER_ROUND * WAVE_CYCLE_MS;

export interface WaveState {
  /** エポックからの通算区分番号 (内部用) */
  index: number;
  /** エポックからの通算ラウンド番号 (ボスの撃破管理・HP引き継ぎに使う) */
  round: number;
  /** 表示用のラウンド内ウェーブ番号 (1〜WAVES_PER_ROUND。ボス段は WAVES_PER_ROUND) */
  number: number;
  /** 難易度段階 (0〜WAVES_PER_ROUND-1。ボス段は最終段扱い) */
  tier: number;
  /** ボス段か (第5波の後の1区分。雑魚は再出現せず、ボスが襲来する) */
  boss: boolean;
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
  const segment =
    ((index % SEGMENTS_PER_ROUND) + SEGMENTS_PER_ROUND) % SEGMENTS_PER_ROUND;
  const boss = segment === WAVES_PER_ROUND;
  const tier = boss ? WAVES_PER_ROUND - 1 : segment;
  return {
    index,
    round: Math.floor(nowMs / ROUND_MS),
    number: boss ? WAVES_PER_ROUND : segment + 1,
    tier,
    boss,
    phase: assault ? 'assault' : 'calm',
    phaseEndsAt: cycleStart + (assault ? WAVE_ASSAULT_MS : WAVE_CYCLE_MS),
  };
}

/**
 * 自分を含むピア群の時計の中央値へローカル時刻を寄せる。
 * skew は RemotePlayerSim の「自分の受信時刻 - 相手の送信時刻」。自分自身の
 * skew=0 も標本へ含め、単一の時計異常ピアにウェーブ全体を引きずられにくくする。
 */
export function correctedRoomNow(
  localNow: number,
  observedSkews: readonly number[],
): number {
  const samples = [0, ...observedSkews.filter(Number.isFinite)].sort((a, b) => a - b);
  const middle = Math.floor(samples.length / 2);
  const median = samples.length % 2 === 1
    ? samples[middle]
    : (samples[middle - 1] + samples[middle]) / 2;
  return localNow - median;
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
  ['wisp', 'wisp', 'wisp', 'wisp', 'wisp', 'wisp', 'wisp', 'wisp'],
  ['wisp', 'wisp', 'wisp', 'wisp', 'wisp', 'wisp', 'rusher', 'rusher'],
  ['wisp', 'wisp', 'wisp', 'wisp', 'rusher', 'rusher', 'turret', 'turret'],
  ['wisp', 'wisp', 'wisp', 'rusher', 'rusher', 'turret', 'turret', 'shield'],
  ['wisp', 'wisp', 'rusher', 'rusher', 'rusher', 'turret', 'turret', 'shield'],
];
