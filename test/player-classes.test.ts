import { describe, expect, it } from 'vitest';
import { LocalPlayerSim } from '../client/src/sim/local-player';
import { PLAYER_SPEED, type Appearance } from '../shared/src/protocol';
import {
  CLASS_MOVEMENTS,
  CLASS_SHOTS,
  PLAYER_SPEED_MAX,
  classMovementFor,
  shotScriptIdFor,
} from '../shared/src/player-classes';
import { PLAYER_SHOT_SOURCES } from '../shared/src/danmaku-scripts';
import { BulletEngine } from '../client/src/sim/danmaku/engine';

const appearance = (s: number): Appearance => ({ s, c: '#8877cc', a: 0 });
/** 岩のない空き地 (障害物の影響を受けずに移動特性だけを測る) */
const CLEAR = { x: -70, y: -70 };
const DT = 1 / 60;
const NO_INPUT = { x: 0, y: 0 };

function speedOf(sim: LocalPlayerSim): number {
  const v = sim.getVelocity();
  return Math.hypot(v.x, v.y);
}

describe('player classes', () => {
  it('exposes a movement entry per preset and the validation speed cap', () => {
    expect(CLASS_MOVEMENTS).toHaveLength(4);
    expect(classMovementFor(undefined)).toBe(CLASS_MOVEMENTS[0]);
    expect(classMovementFor(9)).toBe(CLASS_MOVEMENTS[0]);
    expect(PLAYER_SPEED_MAX).toBe(PLAYER_SPEED * 1.25);
  });

  it('the broom witch cruises without input and cannot stop', () => {
    const broom = new LocalPlayerSim({ ...CLEAR }, 'b', appearance(1));
    const cruise = PLAYER_SPEED * CLASS_MOVEMENTS[1].cruiseMul;
    for (let i = 0; i < 120; i++) broom.update(DT, NO_INPUT);
    expect(speedOf(broom)).toBeGreaterThanOrEqual(cruise * 0.99);
    expect(broom.pos.x).toBeGreaterThan(CLEAR.x + 5);
    // 逆方向へ入力し続けても巡航速度を割らない (旋回して逃げる)
    for (let i = 0; i < 300; i++) {
      broom.update(DT, { x: -1, y: 0 });
      expect(speedOf(broom)).toBeGreaterThanOrEqual(cruise * 0.99);
    }
  });

  it('the broom witch flies past a tap destination instead of parking on it', () => {
    const broom = new LocalPlayerSim({ ...CLEAR }, 'b', appearance(1));
    for (let i = 0; i < 60; i++) broom.update(DT, NO_INPUT);
    const targetX = broom.pos.x + 6;
    broom.setTarget(targetX, broom.pos.y);
    for (let i = 0; i < 240; i++) broom.update(DT, NO_INPUT);
    // 目標を通過してさらに先へ進んでいる (到着減速で停止しない)
    expect(broom.pos.x).toBeGreaterThan(targetX + 2);
    expect(speedOf(broom)).toBeGreaterThan(0);
  });

  it('the broom witch turns back instead of sticking to the field boundary', () => {
    const broom = new LocalPlayerSim({ x: 98.9, y: -70 }, 'b', appearance(1));
    for (let i = 0; i < 120; i++) broom.update(DT, NO_INPUT);
    expect(broom.pos.x).toBeLessThan(98);
    expect(broom.getVelocity().x).toBeLessThan(0);
    expect(speedOf(broom)).toBeGreaterThan(0);
  });

  it('maps every class shot to replayable scripts within the VM budgets', () => {
    const engine = new BulletEngine();
    expect(CLASS_SHOTS).toHaveLength(4);
    for (const shot of CLASS_SHOTS) {
      expect(shot.cooldownMs).toBeGreaterThan(0);
      for (const id of [shot.steadyScriptId, shot.movingScriptId]) {
        const source = PLAYER_SHOT_SOURCES[id];
        expect(source).toBeTruthy();
        expect(
          engine.estimateCost(source, 1, 0, () => ({ x: 0, y: 0 })),
        ).not.toBeNull();
      }
    }
  });

  it('switches to the wilder ballistics only while moving fast', () => {
    // 月: 静止で収束、走ると乱れる
    expect(shotScriptIdFor(2, 0)).toBe('shot-moon-steady');
    expect(shotScriptIdFor(2, PLAYER_SPEED * 0.9)).toBe('shot-moon-moving');
    // 箒: 巡航 (0.6×基準) は steady、加速中は moving
    expect(shotScriptIdFor(1, PLAYER_SPEED * 0.6)).toBe('shot-broom-steady');
    expect(shotScriptIdFor(1, PLAYER_SPEED * 1.2)).toBe('shot-broom-moving');
  });

  it('the moon mage is slower than base and the star witch can stop', () => {
    const moon = new LocalPlayerSim({ ...CLEAR }, 'm', appearance(2));
    for (let i = 0; i < 300; i++) moon.update(DT, { x: 1, y: 0 });
    expect(speedOf(moon)).toBeLessThanOrEqual(PLAYER_SPEED * 0.9 + 0.01);
    expect(speedOf(moon)).toBeGreaterThan(PLAYER_SPEED * 0.85);

    const star = new LocalPlayerSim({ ...CLEAR, y: -60 }, 's', appearance(0));
    for (let i = 0; i < 60; i++) star.update(DT, { x: 1, y: 0 });
    for (let i = 0; i < 120; i++) star.update(DT, NO_INPUT);
    expect(speedOf(star)).toBe(0);
  });
});
