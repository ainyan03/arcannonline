import { describe, expect, it } from 'vitest';
import {
  CLASS_BOMB_SCRIPT_IDS,
  DANMAKU_SCRIPTS,
  NORMAL_SHOT_SCRIPT_SOURCE,
  bombScriptIdFor,
} from '../shared/src/danmaku-scripts';
import { BulletEngine } from '../client/src/sim/danmaku/engine';

describe('class bombs', () => {
  it('maps every appearance preset to a bundled script', () => {
    expect(CLASS_BOMB_SCRIPT_IDS).toHaveLength(4);
    for (const id of CLASS_BOMB_SCRIPT_IDS) {
      expect(DANMAKU_SCRIPTS[id]).toBeDefined();
    }
    expect(bombScriptIdFor(1)).toBe('spray');
    // 範囲外・未指定は既定 (星の全方位リング) へ倒す
    expect(bombScriptIdFor(undefined)).toBe('ring');
    expect(bombScriptIdFor(9)).toBe('ring');
  });
});

describe('BulletEngine', () => {
  it('accepts every bundled spell within the VM budgets', () => {
    const engine = new BulletEngine();
    for (const spell of Object.values(DANMAKU_SCRIPTS)) {
      expect(engine.estimateCost(spell.source, 1, 0, () => ({ x: 0, y: 0 })))
        .not.toBeNull();
    }
    expect(
      engine.estimateCost(NORMAL_SHOT_SCRIPT_SOURCE, 1, 0, () => ({ x: 0, y: 0 })),
    ).not.toBeNull();
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

  it('shrinks bullets (visual and hit radius) during their final second', () => {
    const engine = new BulletEngine();
    engine.startScript('fire(0, 0, 1, 0.2);', 1, () => ({ x: 0, y: 0 }), 0, 'a');
    for (let i = 0; i < 60 * 3; i++) engine.tick(); // 3.0秒: まだ全サイズ
    const bullet = engine.bullets.find((b) => b.alive)!;
    expect(bullet.radius).toBeCloseTo(0.2, 5);
    for (let i = 0; i < 30; i++) engine.tick(); // 3.5秒: 残り0.5秒 → 縮小中
    expect(bullet.radius).toBeLessThan(0.15);
    expect(bullet.radius).toBeGreaterThan(0.05);
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

  it('removes bullets at obstacles on fixed ticks using the bullet radius', () => {
    const engine = new BulletEngine();
    engine.setObstacles([{ x: 2, y: 0, r: 1 }]);
    // 中心は円の外を通るが、半径 0.5 の弾は岩へ接触する。
    engine.startScript(
      'fire(0, 60, 1, 0.5, 1);',
      1,
      () => ({ x: 0, y: 1.4 }),
      0,
      'owner',
    );
    engine.tick();
    engine.tick();
    expect(engine.aliveCount).toBe(0);
  });

  it('does not resurrect an obstacle-hit bullet during catch-up replay', () => {
    const engine = new BulletEngine();
    engine.setObstacles([{ x: 2, y: 0, r: 0.5 }]);
    engine.startScript(
      'fire(0, 60, 1, 0.2, 1);',
      1,
      () => ({ x: 0, y: 0 }),
      0,
      'owner',
      undefined,
      4,
      'late-fire',
    );
    expect(engine.aliveCount).toBe(0);
  });

  it('keeps obstacle results identical between live and delayed replay', () => {
    const obstacle = [{ x: 2, y: 0, r: 0.5 }];
    const source = 'fire(0, 60, 1, 0.2, 1);';
    const live = new BulletEngine();
    live.setObstacles(obstacle);
    live.startScript(source, 1, () => ({ x: 0, y: 0 }), 0, 'owner');
    for (let i = 0; i < 4; i++) live.tick();

    const delayed = new BulletEngine();
    delayed.setObstacles(obstacle);
    delayed.startScript(
      source, 1, () => ({ x: 0, y: 0 }), 0, 'owner', undefined, 4, 'late',
    );
    expect(delayed.aliveCount).toBe(live.aliveCount);
    expect(delayed.bullets.filter((bullet) => bullet.alive))
      .toEqual(live.bullets.filter((bullet) => bullet.alive));
  });

  it('keeps kills and collision damage that arrive before bullet creation', () => {
    const killed = new BulletEngine();
    killed.killByFire('late-fire', 0);
    killed.startScript(
      'fire(0, 10, 1, 0.2);', 1, () => ({ x: 0, y: 0 }), 0,
      'owner', undefined, 0, 'late-fire',
    );
    killed.tick();
    expect(killed.aliveCount).toBe(0);

    const damaged = new BulletEngine();
    damaged.damageByFire('late-damage', 0, 1);
    damaged.startScript(
      'fire(0, 10, 2, 0.2);', 1, () => ({ x: 0, y: 0 }), 0,
      'owner', undefined, 0, 'late-damage',
    );
    damaged.tick();
    expect(damaged.bullets.find((b) => b.alive)?.dur).toBe(1);
  });

  it('lets only the selected collision resolver mutate durability', () => {
    const engine = new BulletEngine();
    engine.areAllied = () => false;
    engine.canResolveCollision = () => false;
    engine.startScript('fire(0, 0, 1, 0.2);', 1, () => ({ x: 0, y: 0 }), 0,
      'owner-a', undefined, 0, 'a');
    engine.startScript('fire(0, 0, 1, 0.2);', 2, () => ({ x: 0, y: 0 }), 0,
      'owner-b', undefined, 0, 'b');
    engine.tick();
    expect(engine.aliveCount).toBe(2);
  });

  it('reuses the spatial grid for nearby hit queries without duplicates', () => {
    const engine = new BulletEngine();
    engine.startScript('fire(0, 0, 1, 0.2);', 1, () => ({ x: 2, y: 3 }), 0,
      'owner', undefined, 0, 'nearby');
    engine.tick();
    const first: number[] = [];
    engine.forEachNearby(2, 3, 1, (_bullet, index) => first.push(index));
    engine.tick();
    const second: number[] = [];
    engine.forEachNearby(2, 3, 1, (_bullet, index) => second.push(index));
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it('does not apply a claimed collision to a bullet owned by someone else', () => {
    const engine = new BulletEngine();
    engine.damageByFire('owned', 0, 100, 'attacker');
    engine.startScript('fire(0, 1, 2, 0.2);', 1, () => ({ x: 0, y: 0 }), 0,
      'real-owner', undefined, 0, 'owned');
    engine.tick();
    expect(engine.bullets.find((b) => b.alive)?.dur).toBe(2);
  });

  it('rejects scripts that cannot finish within the duration budget', () => {
    const engine = new BulletEngine();
    expect(engine.estimateCost('wait(999999);', 1, 0, () => ({ x: 0, y: 0 })))
      .toBeNull();
  });
});
