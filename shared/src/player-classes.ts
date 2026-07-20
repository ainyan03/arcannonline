// プレイヤーのクラス (見た目プリセット appearance.s) ごとの特性。
// 位置・速度は自己申告のため移動特性は完全ローカルで、同期には影響しない。
// 通信検証の上限 (PLAYER_SPEED_MAX) だけが共有の約束になる。
import { PLAYER_SPEED, TRAIL_BOOST_MUL } from './protocol';

export interface ClassMovement {
  /** 最高速度 (PLAYER_SPEED 比) */
  speedMul: number;
  /** 速度追従の速さ (1/s)。小さいほど慣性が強い */
  accelRate: number;
  /**
   * 巡航速度 (PLAYER_SPEED 比)。0 より大きいクラスは完全停止できず、
   * 入力がなくても現在の向きへこの速度で飛び続ける (箒)
   */
  cruiseMul: number;
}

/** 見た目プリセット順: 星の魔法少女 / 箒の魔女 / 月の魔導士 / 花の魔女 */
export const CLASS_MOVEMENTS: readonly ClassMovement[] = [
  // 星: 基準
  { speedMul: 1, accelRate: 8, cruiseMul: 0 },
  // 箒: 高速・強慣性。止まれない (巡航あり)
  { speedMul: 1.25, accelRate: 4.5, cruiseMul: 0.6 },
  // 月: 低速だがキビキビ動く (狙撃クラスの布石)
  { speedMul: 0.9, accelRate: 12, cruiseMul: 0 },
  // 花: 基準 (差別化は通常ショット側で行う)
  { speedMul: 1, accelRate: 8, cruiseMul: 0 },
];

export function classMovementFor(styleIndex: number | undefined): ClassMovement {
  return CLASS_MOVEMENTS[styleIndex ?? 0] ?? CLASS_MOVEMENTS[0];
}

/**
 * クラス補正・一時ブースト (スターダストトレイル) 込みの最高移動速度。
 * 発射イベント等の速度検証の上限に使う
 */
export const PLAYER_SPEED_MAX =
  PLAYER_SPEED *
  Math.max(...CLASS_MOVEMENTS.map((c) => c.speedMul)) *
  TRAIL_BOOST_MUL;

export interface ClassShot {
  /** 通常ショットのクールダウン (ms) */
  cooldownMs: number;
  /** 静止・低速時のスクリプトID */
  steadyScriptId: string;
  /** 高速移動時のスクリプトID (バラつき増) */
  movingScriptId: string;
}

/** 見た目プリセット順の通常ショット特性 */
export const CLASS_SHOTS: readonly ClassShot[] = [
  // 星: 基準の連射
  {
    cooldownMs: 100,
    steadyScriptId: 'shot-star-steady',
    movingScriptId: 'shot-star-moving',
  },
  // 箒: さらに高い連射 (弾は軽い)
  {
    cooldownMs: 80,
    steadyScriptId: 'shot-broom-steady',
    movingScriptId: 'shot-broom-moving',
  },
  // 月: 低速連射の狙撃弾
  {
    cooldownMs: 250,
    steadyScriptId: 'shot-moon-steady',
    movingScriptId: 'shot-moon-moving',
  },
  // 花: ショットガン
  {
    cooldownMs: 220,
    steadyScriptId: 'shot-flower-steady',
    movingScriptId: 'shot-flower-moving',
  },
];

export function classShotFor(styleIndex: number | undefined): ClassShot {
  return CLASS_SHOTS[styleIndex ?? 0] ?? CLASS_SHOTS[0];
}

/** 最高速度に対するこの割合を超える移動中は、バラつきの大きい弾道になる */
export const MOVING_SHOT_SPEED_RATIO = 0.55;

/** 現在速度に応じた通常ショットのスクリプトID (移動中はバラつき増) */
export function shotScriptIdFor(
  styleIndex: number | undefined,
  speed: number,
): string {
  const shot = classShotFor(styleIndex);
  const maxSpeed = PLAYER_SPEED * classMovementFor(styleIndex).speedMul;
  return speed > maxSpeed * MOVING_SHOT_SPEED_RATIO
    ? shot.movingScriptId
    : shot.steadyScriptId;
}
