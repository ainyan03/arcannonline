// 同梱の弾幕スクリプト集。発射イベントはスクリプト ID だけを同期するため、
// 全クライアントが同じ定義を持っている必要がある (カスタムスクリプトの
// 実行時共有は今後の課題)。
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

// 同梱スクリプトは「1回の発射 = 1セット」を基本とする。連射量は発射ボタンの
// 長押し (クールダウン毎に再発射、離せば停止) でユーザーが制御する。
// 多段シーケンスも DSL としては書ける (spiral が見本)。
export const DANMAKU_SCRIPTS: Record<string, DanmakuScript> = {
  ring: {
    name: '全方位リング',
    source: `
let n = 24;
let i = 0;
loop (n) {
  fire(dir + i * 360 / n, 12, 2, 0.25);
  i = i + 1;
}
`,
  },
  spiral: {
    name: '双腕スパイラル',
    source: `
// シーケンス型の見本: 約1回転ぶん回りながら撃つ
let a = dir;
loop (26) {
  fire(a, 10, 1, 0.2);
  fire(a + 180, 10, 1, 0.2);
  a = a + 14;
  wait(2);
}
`,
  },
  spray: {
    name: '前方ショット',
    source: `
loop (6) {
  fire(dir + rand(0 - 25, 25), rand(10, 18), 1, 0.18);
}
`,
  },
  aimshot: {
    name: '狙い3way',
    source: `
    // aim は発射時点で固定したターゲット方向
fire(aim - 10, 16, 1, 0.2);
fire(aim, 18, 2, 0.22);
fire(aim + 10, 16, 1, 0.2);
`,
  },
};

export const DEFAULT_SCRIPT_ID = 'ring';
