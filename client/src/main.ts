import { ensureAccountPeerBinding, restoreLogin } from './auth/github';
import { startBot } from './bot';
import { Game } from './game/game';
import { identityPeerId, loadIdentityKey } from './net/identity';
import { installRtcDebug } from './net/rtc-debug';
import { showJoinOverlay } from './ui/join';

installRtcDebug();

async function boot(): Promise<void> {
  // WebRTC・Nostr 署名まわりはセキュアコンテキストを前提とする。
  // これは HTTPS か localhost でのみ使えるため、欠けている場合は案内を出して止める。
  if (!globalThis.crypto?.subtle) {
    const message = document.createElement('p');
    message.style.cssText = 'color:#fff;font-family:sans-serif;padding:24px';
    message.append(
      'このページは HTTPS (または localhost) でアクセスする必要があります。',
      document.createElement('br'),
      `現在のURL: ${location.href}`,
    );
    document.body.replaceChildren(message);
    return;
  }
  // ?bot=1 で負荷試験用のヘッドレス bot として参加する
  if (new URLSearchParams(location.search).has('bot')) {
    startBot();
    return;
  }
  // GitHub ログインの復元を待ってから参加画面を出す。連携中はアカウント名で
  // 参加するため、名前の確定前に復元が済んでいる必要がある (未連携なら即返る)
  const [, identity] = await Promise.all([restoreLogin(), loadIdentityKey()]);
  const peerId = identityPeerId(identity.privkey);
  if (identity.persistent) {
    await ensureAccountPeerBinding(peerId).catch(() => {
      /* 任意認証の更新失敗ではゲーム参加を止めない */
    });
  }
  const { name, appearance } = await showJoinOverlay(peerId, identity.persistent);
  const game = new Game(
    document.getElementById('app')!,
    name,
    appearance,
    identity.privkey,
  );
  game.start();
}

void boot();
