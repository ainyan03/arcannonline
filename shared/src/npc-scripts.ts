/** 小型敵「ウィスプ」が使う、全クライアント共通の弾幕。 */
export const NPC_FIRE_SCRIPT_ID = 'npc-wisp-burst';
export const NPC_FIRE_SCRIPT_SOURCE = `
fire(aim - 9, 9, 1, 0.22, 4);
fire(aim, 10, 1, 0.24, 4);
fire(aim + 9, 9, 1, 0.22, 4);
`;

