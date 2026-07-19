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
  // HP バーと同じアンカー点から、スクリーン空間で上方向へオフセットする
  // (ワールドYで離すと真上視点で HP バーと重なるため)
  sprite.center.set(0.5, 0.25);
  sprite.position.y = HEAD_ANCHOR_Y;
  return sprite;
}

/** 名前・HPバー共通のアンカー高さ。オフセットはスクリーン空間で行う */
export const HEAD_ANCHOR_Y = 2.3;

/**
 * キャラクターの胴体 (体型プリセット＋進行方向を示すノーズ＋アクセサリ)。
 * rotation.y = -heading で 2D の進行方向 (rad) と描画上の向きが一致する。
 * 名前や HP バーなど回転させたくない要素は、この外側 (親グループ) に付けること。
 */
export function createBody(color: THREE.Color, shape = 0, acc = 0): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });

  let topY: number;
  let noseX: number;
  switch (shape) {
    case 1: {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.5, 0.8), mat);
      body.position.y = 0.75;
      group.add(body);
      topY = 1.5;
      noseX = 0.55;
      break;
    }
    case 2: {
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.8, 12), mat);
      body.position.y = 0.9;
      group.add(body);
      topY = 1.8;
      noseX = 0.55;
      break;
    }
    case 3: {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 12), mat);
      body.position.y = 0.8;
      group.add(body);
      topY = 1.6;
      noseX = 0.75;
      break;
    }
    default: {
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.5, 1.0, 4, 12),
        mat,
      );
      body.position.y = 1.0;
      group.add(body);
      topY = 1.95;
      noseX = 0.6;
    }
  }

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.6, 8),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
  );
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(noseX + 0.15, shape === 3 ? 0.8 : 1.2, 0);
  group.add(nose);

  if (acc === 1) {
    // 帽子 (体色を暗くした色)
    const hat = new THREE.Mesh(
      new THREE.ConeGeometry(0.45, 0.6, 10),
      new THREE.MeshLambertMaterial({
        color: color.clone().multiplyScalar(0.55),
      }),
    );
    hat.position.y = topY + 0.22;
    group.add(hat);
  } else if (acc === 2) {
    // アンテナ
    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6),
      new THREE.MeshLambertMaterial({ color: 0x888888 }),
    );
    stick.position.y = topY + 0.25;
    group.add(stick);
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0xff4444 }),
    );
    tip.position.y = topY + 0.5;
    group.add(tip);
  }

  return group;
}
