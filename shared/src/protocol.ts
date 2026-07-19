// ゲーム共通の定数と P2P メッセージ型定義。
// 座標系: フィールドは原点中心の正方形 2D 平面 (x, y)。描画側で XZ 平面へ写像する。
//
// ネットワーク構成 (自前実装):
// - ブートストラップ: 公開 Nostr リレーへの署名付き ephemeral イベントで
//   プレゼンス通知と WebRTC シグナリングを行う (nostr.ts)
// - 確立後: WebRTC DataChannel の P2P メッシュ。既知ピア一覧の交換 (PEX) と
//   シグナリングの中継もメッシュ上で行い、リレー依存を最初の1本に減らす (mesh.ts)

export type Vec2 = { x: number; y: number };

// ---------------------------------------------------------------------------
// 定数

/**
 * プロトコル互換バージョン。シミュレーションや通信の互換性が壊れる変更を
 * 入れたら +1 する。プレゼンスと PEX で交換し、自分より新しい値を申告する
 * ピアを見つけたクライアントは UI でアップデート (リロード) を促す。
 * バージョン不一致でも接続・プレイは継続する (強制切断はしない)
 */
export const PROTO_VERSION = 1;

/** フィールド一辺の長さ */
export const FIELD_SIZE = 200;

/** 移動速度 (units/s) */
export const PLAYER_SPEED = 8;

/** P2P での自機状態送信間隔 (~15Hz) */
export const STATE_INTERVAL_MS = 66;

/** 同時 P2P 接続数の上限 */
export const MAX_PEERS = 32;

/** ルームトピック。マップ分割する際は ROOM_NAME を増やす */
export const APP_ID = 'arcannonline';
export const ROOM_NAME = 'field-1';

/** プレゼンス(在室通知)の発行間隔 */
export const PRESENCE_INTERVAL_MS = 15_000;

/** PEX (既知ピア一覧の交換) の間隔 */
export const PEX_INTERVAL_MS = 10_000;

/** この時間プレゼンスも通信もないピアは居なくなったとみなす */
export const STALE_PRESENCE_MS = 60_000;

/** 接続確立がこの時間を超えて完了しないピアは作り直す */
export const CONNECT_TIMEOUT_MS = 45_000;

// --- 弾幕シミュレーション -----------------------------------------------

/** シミュレーションの固定タイムステップ (tick/秒) */
export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;

/** 全体の同時弾数上限 (超過分の発射は捨てる) */
export const MAX_BULLETS = 8192;

/** 発射のクールダウン */
export const FIRE_COOLDOWN_MS = 400;

/** 発射時に弾へ引き継ぐ自機速度の割合 */
export const BULLET_INHERIT_VELOCITY = 0.5;

/** 受信した発射イベントを過去に遡って再生する上限 (tick)。
 * 遅延は時計ずれ補正済みの推定値を使うため、正常時は数 tick に収まる */
export const MAX_FIRE_CATCHUP_TICKS = TICK_RATE;

/** ブートストラップ用の公開 Nostr リレー */
export const NOSTR_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.mom',
  'wss://relay.primal.net',
  'wss://offchain.pub',
  'wss://nostr.oxtr.dev',
  'wss://relay.snort.social',
];

// ---------------------------------------------------------------------------
// WebRTC シグナリング

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

/** シグナリングの封筒。Nostr 経由とメッシュ中継の二重送信を id で重複排除する */
export interface SignalEnvelope {
  id: string;
  to: string;
  from: string;
  payload: SignalPayload;
}

// ---------------------------------------------------------------------------
// Nostr イベントの content (JSON)

export type NostrContent =
  /** v はプロトコル互換バージョン (PROTO_VERSION)。旧クライアントは省略する */
  | { t: 'presence'; v?: number }
  | { t: 'bye' }
  | { t: 'signal'; env: SignalEnvelope };

// ---------------------------------------------------------------------------
// P2P DataChannel メッセージ

/**
 * 見た目のプリセットカスタマイズ。state に同梱される軽量データ。
 * (任意3Dモデル (GLB) のハッシュ同期+チャンク転送は今後の拡張)
 */
export type Appearance = {
  /** 衣装: 0=星の魔法少女 1=箒の魔女 2=月の魔導士 3=花の魔女 */
  s: number;
  /** 体色 (#rrggbb) */
  c: string;
  /** 頭飾り: 0=なし 1=魔女帽子 2=大きなリボン */
  a: number;
};

/**
 * 位置同期 (非信頼チャネル・高頻度)。h は進行方向 (rad, +x 基準で +y 方向へ正)。
 * n (名前) を毎回含めるのは冗長だが、参加直後のハンドシェイク喪失で相手が
 * 永久に表示されない事故を避けて確実性を取る。
 */
