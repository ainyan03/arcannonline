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
export const HEAD_ANCHOR_Y = 3.0;

/**
 * 低ポリゴンの魔法使い。shapeで衣装/飛行具、accで頭飾りを切り替える。
 * rotation.y = -heading で 2D の進行方向 (rad) と描画上の向きが一致する。
 * 名前や HP バーなど回転させたくない要素は、この外側 (親グループ) に付けること。
 */
export function createBody(color: THREE.Color, shape = 0, acc = 0): THREE.Group {
  const group = new THREE.Group();
  group.userData.flightStyle = shape === 1 ? 'broom' : 'wand';

  const primary = new THREE.MeshLambertMaterial({ color });
  const darkColor = color.clone().multiplyScalar(0.46);
  const dark = new THREE.MeshLambertMaterial({ color: darkColor });
  const accentColors = [0xffd45c, 0xff86b8, 0x87ddff, 0xc7a2ff];
  const accent = new THREE.MeshLambertMaterial({ color: accentColors[shape] ?? accentColors[0] });
  const skin = new THREE.MeshLambertMaterial({ color: 0xffd5bd });
  const hair = new THREE.MeshLambertMaterial({
    color: shape === 2 ? 0xe8efff : shape === 3 ? 0xffb5d2 : 0x593b70,
  });
  const wood = new THREE.MeshLambertMaterial({ color: 0x7a4a28 });

  // スカートと上衣。円錐の裾で上空からでも魔法使いらしいシルエットにする。
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.58, 0.95, 12), primary);
  skirt.position.y = shape === 1 ? 1.15 : 1.05;
  group.add(skirt);
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), primary);
  torso.scale.set(0.8, 1.05, 0.72);
  torso.position.y = 1.58;
  group.add(torso);

  // マント。進行方向(+X)の後ろ側へ流して、停止中も向きを読み取れるようにする。
  const cape = new THREE.Mesh(new THREE.ConeGeometry(0.46, 1.15, 8, 1, true), dark);
  cape.rotation.z = Math.PI / 2.7;
  cape.scale.z = 0.65;
  cape.position.set(-0.34, 1.38, 0);
  group.add(cape);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 10), skin);
  head.position.set(0.04, 2.08, 0);
  group.add(head);
  const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.41, 12, 9), hair);
  hairBack.scale.set(1, 1.08, 1.02);
  hairBack.position.set(-0.08, 2.13, 0);
  group.add(hairBack);
  // 顔を髪より少し前へ重ね直す。
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.33, 14, 10), skin);
  face.scale.set(0.72, 0.9, 0.9);
  face.position.set(0.17, 2.06, 0);
  group.add(face);

  for (const z of [-0.14, 0.14]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0x342548 }),
    );
    eye.position.set(0.405, 2.13, z);
    group.add(eye);
    const lock = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.38, 3, 7), hair);
    lock.position.set(-0.02, 1.84, z * 2.15);
    lock.rotation.z = z > 0 ? -0.12 : 0.12;
    group.add(lock);
  }

  // 腕は肩から手先までを結ぶ円柱で構成する。
  const rightHand = shape === 1
    ? new THREE.Vector3(0.46, 1.36, 0.4)
    : new THREE.Vector3(0.54, 1.72, 0.48);
  const leftHand = shape === 1
    ? new THREE.Vector3(0.44, 1.36, -0.4)
    : new THREE.Vector3(0.12, 1.5, -0.52);
  addLimb(group, new THREE.Vector3(0, 1.66, 0.31), rightHand, 0.1, primary);
  addLimb(group, new THREE.Vector3(0, 1.66, -0.31), leftHand, 0.1, primary);
  for (const handPos of [rightHand, leftHand]) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), skin);
    hand.position.copy(handPos);
    group.add(hand);
  }

  if (shape === 1) {
    addBroom(group, wood, accent);
    // 箒を挟むブーツ
    for (const z of [-0.25, 0.25]) {
      const boot = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.32, 3, 7), dark);
      boot.rotation.z = -Math.PI / 2.8;
      boot.position.set(0.2, 0.78, z);
      group.add(boot);
    }
  } else {
    addWand(group, rightHand, shape === 2, wood, accent);
  }

  if (acc === 1) {
    addWitchHat(group, dark, accent);
  } else if (acc === 2) {
    // 大きなリボン
    for (const z of [-0.22, 0.22]) {
      const bow = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.38, 7), accent);
      bow.rotation.x = z > 0 ? Math.PI / 2 : -Math.PI / 2;
      bow.position.set(-0.2, 2.28, z);
      group.add(bow);
    }
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), accent);
    knot.position.set(-0.2, 2.28, 0);
    group.add(knot);
  }

  return group;
}

function addLimb(
  group: THREE.Group,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  material: THREE.Material,
): void {
  const delta = to.clone().sub(from);
  const limb = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, delta.length(), 7),
    material,
  );
  limb.position.copy(from).add(to).multiplyScalar(0.5);
  limb.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  group.add(limb);
}

function addWand(
  group: THREE.Group,
  hand: THREE.Vector3,
  staff: boolean,
  wood: THREE.Material,
  accent: THREE.Material,
): void {
  const end = staff
    ? new THREE.Vector3(1.32, 2.35, 0.54)
    : new THREE.Vector3(1.22, 2.02, 0.54);
  addLimb(group, hand, end, staff ? 0.045 : 0.035, wood);
  const gem = new THREE.Mesh(
    staff ? new THREE.OctahedronGeometry(0.2) : new THREE.TetrahedronGeometry(0.18),
    accent,
  );
  gem.position.copy(end);
  gem.rotation.x = Math.PI / 4;
  group.add(gem);
}

function addBroom(group: THREE.Group, wood: THREE.Material, accent: THREE.Material): void {
  addLimb(group, new THREE.Vector3(-1.12, 0.7, 0), new THREE.Vector3(1.38, 0.7, 0), 0.045, wood);
  const bristles = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.72, 9), accent);
  bristles.rotation.z = -Math.PI / 2;
  bristles.position.set(-1.38, 0.7, 0);
  group.add(bristles);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), accent);
  tip.position.set(1.4, 0.7, 0);
  group.add(tip);
}

function addWitchHat(group: THREE.Group, dark: THREE.Material, accent: THREE.Material): void {
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 14), dark);
  brim.position.y = 2.39;
  group.add(brim);
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.85, 12), dark);
  crown.position.set(-0.08, 2.79, 0);
  crown.rotation.z = 0.16;
  group.add(crown);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.055, 6, 14), accent);
  band.rotation.x = Math.PI / 2;
  band.position.y = 2.51;
  group.add(band);
}
