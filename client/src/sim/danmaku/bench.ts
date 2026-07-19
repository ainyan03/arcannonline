// 弾幕エンジンの単体ベンチマーク。ブラウザのコンソールから
// __arcBench() で実行する。WASM 化の要否判断用。
//
// シナリオ A: 全弾同一オーナー = 衝突ダメージなし。移動・場外カリング・
//   空間ハッシュ構築・近傍走査のコストを持続的な弾数で測る
// シナリオ B: 4オーナー混在 = 実戦相当。相殺で弾数が減っていくため
//   序盤 10 tick だけを測る
import { BulletEngine } from './engine';

function measure(engine: BulletEngine, iters: number): number {
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) engine.tick();
  return (performance.now() - t0) / iters;
}

export function benchEngine(
  counts: number[] = [8_000, 20_000, 50_000],
): string {
  const lines: string[] = [];

  for (const n of counts) {
    const engine = new BulletEngine(n + 100, Infinity);
    engine.debugFill(n, 1, 1); // 同一オーナー: 相殺なし
    for (let i = 0; i < 5; i++) engine.tick(); // ウォームアップ (JIT)
    const ms = measure(engine, 30);
    lines.push(
      `A(衝突なし) ${n.toLocaleString()}発: ${ms.toFixed(2)} ms/tick` +
        ` (生存 ${engine.aliveCount.toLocaleString()})`,
    );
  }

  for (const n of counts) {
    const engine = new BulletEngine(n + 100, Infinity);
    engine.debugFill(n, 1, 4); // 4オーナー混在: 相殺あり
    const before = engine.aliveCount;
    const ms = measure(engine, 10);
    lines.push(
      `B(実戦相当) ${n.toLocaleString()}発: ${ms.toFixed(2)} ms/tick` +
        ` (10tickで ${before.toLocaleString()} → ${engine.aliveCount.toLocaleString()})`,
    );
  }

  return lines.join('\n');
}
