# blt — ブラウザ P2P 弾幕フィールドゲーム（試作）

オープンフィールドをキャラクターが歩き回り、弾幕で撃ち合う多人数参加型ブラウザゲームの試作。
**自前サーバを一切持たず**、GitHub Pages の静的配信だけで動作する。
シグナリング（接続確立の仲介）は [trystero](https://github.com/dmotz/trystero) 経由で
公開 Nostr リレーに委ね、確立後は WebRTC DataChannel による P2P 直接通信で同期する。

## アーキテクチャ

```
GitHub Pages（静的配信のみ）
    │ 配信
    ▼
ブラウザA ── 公開Nostrリレー(wss) ── ブラウザB   … シグナリングのみ（trystero）
    │
    └────── WebRTC DataChannel（P2P直接通信） ──────┐
             ├ profile: 参加時の名前交換              ▼
             ├ state:   位置・向き (~15Hz)        ブラウザB
             └ chat / fire: チャット・弾幕発射イベント（予定）
```

- 演算は 2D 平面 (x, y)。描画時に XZ 平面へ写像し Three.js で 3D 俯瞰表示する。
- 同一ルーム (`field-1`) の全ピアと自動でメッシュ接続される。
  近傍だけに高頻度同期を絞る interest management は今後の課題
  （想定スケール: 同時 16〜32 人、平均 24 人）。
- NAT 越えは STUN のみ（TURN なし）。直接通信が確立できない相手とは同期しない割り切り。
- 被弾判定は自己申告制（チート対策はスコープ外）。

## 開発

```bash
npm install
npm run dev        # http://localhost:5173
```

ブラウザ（タブ）を2つ以上開いて参加すると、互いのキャラクターが見える。
シグナリングに公開 Nostr リレーを使うため、開発時もインターネット接続が必要。

## デプロイ (GitHub Pages)

`main` ブランチへの push で `.github/workflows/deploy.yml` が起動し、
Vite ビルド成果物 (`client/dist`) が GitHub Pages に公開される。
リポジトリ設定で Pages のソースを「GitHub Actions」にしておくこと。

## 操作方法

- WASD / 矢印キー: 移動（カメラ基準）
- マウスドラッグ: 視点回転
- ホイール: ズーム

## ディレクトリ構成

```
shared/src/protocol.ts   共通の定数・P2Pメッセージ型定義
client/src/
  net/room.ts            trystero ルームのラッパー
  game/                  描画・入力・プレイヤー
  ui/                    参加オーバーレイ
```

## ロードマップ

1. ~~フィールド移動 + P2P 位置同期 + GitHub Pages 静的デプロイ~~（現在ここ）
2. 弾幕 DSL（東方弾幕風系の文法）のパーサ・インタプリタ。
   弾は座標ではなく発射イベント（時刻・位置・スクリプトID・乱数シード）を同期し、
   各クライアントで決定論的に再現演算する
3. 被弾の自己申告とチャット
4. 距離ベースの interest management（遠いピアへの送信間引き）
5. シミュレーションコアの性能実測（5万発 tick + 当たり判定）→ 必要なら WASM 化
