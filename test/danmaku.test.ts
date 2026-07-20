import { describe, expect, it } from 'vitest';
import { DANMAKU_SCRIPTS } from '../shared/src/danmaku-scripts';
import { BulletEngine } from '../client/src/sim/danmaku/engine';

describe('BulletEngine', () => {
  it('accepts every bundled spell within the VM budgets', () => {
    const engine = new BulletEngine();
    for (const spell of Object.values(DANMAKU_SCRIPTS)) {
      expect(engine.estimateCost(spell.source, 1, 0, () => ({ x: 0, y: 0 })))
        .not.toBeNull();
    }
  });

  it('replays the same frozen event deterministically', () => {
    const source = 'loop (4) { fire(aim, 10, 1, 0.2, 2); wait(2); }';
    const snapshots = [new BulletEngine(), new BulletEngine()].map((engine) => {
      engine.startScript(source, 123, () => ({ x: 2, y: 3 }), 0, 'owner',
        () => ({ x: 8, y: 7 }), 0, 'fire-id');
      for (let i = 0; i < 30; i++) engine.tick();
      return engine.bullets.filter((b) => b.alive).map(({ x, y, vx, vy, ttl, spawnIdx }) =>
        ({ x, y, vx, vy, ttl, spawnIdx }));
    });
    expect(snapshots[0]).toEqual(snapshots[1]);
  });

  it('expires the oldest owned bullet at the per-owner cap', () => {
    const engine = new BulletEngine(20, 3);
    engine.startScript('loop (4) { fire(0, 1, 1, 0.2); }', 1,
      () => ({ x: 0, y: 0 }), 0, 'owner');
    engine.tick();
    expect(engine.aliveOwned('owner')).toBe(3);
    expect(engine.bullets.filter((b) => b.alive).map((b) => b.spawnIdx).sort())
      .toEqual([1, 2, 3]);
  });

  it('expires bullets after the default 4s life and caps requested life at 8s', () => {
    const engine = new BulletEngine();
    // 速度0で場外カリングを避け、寿命だけで消えることを確認する
    // (位置を離し、所有者の異なる弾同士の相殺も避ける)
    engine.startScript('fire(0, 0, 1, 0.2);', 1, () => ({ x: -20, y: 0 }), 0, 'a');
    engine.startScript('fire(0, 0, 1, 0.2, 60);', 1, () => ({ x: 20, y: 0 }), 0, 'b');
    for (let i = 0; i < 60 * 4 + 2; i++) engine.tick();
    expect(engine.aliveOwned('a')).toBe(0); // 既定4秒で消滅
    expect(engine.aliveOwned('b')).toBe(1); // 明示指定は4秒を超えて生存
    for (let i = 0; i < 60 * 4 + 2; i++) engine.tick();
    expect(engine.aliveOwned('b')).toBe(0); // ただし上限8秒でキャップ
  });

  it('adds the firing source velocity to every spawned bullet', () => {
    const engine = new BulletEngine();
    engine.startScript(
      'fire(0, 10, 1, 0.2);',
      1,
      () => ({ x: 0, y: 0 }),
      0,
      'owner',
      undefined,
      0,
      'fire-id',
      { x: 3, y: -2 },
    );
    engine.tick();
    const bullet = engine.bullets.find((b) => b.alive);
    expect(bullet?.vx).toBeCloseTo(13);
    expect(bullet?.vy).toBeCloseTo(-2);
  });

  it('rejects scripts that cannot finish within the duration budget', () => {
    const engine = new BulletEngine();
    expect(engine.estimateCost('wait(999999);', 1, 0, () => ({ x: 0, y: 0 })))
      .toBeNull();
  });
});
