// ゲーム共通の定数と P2P メッセージ型定義。
// 座標系: フィールドは原点中心の正方形 2D 平面 (x, y)。描画側で XZ 平面へ写像する。
//
// シグナリングは trystero (Nostr リレー経由) に委ねるため自前サーバは持たない。
// 同一ルームの全ピアと WebRTC 接続され、以降のデータ交換はすべて P2P で行われる。

export type Vec2 = { x: number; y: number };

// ---------------------------------------------------------------------------
// 定数

/** フィールド一辺の長さ */
export const FIELD_SIZE = 200;

/** 移動速度 (units/s) */
export const PLAYER_SPEED = 8;

/** P2P での自機状態送信間隔 (~15Hz) */
export const STATE_INTERVAL_MS = 66;

/** trystero の名前空間 (appId)。衝突しにくい固有文字列にする */
export const APP_ID = 'lovyan-blt-proto';

/** ルーム名 = フィールド単位。マップ分割する際はここを増やす */
export const ROOM_NAME = 'field-1';

// ---------------------------------------------------------------------------
// P2P メッセージ (trystero action のペイロード)
// ※ trystero の型制約 (Record 互換) のため interface でなく type で定義する

/** 位置同期 (非同期・高頻度)。h は進行方向 (rad, +x 基準で +y 方向へ正) */
export type StatePayload = {
  seq: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  h: number;
};

/** 参加時に交換するプロフィール */
export type ProfilePayload = { name: string };

/** チャット（今後実装）。弾幕の発射イベントも同様に action を追加する */
export type ChatPayload = { text: string };
