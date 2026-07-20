import { describe, expect, it } from 'vitest';
import { RemotePlayerSim } from '../client/src/sim/remote-player';
import type { StatePayload } from '../shared/src/protocol';

function state(seq: number, skewMs: number): StatePayload {
  return {
    n: 'remote',
    seq,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    h: 0,
    ts: Date.now() - skewMs,
    hp: 100,
  };
}

describe('RemotePlayerSim clock estimation', () => {
  it('forgets stale clock minima after the rolling window', () => {
    const sim = new RemotePlayerSim('remote', 0);
    sim.push(state(0, -10_000), 0);
    for (let i = 1; i <= 120; i++) sim.push(state(i, 100), i);
    expect(sim.clockSkewMin).toBeGreaterThanOrEqual(90);
    expect(sim.clockSkewMin).toBeLessThan(250);
  });
});
