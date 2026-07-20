import * as THREE from 'three';

/**
 * Object3D 配下でこの表示専用に作られたGeometry・Material・Textureを解放する。
 * 同じリソースを複数Meshが共有していても一度だけdisposeする。
 */
export function disposeObject3D(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((child) => {
    if ('geometry' in child) {
      const geometry = (child as THREE.Mesh).geometry;
      if (geometry) geometries.add(geometry);
    }
    if (!('material' in child)) return;
    const value = (child as THREE.Mesh | THREE.Sprite).material;
    const childMaterials = Array.isArray(value) ? value : value ? [value] : [];
    for (const material of childMaterials) {
      materials.add(material);
      for (const property of Object.values(material)) {
        if (property instanceof THREE.Texture) textures.add(property);
      }
    }
  });

  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}
