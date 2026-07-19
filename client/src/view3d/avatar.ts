import * as THREE from 'three';

/** 名前文字列から安定した色を得る（全クライアントで同じ見た目になる）。 */
export function colorFromString(s: string): THREE.Color {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return new THREE.Color().setHSL((h % 360) / 360, 0.6, 0.55);
}

export function createNameSprite(
  name: string,
  anchorY = HEAD_ANCHOR_Y,
): THREE.Sprite {
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
  sprite.position.y = anchorY;
  return sprite;
}

/** 名前・HPバー共通のアンカー高さ。オフセットはスクリーン空間で行う */
export const HEAD_ANCHOR_Y = 2.75;

/**
 * 約二頭身にデフォルメした低ポリゴンの魔法使い。
 * shapeで衣装/飛行具、accで頭飾りを切り替える。
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
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.72, 12), primary);
  skirt.position.y = shape === 1 ? 0.98 : 0.9;
  group.add(skirt);
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), primary);
  torso.scale.set(0.82, 0.92, 0.76);
  torso.position.y = 1.3;
  group.add(torso);

  // マント。進行方向(+X)の後ろ側へ流して、停止中も向きを読み取れるようにする。
  const cape = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.82, 8, 1, true), dark);
  cape.rotation.z = Math.PI / 2.7;
  cape.scale.z = 0.65;
  cape.position.set(-0.28, 1.16, 0);
  group.add(cape);

  // 頭は身体とほぼ同じ高さ。顔を前(+X)へ寄せ、大きな目が俯瞰でも見える形にする。
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 16, 12), skin);
  head.position.set(0.04, 1.82, 0);
  group.add(head);
  const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.52, 14, 10), hair);
  hairBack.scale.set(0.96, 1.03, 1.02);
  hairBack.position.set(-0.08, 1.87, 0);
  group.add(hairBack);
  // 顔を髪より少し前へ重ね直す。
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.43, 16, 12), skin);
  face.scale.set(0.76, 0.94, 0.93);
  face.position.set(0.19, 1.82, 0);
  group.add(face);

  // 前髪を三房に分け、単純な球体よりアニメキャラらしい輪郭を作る。
  for (const [y, z] of [[2.12, -0.2], [2.17, 0], [2.12, 0.2]] as const) {
    const bang = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), hair);
    bang.scale.set(0.42, 0.9, 0.72);
    bang.position.set(0.43, y, z);
    bang.rotation.x = z * 0.8;
    group.add(bang);
  }

  for (const z of [-0.18, 0.18]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 8, 7),
      new THREE.MeshBasicMaterial({ color: shape === 2 ? 0x315fa8 : 0x4d285f }),
    );
    eye.scale.set(0.32, 1.12, 0.78);
    eye.position.set(0.523, 1.88, z);
    group.add(eye);

    const shine = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    shine.position.set(0.55, 1.92, z + (z > 0 ? -0.018 : 0.018));
    group.add(shine);

    const cheek = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 7, 5),
      new THREE.MeshBasicMaterial({ color: 0xff91a8, transparent: true, opacity: 0.68 }),
    );
    cheek.scale.set(0.22, 0.45, 1);
    cheek.position.set(0.535, 1.72, z * 1.45);
    group.add(cheek);

    const lock = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.36, 3, 7), hair);
    lock.position.set(-0.04, 1.53, z * 2.15);
    lock.rotation.z = z > 0 ? -0.12 : 0.12;
    group.add(lock);
  }
  const mouth = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 7, 5),
    new THREE.MeshBasicMaterial({ color: 0xb84c68 }),
  );
  mouth.scale.set(0.25, 0.45, 1);
  mouth.position.set(0.535, 1.72, 0);
  group.add(mouth);

  // 腕は肩から手先までを結ぶ円柱で構成する。
  const rightHand = shape === 1
    ? new THREE.Vector3(0.42, 1.12, 0.35)
    : new THREE.Vector3(0.48, 1.38, 0.42);
  const leftHand = shape === 1
    ? new THREE.Vector3(0.4, 1.12, -0.35)
    : new THREE.Vector3(0.08, 1.25, -0.46);
  addLimb(group, new THREE.Vector3(0, 1.36, 0.26), rightHand, 0.09, primary);
  addLimb(group, new THREE.Vector3(0, 1.36, -0.26), leftHand, 0.09, primary);
  for (const handPos of [rightHand, leftHand]) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), skin);
    hand.position.copy(handPos);
    group.add(hand);
  }

  if (shape === 1) {
    addBroom(group, wood, accent);
    // 箒を挟むブーツ
    for (const z of [-0.22, 0.22]) {
      const boot = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.25, 3, 7), dark);
      boot.rotation.z = -Math.PI / 2.8;
      boot.position.set(0.16, 0.66, z);
      group.add(boot);
    }
  } else {
    addWand(group, rightHand, shape === 2, wood, accent);
  }

  if (acc === 1) {
    addWitchHat(group, dark, accent);
  } else if (acc === 2) {
    // 大きなリボン
    for (const z of [-0.25, 0.25]) {
      const bow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.42, 7), accent);
      bow.rotation.x = z > 0 ? Math.PI / 2 : -Math.PI / 2;
      bow.position.set(-0.22, 2.15, z);
      group.add(bow);
    }
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), accent);
    knot.position.set(-0.22, 2.15, 0);
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
    ? new THREE.Vector3(1.25, 2.08, 0.48)
    : new THREE.Vector3(1.13, 1.7, 0.48);
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
  addLimb(group, new THREE.Vector3(-1.08, 0.58, 0), new THREE.Vector3(1.3, 0.58, 0), 0.045, wood);
  const bristles = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.72, 9), accent);
  bristles.rotation.z = -Math.PI / 2;
  bristles.position.set(-1.34, 0.58, 0);
  group.add(bristles);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), accent);
  tip.position.set(1.32, 0.58, 0);
  group.add(tip);
}

function addWitchHat(group: THREE.Group, dark: THREE.Material, accent: THREE.Material): void {
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 14), dark);
  brim.position.y = 2.25;
  group.add(brim);
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.78, 12), dark);
  crown.position.set(-0.09, 2.61, 0);
  crown.rotation.z = 0.16;
  group.add(crown);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.055, 6, 14), accent);
  band.rotation.x = Math.PI / 2;
  band.position.y = 2.36;
  group.add(band);
}
