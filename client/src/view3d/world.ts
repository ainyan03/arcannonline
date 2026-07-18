import * as THREE from 'three';
import { FIELD_SIZE } from '../../../shared/src/protocol';
import { mulberry32 } from '../sim/danmaku/rng';

export interface World {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
}

/** フィールド（地面・グリッド・ライティング）とレンダラを生成する。 */
export function createWorld(container: HTMLElement): World {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const skyColor = new THREE.Color(0x87b5d9);
  scene.background = skyColor;
  scene.fog = new THREE.Fog(skyColor, 80, 300);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x446644, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(40, 80, 20);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_SIZE, FIELD_SIZE),
    new THREE.MeshLambertMaterial({ map: createCheckerTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const grid = new THREE.GridHelper(FIELD_SIZE, 20, 0x2f5f3f, 0x3f7a4f);
  grid.position.y = 0.02;
  scene.add(grid);

  // 方位の手がかり: 原点を通る軸ストライプ (x軸=赤系, y(z)軸=青系)
  const xAxis = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_SIZE, 0.5),
    new THREE.MeshBasicMaterial({ color: 0xbb5544 }),
  );
  xAxis.rotation.x = -Math.PI / 2;
  xAxis.position.y = 0.03;
  scene.add(xAxis);
  const zAxis = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, FIELD_SIZE),
    new THREE.MeshBasicMaterial({ color: 0x4455bb }),
  );
  zAxis.rotation.x = -Math.PI / 2;
  zAxis.position.y = 0.03;
  scene.add(zAxis);

  addWalls(scene);
  addRocks(scene);

  return { scene, renderer };
}

/** 外周の壁 (見た目のみ。移動制限は sim 側の clamp が担う) */
function addWalls(scene: THREE.Scene): void {
  const mat = new THREE.MeshLambertMaterial({ color: 0x2e5238 });
  const half = FIELD_SIZE / 2;
  const geoH = new THREE.BoxGeometry(FIELD_SIZE + 2, 1.6, 1);
  const geoV = new THREE.BoxGeometry(1, 1.6, FIELD_SIZE + 2);
  for (const [geo, x, z] of [
    [geoH, 0, -half - 0.5],
    [geoH, 0, half + 0.5],
    [geoV, -half - 0.5, 0],
    [geoV, half + 0.5, 0],
  ] as const) {
    const wall = new THREE.Mesh(geo, mat);
    wall.position.set(x, 0.8, z);
    scene.add(wall);
  }
}

/**
 * 装飾の岩 (演出のみ、当たり判定なし)。
 * シード固定の乱数で配置するため全クライアントで同じ見た目になる。
 */
function addRocks(scene: THREE.Scene): void {
  const rng = mulberry32(0xb17);
  const geo = new THREE.DodecahedronGeometry(1, 0);
  for (let i = 0; i < 48; i++) {
    const x = (rng() * 2 - 1) * 95;
    const z = (rng() * 2 - 1) * 95;
    if (Math.abs(x) < 38 && Math.abs(z) < 38) continue; // 中央の戦場は空けておく
    const size = 0.5 + rng() * 1.4;
    const rock = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({
        color: new THREE.Color().setHSL(0.28 + rng() * 0.08, 0.25, 0.3 + rng() * 0.15),
      }),
    );
    rock.scale.setScalar(size);
    rock.position.set(x, size * 0.45, z);
    rock.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    scene.add(rock);
  }
}

/** デバッグ用のチェッカー模様 (1マス = 5 units)。移動量の目視確認に使う */
function createCheckerTexture(): THREE.Texture {
  const cells = 8;
  const px = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = cells * px;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#4a8f5a' : '#417f50';
      ctx.fillRect(x * px, y * px, px, px);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(FIELD_SIZE / (cells * 5), FIELD_SIZE / (cells * 5));
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
