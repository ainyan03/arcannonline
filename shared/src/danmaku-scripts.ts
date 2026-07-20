// 同梱の弾幕スクリプト集。発射イベントはスクリプト ID だけを同期するため、
// 全クライアントが同じ定義を持っている必要がある。プレイヤー向け自由編集UIは
// 提供せず、ここで調整したプリセットだけをゲーム内に公開する。
//
// DSL の文法 (東方弾幕風系の最小サブセット):
//   let x = 式;          変数宣言
//   x = 式;              代入
//   loop (回数) { ... }   繰り返し
//   if (条件) { ... } else { ... }
//   wait(フレーム数);     指定 tick (1/60秒) 待つ
//   fire(角度deg, 速度, 耐久度, 半径, 残存時間秒);
//     弾を1発生成 (角度は絶対角。0=+x, 反時計回り)。残存時間は省略時4秒・上限8秒。
//     有効射程で決めたい場合は 射程/速度 を渡す (例: fire(a, 20, 1, 0.4, 30/20))
// 組み込み: dir (発射時の自機向き deg) / t (経過tick) / rand(a,b) /
//           sin cos (deg) / floor abs min max /
//           aim (発射時点のターゲットへの角度deg。未指定時はdir) /
//           tdist (ターゲットまでの距離。未指定時は-1)

export interface DanmakuScript {
  name: string;
  source: string;
}

/**
 * 通常ショット: 敵が近くにいると自動発射される、エネルギーを消費しない基本攻撃。
 * DANMAKU_SCRIPTS (強攻撃の選択肢) には含めず、ID で直接参照する。
 * 自動照準はせず、0.1秒に1発の連射を自機の向きへ小さな拡散で流す
 * (マシンガン風。狙いは移動で付ける)。ウィスプ (HP 24) は3発で撃破。
 * 射程 ≒ 速度 × 1.6秒 ≒ 35〜48
 */
export const NORMAL_SHOT_SCRIPT_ID = 'normal-shot';
export const NORMAL_SHOT_SCRIPT_SOURCE = `
fire(dir + rand(0 - 10, 10), rand(22, 30), 8, 0.2, 1.6);
`;

/**
 * クラス別の通常ショット。各クラスに「静止・低速時 (steady)」と
 * 「高速移動時 (moving = バラつき増)」の2段がある。
 * 接近時の実効DPSはどのクラスもおおむね 75〜85 に揃え、射程・精度・
 * テンポで差別化する (ウィスプ HP 24 が目安)
 */
export const CLASS_SHOT_SCRIPTS: Record<string, string> = {
  // 星: 基準。素直な連射
  'shot-star-steady': `fire(dir + rand(0 - 8, 8), rand(22, 30), 8, 0.2, 1.6);`,
  'shot-star-moving': `fire(dir + rand(0 - 14, 14), rand(22, 30), 8, 0.2, 1.6);`,
  // 箒: 高連射・軽量弾。移動速度が乗るぶん体感の弾道は荒れる
  'shot-broom-steady': `fire(dir + rand(0 - 12, 12), rand(24, 32), 6, 0.2, 1.4);`,
  'shot-broom-moving': `fire(dir + rand(0 - 20, 20), rand(24, 32), 6, 0.2, 1.4);`,
  // 月: 低速連射の重い狙撃弾。静止でレーザーのように収束する
  'shot-moon-steady': `fire(dir + rand(0 - 2, 2), rand(34, 38), 20, 0.24, 1.9);`,
  'shot-moon-moving': `fire(dir + rand(0 - 13, 13), rand(34, 38), 20, 0.24, 1.9);`,
  // 花: 短射程・広拡散のショットガン
  'shot-flower-steady': `loop (3) { fire(dir + rand(0 - 22, 22), rand(18, 26), 6, 0.2, 0.9); }`,
  'shot-flower-moving': `loop (3) { fire(dir + rand(0 - 30, 30), rand(18, 26), 6, 0.2, 0.9); }`,
};

/**
 * 箒のボム「スターダストトレイル」が飛行痕へ置いていく設置弾。
 * 発動中に一定間隔で発射され、通常の fires バッチで配布される
 */
export const TRAIL_SCRIPT_ID = 'broom-trail';
export const TRAIL_SCRIPT_SOURCE = `
fire(dir, 0, 10, 0.45, 2.5);
`;

