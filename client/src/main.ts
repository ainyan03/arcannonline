import { startBot } from './bot';
import { Game } from './game/game';
import { installRtcDebug } from './net/rtc-debug';
import { showJoinOverlay } from './ui/join';

installRtcDebug();

async function boot(): Promise<void> {
  // WebRTC・Nostr 署名まわりはセキュアコンテキストを前提とする。
  // これは HTTPS か localhost でのみ使えるため、欠けている場合は案内を出して止める。
  if (!globalThis.crypto?.subtle) {
    document.body.innerHTML =
      '<p style="color:#fff;font-family:sans-serif;padding:24px">' +
      'このページは HTTPS (または localhost) でアクセスする必要があります。<br>' +
      `現在のURL: ${location.href}</p>`;
    return;
  }
  // ?bot=1 で負荷試験用のヘッドレス bot として参加する
  if (new URLSearchParams(location.search).has('bot')) {
    startBot();
    return;
  }
  const { name, appearance } = await showJoinOverlay();
  const game = new Game(document.getElementById('app')!, name, appearance);
  game.start();
}

void boot();
