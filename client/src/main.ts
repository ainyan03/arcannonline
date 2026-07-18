import { Game } from './game/game';
import { showJoinOverlay } from './ui/join';

async function boot(): Promise<void> {
  const name = await showJoinOverlay();
  const game = new Game(document.getElementById('app')!, name);
  game.start();
}

void boot();