/** トレイル終了時に軌跡を順番に爆発させる短命の星形弾。 */
export const TRAIL_BURST_SCRIPT_ID = 'broom-trail-burst';
export const TRAIL_BURST_SCRIPT_SOURCE = `
let i = 0;
loop (8) {
  fire(i * 45, 10, 8, 0.32, 0.65);
  i = i + 1;
}
`;

/** 通常ショット系の ID → ソース (受信側の再生用。旧 normal-shot も含む) */
export const PLAYER_SHOT_SOURCES: Record<string, string> = {
  [NORMAL_SHOT_SCRIPT_ID]: NORMAL_SHOT_SCRIPT_SOURCE,
  [TRAIL_SCRIPT_ID]: TRAIL_SCRIPT_SOURCE,
  [TRAIL_BURST_SCRIPT_ID]: TRAIL_BURST_SCRIPT_SOURCE,
  ...CLASS_SHOT_SCRIPTS,
};

// 同梱スクリプトは「強攻撃」— エネルギーを消費する代わりに敵 (HP 24) を
// 一撃〜数発で倒せる火力を持つ。高威力ぶん残存時間を短くして射程を
// 近〜中距離 (約16〜29) に絞り、遠方への安全な狙撃はできないようにする。
// 「1回の発射 = 1セット」を基本とし、連射量は発射ボタンの長押し
// (クールダウン毎に再発射、離せば停止) でユーザーが制御する。
// 多段シーケンスも DSL としては書ける (spiral が見本)。
export const DANMAKU_SCRIPTS: Record<string, DanmakuScript> = {
  ring: {
    name: '全方位リング',
    source: `
// 周囲一掃: 全方位を一撃で薙ぎ払う大技 (ほぼ全エネルギーを使う)。射程 ≒ 19
let n = 24;
let i = 0;
loop (n) {
  fire(dir + i * 360 / n, 12, 24, 0.25, 1.6);
  i = i + 1;
}
`,
  },
  spiral: {
    name: '双腕スパイラル',
    source: `
// シーケンス型の見本: 約1回転ぶん回りながら撃つ (2発で撃破の面制圧)。射程 ≒ 18
let a = dir;
loop (26) {
  fire(a, 10, 12, 0.2, 1.8);
  fire(a + 180, 10, 12, 0.2, 1.8);
  a = a + 14;
  wait(2);
}
`,
  },
  spray: {
    name: '前方ショット',
    source: `
// 前方の敵をまとめて一撃で倒す近距離ショット。射程 ≒ 16〜29
loop (6) {
  fire(dir + rand(0 - 25, 25), rand(10, 18), 24, 0.18, 1.6);
}
`,
  },
  aimshot: {
    name: '狙い3way',
    source: `
    // aim は発射時点で固定したターゲット方向。中央弾は一撃で撃破できる。射程 ≒ 26〜29
fire(aim - 10, 16, 12, 0.2, 1.6);
fire(aim, 18, 24, 0.22, 1.6);
fire(aim + 10, 16, 12, 0.2, 1.6);
`,
  },
  garden: {
    name: 'ブルームガーデン',
    source: `
// 花園の中心から咲き続ける花弁弾。直接ダメージの周期パルスとは別に、
// 敵弾との相殺と画面上の密度を担当する
let ring = 0;
loop (4) {
  let n = 12 + ring * 4;
  let i = 0;
  loop (n) {
    fire(i * 360 / n + ring * 11, 2 + ring * 0.8, 4, 0.25, 4);
    i = i + 1;
  }
  ring = ring + 1;
  wait(30);
}
`,
  },
};


export const DEFAULT_SCRIPT_ID = 'ring';

/**
 * 見た目プリセット (appearance.s) ごとの固定ボム (強攻撃) の DSL スクリプト。
 * 星 (スターノヴァ)・箒 (スターダストトレイル)・月 (マジックミサイル) は
 * DSL を使わない特殊経路のため、この表は 花 (ブルームガーデン) と
 * 未知プリセットのフォールバックにだけ使われる
 */
export const CLASS_BOMB_SCRIPT_IDS = [
  'ring',
  'spray',
  'aimshot',
  'garden',
] as const;

export function bombScriptIdFor(styleIndex: number | undefined): string {
  return CLASS_BOMB_SCRIPT_IDS[styleIndex ?? 0] ?? DEFAULT_SCRIPT_ID;
}
