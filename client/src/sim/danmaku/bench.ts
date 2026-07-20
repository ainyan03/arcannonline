// 弾幕エンジンの単体ベンチマーク。ブラウザのコンソールから
// __arcBench() で実行する。WASM 化の要否判断用。
//
// シナリオ A: 全弾同一オーナー = 衝突ダメージなし。移動・場外カリング・
//   空間ハッシュ構築・近傍走査のコストを持続的な弾数で測る
// シナリオ B: 4オーナー混在 = 実戦相当。相殺で弾数が減っていくため
//   序盤 10 tick だけを測る
import { BulletEngine } from './engine';

interface BenchStats {
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

function percentile(sorted: number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function measure(engine: BulletEngine, iters: number): BenchStats {
  const samples: number[] = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    engine.tick();
    samples.push(performance.now() - t0);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    mean: samples.reduce((sum, ms) => sum + ms, 0) / samples.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function formatStats(stats: BenchStats): string {
  return `平均 ${stats.mean.toFixed(2)} / p50 ${stats.p50.toFixed(2)}` +
    ` / p95 ${stats.p95.toFixed(2)} / p99 ${stats.p99.toFixed(2)} ms/tick`;
}

export function benchEngine(
  counts: number[] = [8_000, 20_000, 50_000],
): string {
  const lines: string[] = [];

  for (const n of counts) {
    const engine = new BulletEngine(n + 100, Infinity);
    engine.debugFill(n, 1, 1); // 同一オーナー: 相殺なし
    for (let i = 0; i < 5; i++) engine.tick(); // ウォームアップ (JIT)
    const stats = measure(engine, 100);
    lines.push(
      `A(衝突なし) ${n.toLocaleString()}発: ${formatStats(stats)}` +
        ` (生存 ${engine.aliveCount.toLocaleString()})`,
    );
  }

  for (const n of counts) {
    const engine = new BulletEngine(n + 100, Infinity);
    engine.debugFill(n, 1, 4); // 4オーナー混在: 相殺あり
    const before = engine.aliveCount;
    const stats = measure(engine, 10);
    lines.push(
      `B(実戦相当) ${n.toLocaleString()}発: ${formatStats(stats)}` +
        ` (10tickで ${before.toLocaleString()} → ${engine.aliveCount.toLocaleString()})`,
    );
  }

  return lines.join('\n');
}
