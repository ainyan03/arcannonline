import * as THREE from 'three';
import { SANCTUARY_RADIUS } from '../../../shared/src/protocol';

/** フィールド中央の防衛対象「魔力灯」。 */
export class BaseView {
  readonly object = new THREE.Group();

  private readonly crystal: THREE.Mesh;
  private readonly crystalMaterial: THREE.MeshStandardMaterial;
  private readonly rings: THREE.Mesh[] = [];
  private readonly light: THREE.PointLight;
  /** 聖域 (回復エリア) の境界リングと床面。点灯中だけ表示する */
  private readonly sanctuaryRing: THREE.Mesh;
  private readonly sanctuaryRingMaterial: THREE.MeshBasicMaterial;
  private readonly sanctuaryDiscMaterial: THREE.MeshBasicMaterial;
  private readonly sanctuaryDisc: THREE.Mesh;

  constructor() {
    this.object.name = 'arcane-beacon';

    // 聖域の可視化: 淡く光る床面と、脈動する境界リング
    this.sanctuaryDiscMaterial = new THREE.MeshBasicMaterial({
      color: 0x7edfff,
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
    });
    this.sanctuaryDisc = new THREE.Mesh(
      new THREE.CircleGeometry(SANCTUARY_RADIUS, 48),
      this.sanctuaryDiscMaterial,
    );
    this.sanctuaryDisc.rotation.x = -Math.PI / 2;
    this.sanctuaryDisc.position.y = 0.05;
    this.object.add(this.sanctuaryDisc);
    this.sanctuaryRingMaterial = new THREE.MeshBasicMaterial({
      color: 0x7edfff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.sanctuaryRing = new THREE.Mesh(
      new THREE.RingGeometry(SANCTUARY_RADIUS - 0.35, SANCTUARY_RADIUS, 64),
      this.sanctuaryRingMaterial,
    );
    this.sanctuaryRing.rotation.x = -Math.PI / 2;
    this.sanctuaryRing.position.y = 0.06;
    this.object.add(this.sanctuaryRing);

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
    // 聖域は点灯中だけ有効。境界リングをゆっくり脈動させる
    this.sanctuaryDisc.visible = lit;
    this.sanctuaryRing.visible = lit;
    if (lit) {
      const pulse = Math.sin(now * 0.002);
      this.sanctuaryRingMaterial.opacity = 0.4 + pulse * 0.15;
      this.sanctuaryDiscMaterial.opacity = 0.06 + pulse * 0.02;
    }
  }
}
