// クライアント⇔シグナリングサーバ、およびクライアント⇔クライアント(P2P) の共通プロトコル定義。
// 座標系: フィールドは原点中心の正方形 2D 平面 (x, y)。描画側で XZ 平面へ写像する。

export interface Vec2 {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// 定数

/** フィールド一辺の長さ */
export const FIELD_SIZE = 200;

/** この距離以内に入った相手と P2P 接続を張る */
export const NEIGHBOR_ENTER_RADIUS = 60;

/** この距離を超えたら P2P 接続を解消する（ヒステリシス） */
export const NEIGHBOR_LEAVE_RADIUS = 80;

/** 同時 P2P 接続数の上限（段階制の外側。将来は「高頻度同期は近い24人」等を追加） */
export const MAX_PEERS = 32;

/** シグナリングサーバへの自座標報告間隔 */
export const POS_REPORT_INTERVAL_MS = 1000;

/** P2P での自機状態送信間隔 (~15Hz) */
export const P2P_STATE_INTERVAL_MS = 66;

/** 移動速度 (units/s) */
export const PLAYER_SPEED = 8;

export const DEFAULT_SIGNALING_PORT = 8787;

// ---------------------------------------------------------------------------
// WebRTC シグナリング用ペイロード
// (サーバ側に DOM lib を要求しないため、RTC* 型と構造互換の型を自前定義する)

export interface SessionDescription {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}

export interface IceCandidate {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type SignalPayload =
  | { kind: 'description'; description: SessionDescription }
  | { kind: 'candidate'; candidate: IceCandidate | null };

// ---------------------------------------------------------------------------
// シグナリングサーバとのメッセージ

export interface PeerInfo {
  id: string;
  name: string;
  pos: Vec2;
}

/** クライアント → サーバ */
export type ClientMessage =
  | { type: 'join'; name: string; pos: Vec2 }
  | { type: 'pos'; pos: Vec2 }
  | { type: 'signal'; to: string; payload: SignalPayload };

/** サーバ → クライアント */
export type ServerMessage =
  | { type: 'welcome'; id: string }
  | { type: 'neighbor-enter'; peer: PeerInfo }
  | { type: 'neighbor-leave'; id: string }
  | { type: 'signal'; from: string; payload: SignalPayload };

// ---------------------------------------------------------------------------
// P2P DataChannel メッセージ

/** 非信頼チャネル: 自機状態。h は進行方向 (rad, +x 基準で +y 方向へ正) */
export interface P2PStateMessage {
  type: 'state';
  seq: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  h: number;
}

/** 信頼チャネル: チャット等。弾幕の発射イベントも今後ここに追加する */
export type P2PReliableMessage = { type: 'chat'; text: string };
