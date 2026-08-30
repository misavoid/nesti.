import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

let cleanup: (() => void) | undefined;

export function mountGame(canvas: HTMLCanvasElement, completed: number, total: number): void {
  cleanup?.();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0xcfe8e4);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcfe8e4, 8, 18);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(5.8, 4.4, 7.2);
  camera.lookAt(0, 0.6, 0);

  scene.add(new THREE.HemisphereLight(0xf4fffd, 0x52665d, 2.8));
  const sun = new THREE.DirectionalLight(0xfff3d5, 4.2);
  sun.position.set(-4, 7, 5);
  sun.castShadow = true;
  scene.add(sun);

  const group = new THREE.Group();
  scene.add(group);
  new GLTFLoader().load("/models/FloatingIsland.glb", (gltf) => {
    const island = gltf.scene;
    island.scale.setScalar(1.6);
    island.position.y = -1.1;
    island.traverse((child) => {
      if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; }
    });
    group.add(island);
  });

  const cleanRatio = total ? completed / total : 1;
  const remaining = Math.max(0, total - completed);
  const colors = [0xdc664f, 0xf2b647, 0x4d7d9f];
  for (let index = 0; index < remaining; index += 1) {
    const angle = (index / Math.max(remaining, 1)) * Math.PI * 2;
    const geometry = index % 2 ? new THREE.BoxGeometry(.22, .28, .18) : new THREE.CylinderGeometry(.1, .13, .3, 12);
    const item = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: colors[index % colors.length], roughness: .72 }));
    item.position.set(Math.cos(angle) * (1.2 + index % 3 * .18), -.05, Math.sin(angle) * (1.05 + index % 2 * .22));
    item.rotation.set(.2, angle, .1);
    item.castShadow = true;
    group.add(item);
  }

  for (let index = 0; index < Math.ceil(cleanRatio * 12); index += 1) {
    const angle = index * 2.4;
    const sparkle = new THREE.Mesh(new THREE.SphereGeometry(.035 + index % 2 * .02, 10, 10), new THREE.MeshBasicMaterial({ color: 0xfff1a6 }));
    sparkle.position.set(Math.cos(angle) * 1.7, .4 + (index % 4) * .28, Math.sin(angle) * 1.4);
    group.add(sparkle);
  }

  let dragging = false;
  let previousX = 0;
  const onDown = (event: PointerEvent) => { dragging = true; previousX = event.clientX; canvas.setPointerCapture(event.pointerId); };
  const onMove = (event: PointerEvent) => { if (dragging) { group.rotation.y += (event.clientX - previousX) * .008; previousX = event.clientX; } };
  const onUp = () => { dragging = false; };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);

  const resize = () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let frame = 0;
  const animate = () => {
    if (!reduced && !dragging) group.rotation.y += .0015;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  };
  resize();
  animate();
  cleanup = () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    renderer.dispose();
  };
}

export function unmountGame(): void { cleanup?.(); cleanup = undefined; }
