import * as THREE from 'three';

/** フィールド中央の防衛対象「魔力灯」。 */
export class BaseView {
  readonly object = new THREE.Group();

  private readonly crystal: THREE.Mesh;
  private readonly crystalMaterial: THREE.MeshStandardMaterial;
  private readonly rings: THREE.Mesh[] = [];
  private readonly light: THREE.PointLight;

  constructor() {
    this.object.name = 'arcane-beacon';

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.8, 0.8, 24),
      new THREE.MeshStandardMaterial({ color: 0x463c70, roughness: 0.65 }),
    );
    pedestal.position.y = 0.4;
    pedestal.receiveShadow = true;
    this.object.add(pedestal);

    this.crystalMaterial = new THREE.MeshStandardMaterial({
      color: 0x91e8ff,
      emissive: 0x3188ff,
      emissiveIntensity: 2.2,
      roughness: 0.18,
      metalness: 0.05,
    });
    this.crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.3, 0),
      this.crystalMaterial,
    );
    this.crystal.position.y = 2.4;
    this.crystal.castShadow = true;
    this.object.add(this.crystal);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x7edfff,
      transparent: true,
      opacity: 0.72,
    });
    for (const radius of [1.8, 2.35]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.055, 8, 48),
        ringMaterial.clone(),
      );
      ring.position.y = 2.4;
      ring.rotation.x = Math.PI / 2;
      this.rings.push(ring);
      this.object.add(ring);
    }

    this.light = new THREE.PointLight(0x6bcfff, 16, 22, 2);
    this.light.position.y = 3;
    this.object.add(this.light);
  }

  update(now: number, hp: number, maxHp: number, lit: boolean): void {
    const ratio = Math.min(Math.max(hp / maxHp, 0), 1);
    this.crystal.rotation.y = now * 0.0007;
    this.crystal.position.y = lit ? 2.4 + Math.sin(now * 0.002) * 0.16 : 1.25;
    this.crystal.scale.setScalar(lit ? 0.82 + ratio * 0.18 : 0.55);
    // 消灯中もゲージ回復に応じてほのかに明るくなり、再点火の近さが分かる
    this.crystalMaterial.emissiveIntensity = lit ? 0.5 + ratio * 1.8 : 0.08 + ratio * 0.35;
    this.crystalMaterial.color.setHex(lit ? 0x91e8ff : 0x514f67);
    this.light.intensity = lit ? 4 + ratio * 12 : 0;
    this.rings[0].rotation.z = now * 0.00045;
    this.rings[1].rotation.z = -now * 0.00032;
    for (const ring of this.rings) ring.visible = lit;
  }
}
