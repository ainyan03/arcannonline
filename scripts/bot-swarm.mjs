// 多人数負荷試験: headless Chrome で ?bot=1 ページを多数開き、
// メッシュ接続数・送受信量を定期レポートする。
//
//   node scripts/bot-swarm.mjs [体数=20] [URL=http://localhost:4173/?bot=1]
//
// 停止は Ctrl-C (pagehide で退室通知してから閉じる)。
// インストール済みの Chrome を channel 指定で使うため、ブラウザの
// 追加ダウンロードは不要 (devDependency: playwright-core)。
import { chromium } from 'playwright-core';

const COUNT = Number(process.argv[2] ?? 20);
const URL = process.argv[3] ?? 'http://localhost:4173/?bot=1';
/** 参加を分散させてリレーへのシグナリング集中を避ける */
const JOIN_STAGGER_MS = 2_000;
const REPORT_INTERVAL_MS = 15_000;

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    // 非表示ページのタイマー間引きを無効化し、bot を全速で動かす
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const context = await browser.newContext();
const pages = [];

const num = (re, s) => Number(re.exec(s)?.[1] ?? -1);

async function report() {
  const stats = await Promise.all(
    pages.map((p) =>
      p.evaluate(() => document.querySelector('pre')?.textContent ?? '').catch(() => ''),
    ),
  );
  const peers = stats.map((s) => num(/peers:\s+(\d+)/, s)).sort((a, b) => a - b);
  const linkOpen = stats.map((s) => num(/link: (\d+)\//, s));
  const linkTotal = stats.map((s) => num(/link: \d+\/(\d+)/, s));
  const median = peers[Math.floor(peers.length / 2)];
  const fullMesh = COUNT - 1;
  const openSum = linkOpen.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  const totalSum = linkTotal.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  console.log(
    `[swarm ${new Date().toISOString().slice(11, 19)}] ` +
      `peers min/med/max = ${peers[0]}/${median}/${peers[peers.length - 1]} ` +
      `(全対全なら ${fullMesh}+) links open/total = ${openSum}/${totalSum}`,
  );
  console.log(`[swarm] sample bot0: ${stats[0].replace(/\n/g, ' | ')}`);
}

for (let i = 0; i < COUNT; i++) {
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  pages.push(page);
  console.log(`[swarm] bot ${i + 1}/${COUNT} launched`);
  await new Promise((r) => setTimeout(r, JOIN_STAGGER_MS));
}
console.log('[swarm] all bots launched');
await report();
setInterval(() => void report(), REPORT_INTERVAL_MS);

process.on('SIGINT', () => {
  void (async () => {
    console.log('[swarm] closing (pagehide → leave)');
    await context.close();
    await browser.close();
    process.exit(0);
  })();
});
