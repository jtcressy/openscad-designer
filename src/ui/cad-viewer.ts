import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

export class CadViewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100_000);
  private readonly controls: OrbitControls;
  private readonly loader = new STLLoader();
  private readonly resizeObserver: ResizeObserver;
  private mesh?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private frame = 0;
  private dark = false;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.setAttribute("aria-label", "Rotatable 3D model preview");
    this.container.append(this.renderer.domElement);

    this.camera.up.set(0, 0, 1);
    this.camera.position.set(90, -110, 85);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.screenSpacePanning = true;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x53606c, 2.3));
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(4, -5, 8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9cc7ff, 1.2);
    fill.position.set(-5, 3, 2);
    this.scene.add(fill);

    const grid = new THREE.GridHelper(300, 30, 0x748094, 0xa9b0ba);
    grid.name = "grid";
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.025;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.24;
    this.scene.add(grid);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.animate();
  }

  /** Parse and display a binary or ASCII STL supplied as an ArrayBuffer. */
  loadSTL(buffer: ArrayBuffer): void {
    const geometry = this.loader.parse(buffer);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();

    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }

    const material = new THREE.MeshStandardMaterial({
      color: this.dark ? 0x88b7ff : 0x2877d4,
      metalness: 0.08,
      roughness: 0.62,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.scene.add(this.mesh);
    this.fitCamera(geometry);
  }

  clear(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh = undefined;
  }

  setTheme(theme: "light" | "dark"): void {
    this.dark = theme === "dark";
    if (this.mesh) this.mesh.material.color.setHex(this.dark ? 0x88b7ff : 0x2877d4);
  }

  resetView(): void {
    if (this.mesh) this.fitCamera(this.mesh.geometry);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private fitCamera(geometry: THREE.BufferGeometry): void {
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    if (!sphere) return;
    const radius = Math.max(sphere.radius, 0.1);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.camera.near = Math.max(distance / 10_000, 0.001);
    this.camera.far = distance * 100;
    this.camera.position.set(
      sphere.center.x + distance * 0.72,
      sphere.center.y - distance * 0.92,
      sphere.center.z + distance * 0.62,
    );
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(sphere.center);
    this.controls.minDistance = radius * 0.05;
    this.controls.maxDistance = distance * 10;
    this.controls.update();
  }

  private resize(): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    this.frame = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}

/** Explicit geometry integration point for MCP results and the OpenSCAD worker. */
export function loadStlArrayBuffer(viewer: CadViewer, buffer: ArrayBuffer): void {
  viewer.loadSTL(buffer);
}
