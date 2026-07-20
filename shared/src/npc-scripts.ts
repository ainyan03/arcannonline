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

/** ID → ソースの引き当て (受信側の再生用) */
export const NPC_SCRIPT_SOURCES: Record<string, string> = {
  [NPC_FIRE_SCRIPT_ID]: NPC_FIRE_SCRIPT_SOURCE,
  [NPC_TURRET_SCRIPT_ID]: NPC_TURRET_SCRIPT_SOURCE,
  [NPC_RUSHER_SCRIPT_ID]: NPC_RUSHER_SCRIPT_SOURCE,
};
