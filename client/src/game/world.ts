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
    new THREE.MeshLambertMaterial({ color: 0x4a8f5a }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const grid = new THREE.GridHelper(FIELD_SIZE, 20, 0x2f5f3f, 0x3f7a4f);
  grid.position.y = 0.02;
  scene.add(grid);

  return { scene, renderer };
}
