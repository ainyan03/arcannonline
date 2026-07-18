import * as THREE from 'three';

/** 名前文字列から安定した色を得る（全クライアントで同じ見た目になる）。 */
export function colorFromString(s: string): THREE.Color {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return new THREE.Color().setHSL((h % 360) / 360, 0.6, 0.55);
}

export function createNameSprite(name: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(name, 128, 32);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true }),
  );
  sprite.scale.set(4, 1, 1);
  sprite.position.y = 2.6;
  return sprite;
}

/**
 * キャラクターの胴体 (カプセル＋進行方向を示すノーズ)。
 * rotation.y = -heading で 2D の進行方向 (rad) と描画上の向きが一致する。
 * 名前や HP バーなど回転させたくない要素は、この外側 (親グループ) に付けること。
 */
export function createBody(color: THREE.Color): THREE.Group {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.5, 1.0, 4, 12),
    new THREE.MeshLambertMaterial({ color }),
  );
  body.position.y = 1.0;
  group.add(body);

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.5, 8),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
  );
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(0.6, 1.3, 0);
  group.add(nose);

  return group;
}
