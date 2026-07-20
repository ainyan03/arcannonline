import * as THREE from 'three';
import { OBSTACLES } from '../../../shared/src/obstacles';

/**
 * フィールドの岩の静的表示。コライダー (shared/src/obstacles.ts) と
 * 同じ半径で描き、見た目と当たりが食い違わないようにする。
 * 弾は岩で消えるため、高さのある「立ち岩」として描く。
 */
export function createObstacles(): THREE.Group {
  const group = new THREE.Group();
  const rockMaterial = new THREE.MeshLambertMaterial({ color: 0x6b6478 });
  const mossMaterial = new THREE.MeshLambertMaterial({ color: 0x55705a });
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x22152e,
    transparent: true,
    opacity: 0.25,
  });

  OBSTACLES.forEach((o, i) => {
    // 低ポリの立ち岩。index 由来の擬似乱数で形と向きを散らす (全端末で一致)
    const twist = ((i * 2654435761) >>> 8) / 0xffffff;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(o.r, 0),
      i % 3 === 2 ? mossMaterial : rockMaterial,
    );
    rock.position.set(o.x, o.r * 0.55, o.y);
    rock.scale.set(1, 0.85 + twist * 0.5, 1);
    rock.rotation.y = twist * Math.PI * 2;
    group.add(rock);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(o.r * 1.08, 24),
      shadowMaterial,
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(o.x, 0.03, o.y);
    group.add(shadow);
  });
  return group;
}
