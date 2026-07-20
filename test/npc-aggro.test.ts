import { describe, expect, it } from 'vitest';
import { LocalNpcSim } from '../client/src/sim/npc';
import { BASE_ID } from '../shared/src/protocol';

const OWNER = 'f'.repeat(64);
const PLAYER = '1'.repeat(64);

// spawn 演出 (900ms) と初撃ディレイ (最大3000ms) を過ぎた時刻から始める
const READY_AT = 5_000;

function makeTargets(npc: LocalNpcSim) {
  return [
    { id: BASE_ID, pos: { x: npc.pos.x - 20, y: npc.pos.y } },
    { id: PLAYER, pos: { x: npc.pos.x + 2, y: npc.pos.y } },
  ];
}

describe('NPC aggro', () => {
  it('prefers the base over a closer player while lit', () => {
    const npc = new LocalNpcSim(`${OWNER}:npc:0`, 0, 'wisp');
    const attack = npc.update(1 / 60, READY_AT, makeTargets(npc));
    expect(attack?.targetId).toBe(BASE_ID);
  });

  it('retaliates against the attacker, then returns to the base', () => {
    const npc = new LocalNpcSim(`${OWNER}:npc:0`, 0, 'wisp');
    npc.update(1 / 60, READY_AT, makeTargets(npc)); // 初撃 (拠点向け)
    npc.provoke(PLAYER, 9_000);
    const retaliation = npc.update(1 / 60, 9_000, makeTargets(npc));
    expect(retaliation?.targetId).toBe(PLAYER);
    // アグロ (6秒) が切れた後は拠点へ戻る
    const after = npc.update(1 / 60, 16_700, makeTargets(npc));
    expect(after?.targetId).toBe(BASE_ID);
  });

  it('hunts the nearest player when the base is unlit (absent from targets)', () => {
    const npc = new LocalNpcSim(`${OWNER}:npc:1`, 0, 'wisp');
    const attack = npc.update(1 / 60, READY_AT, [
      { id: PLAYER, pos: { x: npc.pos.x + 2, y: npc.pos.y } },
    ]);
    expect(attack?.targetId).toBe(PLAYER);
  });

  it('clears aggro on respawn', () => {
    const npc = new LocalNpcSim(`${OWNER}:npc:2`, 0, 'wisp');
    npc.provoke(PLAYER, 1_000);
    npc.takeHit(999, 1_000);
    npc.update(1 / 60, 1_000 + 6_001, []); // 再出現
    expect(npc.alive).toBe(true);
    // 再出現直後 (spawn 演出 + 初撃ディレイ後) は拠点優先に戻っている
    const attack = npc.update(1 / 60, 1_000 + 6_001 + 5_000, makeTargets(npc));
    expect(attack?.targetId).toBe(BASE_ID);
  });
});
