import * as THREE from 'three';
import { FIELD_SIZE } from '../../../shared/src/protocol';

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

  return { scene, renderer };
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
