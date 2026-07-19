/**
 * ピアID (公開鍵 hex) から決定論的に生成する identicon。
 * 外部リソース・認証なしで全プレイヤーに一意のアイコンを与える。
 * 5x5 の左右対称グリッドで、色相もシードから決める。
 */
export function drawIdenticon(
  ctx: CanvasRenderingContext2D,
  seedHex: string,
  x: number,
  y: number,
  size: number,
): void {
  const bytes: number[] = [];
  for (let i = 0; i + 2 <= seedHex.length && bytes.length < 8; i += 2) {
    bytes.push(Number.parseInt(seedHex.slice(i, i + 2), 16) || 0);
  }
  while (bytes.length < 8) bytes.push(0);
  const hue = ((bytes[0] << 8) | bytes[1]) % 360;
  const cell = size / 5;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, size * 0.18);
  ctx.fillStyle = `hsl(${hue}, 32%, 20%)`;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = `hsl(${hue}, 72%, 62%)`;
  // 左3列をビットで塗り、右2列は左右ミラー
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 5; row++) {
      if (((bytes[2 + col] >> row) & 1) === 0) continue;
      ctx.fillRect(x + col * cell, y + row * cell, cell + 0.5, cell + 0.5);
      ctx.fillRect(x + (4 - col) * cell, y + row * cell, cell + 0.5, cell + 0.5);
    }
  }
  ctx.restore();
}
