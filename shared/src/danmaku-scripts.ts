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
//   fire(角度deg, 速度, 耐久度, 半径);   弾を1発生成 (角度は絶対角。0=+x, 反時計回り)
// 組み込み: dir (発射時の自機向き deg) / t (経過tick) / rand(a,b) /
//           sin cos (deg) / floor abs min max

export interface DanmakuScript {
  name: string;
  source: string;
}

export const DANMAKU_SCRIPTS: Record<string, DanmakuScript> = {
  ring: {
    name: '全方位リング',
    source: `
let n = 24;
loop (6) {
  let i = 0;
  loop (n) {
    fire(dir + i * 360 / n, 12, 2, 0.5);
    i = i + 1;
  }
  wait(20);
}
`,
  },
  spiral: {
    name: '双腕スパイラル',
    source: `
let a = dir;
loop (180) {
  fire(a, 10, 1, 0.4);
  fire(a + 180, 10, 1, 0.4);
  a = a + 7;
  wait(2);
}
`,
  },
  spray: {
    name: '前方ばらまき',
    source: `
loop (60) {
  fire(dir + rand(0 - 30, 30), rand(8, 16), 1, 0.35);
  wait(3);
}
`,
  },
};

export const DEFAULT_SCRIPT_ID = 'ring';