export type StatePayload = {
  n: string;
  seq: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  h: number;
  /** 送信時刻 (epoch ms)。ピア間の時計ずれ推定に使う */
  ts: number;
  /** 現在HP (被弾は自己申告制: 本人の申告値をそのまま表示する) */
  hp: number;
  /** 見た目 (プリセットカスタマイズ) */
  ap?: Appearance;
};

/** 最大HP。弾の耐久度がそのままダメージになる */
export const MAX_HP = 100;

/** リスポーン後の無敵時間 */
export const INVULN_MS = 2_000;

// --- 分散NPC ---------------------------------------------------------------

/** 各クライアントが担当する小型敵の数 */
export const NPCS_PER_PEER = 2;
/** NPC状態の送信間隔 (5Hz) */
export const NPC_STATE_INTERVAL_MS = 200;
export const NPC_MAX_HP = 24;
export const NPC_RESPAWN_MS = 6_000;

export type NpcMode = 'spawn' | 'wander' | 'chase' | 'attack' | 'dead';

/** 非信頼チャネルで送る、担当NPCの最新スナップショット */
export interface NpcStatePayload {
  id: string;
  seq: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  h: number;
  hp: number;
  mode: NpcMode;
  ts: number;
}

/** 非信頼・非順序チャネル上のリアルタイムメッセージ */
export type RealtimeMessage =
  | { type: 'state'; state: StatePayload }
  | { type: 'npcs'; states: NpcStatePayload[] };

// --- エネルギー (発射コスト) ----------------------------------------------
// スクリプトの総コストは発射時に同じシードで空実行して算出し、一括消費する。
// 消費判定は撃つ本人のクライアントのみが行う (自己申告制と同じ思想)。

export const ENERGY_MAX = 200;
export const ENERGY_REGEN_PER_SEC = 15;

/** 1発あたりのコスト係数: base + perDur×(耐久-1) + perRadius×max(半径-基準, 0) */
export const BULLET_COST_BASE = 0.5;
export const BULLET_COST_PER_DUR = 0.5;
export const BULLET_COST_PER_RADIUS = 4;
/** コスト計算の基準半径 (= fire() の既定半径) */
export const BULLET_BASE_RADIUS = 0.2;

/**
 * オーナーごとの弾の同時存在数上限 (エネルギーと併用の安全弁)。
 * 超過時は発射をブロックせず、そのオーナーの最も古い弾から寿命を
 * 前倒しして消す (FIFO)。全クライアントが同じ規則を適用するため
 * 追加の同期通信なしで一致する
 */
export const MAX_OWN_BULLETS = 300;

/**
 * 弾幕の発射イベント。弾の座標は送らず、スクリプトIDとシードだけを同期して
 * 各クライアントが決定論的に再現演算する。at (epoch ms) から受信側が
 * 経過 tick を計算して追いつき再生する。
 */
export interface FireEvent {
  id: string;
  script: string;
  seed: number;
  x: number;
  y: number;
  /** 発射時の向き (rad) */
  dir: number;
  /** 発射時の自機速度。弾の初速へ一定割合を加算する */
  vx?: number;
  vy?: number;
  /** 発射時刻 (epoch ms) */
  at: number;
  /** 狙い撃ちのターゲット (ピアID)。DSL の aim / tdist が参照する */
  target?: string;
  /** 発射時点で固定したターゲット位置。端末ごとの state 受信差による弾道分岐を防ぐ */
  tx?: number;
  ty?: number;
  /** NPCによる発射なら担当ピア配下のNPC ID */
  npc?: string;
  /** カスタムスクリプトのソース (script が同梱スクリプトにない場合に使用) */
  src?: string;
}

/** 共有されるカスタムスクリプトソースの長さ上限 */
export const MAX_SCRIPT_SRC_LEN = 4_000;

/** 共有される GitHub 認証トークン (Firebase ID トークン JWT) の長さ上限 */
export const MAX_ID_TOKEN_LEN = 4_096;

/** 信頼チャネルのメッセージ */
export type ReliableMessage =
  /** v はプロトコル互換バージョン。接続直後の初回 PEX で相手へ伝わる */
  | { type: 'pex'; peers: string[]; v?: number }
  | { type: 'sig'; env: SignalEnvelope }
  | { type: 'fire'; ev: FireEvent }
  /**
   * 弾の消滅通知 (被弾で消費した弾など)。弾は「発射イベントID f + その
   * スクリプトが何発目に生成したか i」で全クライアント共通に特定できる
   * (スクリプトは決定論的に同じ順序で弾を生成するため)
   */
  | { type: 'bkill'; f: string; i: number }
  | { type: 'chat'; text: string }
  /**
   * GitHub 認証済みプロフィールの申告 (Firebase ID トークン)。受信側は
   * Google の公開鍵で署名を独立検証し、認証バッジとアバターを表示する。
   * 注意: トークンは送信ピアの鍵ペアに束縛されないため、他人のトークンを
   * 転載する表示上のなりすましは現状防げない (試作段階の割り切り)
   */
  | { type: 'profile'; token: string };
