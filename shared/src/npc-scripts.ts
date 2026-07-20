/** 敵が使う、全クライアント共通の弾幕。発射イベントはスクリプト ID だけを同期する。 */

/** ウィスプ / ゴーレム共用の狙い3way */
export const NPC_FIRE_SCRIPT_ID = 'npc-wisp-burst';
export const NPC_FIRE_SCRIPT_SOURCE = `
fire(aim - 9, 9, 1, 0.22, 4);
fire(aim, 10, 1, 0.24, 4);
fire(aim + 9, 9, 1, 0.22, 4);
`;

/** ガーゴイル (砲台型): 遠距離から重く遅い狙い弾を1発。射程 ≒ 49 */
export const NPC_TURRET_SCRIPT_ID = 'npc-turret-shot';
export const NPC_TURRET_SCRIPT_SOURCE = `
fire(aim, 7, 3, 0.45, 7);
`;

/** インプ (突進型) の自爆: 全方位に弾をばら撒く。射程 ≒ 10 */
export const NPC_RUSHER_SCRIPT_ID = 'npc-rusher-blast';
export const NPC_RUSHER_SCRIPT_SOURCE = `
let i = 0;
loop (10) {
  fire(i * 36, 8, 1, 0.22, 1.2);
  i = i + 1;
}
`;

/** ボス「アークファントム」: 二重の全方位リング (隙間を互い違いに)。射程 ≒ 42 */
export const BOSS_RING_SCRIPT_ID = 'boss-double-ring';
export const BOSS_RING_SCRIPT_SOURCE = `
let i = 0;
loop (18) {
  fire(i * 20, 7, 2, 0.3, 6);
  i = i + 1;
}
wait(30);
let j = 0;
loop (18) {
  fire(j * 20 + 10, 7, 2, 0.3, 6);
  j = j + 1;
}
`;

/** ボス: 狙い5way を3連射。射程 ≒ 54 */
export const BOSS_AIMED_SCRIPT_ID = 'boss-aimed-volley';
export const BOSS_AIMED_SCRIPT_SOURCE = `
loop (3) {
  let a = aim - 24;
  loop (5) {
    fire(a, 9, 2, 0.35, 6);
    a = a + 12;
  }
  wait(24);
}
`;

/** ボス: 回転スパイラル。射程 ≒ 39 */
export const BOSS_SPIRAL_SCRIPT_ID = 'boss-spiral';
export const BOSS_SPIRAL_SCRIPT_SOURCE = `
let a = dir;
loop (40) {
  fire(a, 6.5, 1, 0.28, 6);
  fire(a + 180, 6.5, 1, 0.28, 6);
  a = a + 23;
  wait(2);
}
`;

/** ボスが攻撃ごとにローテーションで使う弾幕 */
export const BOSS_SCRIPT_IDS = [
  BOSS_RING_SCRIPT_ID,
  BOSS_AIMED_SCRIPT_ID,
  BOSS_SPIRAL_SCRIPT_ID,
] as const;

/** ID → ソースの引き当て (受信側の再生用) */
export const NPC_SCRIPT_SOURCES: Record<string, string> = {
  [NPC_FIRE_SCRIPT_ID]: NPC_FIRE_SCRIPT_SOURCE,
  [NPC_TURRET_SCRIPT_ID]: NPC_TURRET_SCRIPT_SOURCE,
  [NPC_RUSHER_SCRIPT_ID]: NPC_RUSHER_SCRIPT_SOURCE,
  [BOSS_RING_SCRIPT_ID]: BOSS_RING_SCRIPT_SOURCE,
  [BOSS_AIMED_SCRIPT_ID]: BOSS_AIMED_SCRIPT_SOURCE,
  [BOSS_SPIRAL_SCRIPT_ID]: BOSS_SPIRAL_SCRIPT_SOURCE,
};
