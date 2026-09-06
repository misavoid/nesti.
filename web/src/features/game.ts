import * as THREE from "three";

let cleanup: (() => void) | undefined;
let previousCounts: { completed: number; remaining: number } | undefined;

const helperHome = new THREE.Vector3(0.55, 0.35, 0.42);
const houseBounds = { minX: -2.08, maxX: -0.42, minZ: -1.5, maxZ: 0.12 };

const palette = {
  sky: 0xcfe8f5,
  cloud: 0xfbfdff,
  cloudShade: 0xeaf5fb,
  grass: 0x79d48c,
  grassDark: 0x4fae6a,
  earth: 0xb97955,
  soil: 0x7f5138,
  cream: 0xffedc8,
  wallShade: 0xf4d4a4,
  roof: 0xc56f34,
  roofDark: 0x8f4a2a,
  roofLight: 0xe39655,
  wood: 0x8f5f3d,
  door: 0x8d4f2f,
  glass: 0x9fd6ee,
  skin: 0xf5c8a8,
  overalls: 0x61b994,
  navy: 0x263d4a,
  can: 0xb7c9cc,
  bottle: 0x6eb6de,
  paper: 0xf7ebc3,
  bag: 0x77888c,
  cardboard: 0xc7955e,
  coral: 0xf28c82,
  cheek: 0xf3a7a0,
  glove: 0xfff2d2,
  boot: 0x20333c,
  bagDark: 0x4d5c60,
  bagBlue: 0x6d8790,
  bagGreen: 0x5f7568,
  bagPurple: 0x746b83,
  bagBlack: 0x2f3a3d,
  stone: 0xbebeb5
};

type HelperModel = {
  root: THREE.Group;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  idleYaw: number;
};

export function mountGame(canvas: HTMLCanvasElement, completed: number, total: number): void {
  cleanup?.();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(palette.sky);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(palette.sky, 10, 24);

  const camera = new THREE.OrthographicCamera(-4.8, 4.8, 3.1, -3.1, 0.1, 100);
  camera.position.set(6.2, 5.6, 7.4);
  camera.lookAt(0, 0.38, 0);

  scene.add(new THREE.HemisphereLight(0xfffdf7, 0x668977, 2.7));
  const sun = new THREE.DirectionalLight(0xfff1cc, 4.4);
  sun.position.set(-4.5, 8.5, 5.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -7;
  sun.shadow.camera.right = 7;
  sun.shadow.camera.top = 7;
  sun.shadow.camera.bottom = -7;
  scene.add(sun);

  const world = new THREE.Group();
  world.position.y = -0.15;
  scene.add(world);

  addCloud(world);
  addIsland(world);
  addFarmhouse(world);
  addDecor(world);

  const remaining = Math.max(0, total - completed);
  addTrash(world, remaining);
  const helper = makeHelper(camera.position);
  world.add(helper.root);
  const removedTrashIndex = previousCounts && completed > previousCounts.completed && remaining < previousCounts.remaining
    ? Math.max(0, previousCounts.remaining - 1)
    : undefined;
  let pickupBag: THREE.Group | undefined;
  if (removedTrashIndex !== undefined) {
    pickupBag = makeTrashItem(removedTrashIndex);
    pickupBag.position.copy(trashPosition(removedTrashIndex));
    pickupBag.userData.baseScale = pickupBag.scale.x;
    world.add(pickupBag);
  }
  const pickupTarget = pickupBag?.position.clone();
  previousCounts = { completed, remaining };

  let dragging = false;
  let previousX = 0;
  const renderScene = () => { renderer.render(scene, camera); };
  const onContextMenu = (event: MouseEvent) => { event.preventDefault(); };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 2) return;
    event.preventDefault();
    dragging = true;
    previousX = event.clientX;
    canvas.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    world.rotation.y += (event.clientX - previousX) * 0.008;
    faceCamera(helper, world.rotation.y);
    previousX = event.clientX;
    renderScene();
  };
  const onPointerUp = () => { dragging = false; };
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);

  const resize = () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    const aspect = width / Math.max(height, 1);
    const verticalSize = width < 640 ? 6.35 : 4.95;
    camera.left = -verticalSize * aspect / 2;
    camera.right = verticalSize * aspect / 2;
    camera.top = verticalSize / 2;
    camera.bottom = -verticalSize / 2;
    camera.updateProjectionMatrix();
    renderScene();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let frame = 0;
  const clock = new THREE.Clock();
  const animate = () => {
    const elapsed = clock.getElapsedTime();
    const active = Boolean(pickupTarget && !reduced && elapsed < 2.6);
    if (pickupTarget && pickupBag && !reduced) animatePickup(helper, pickupTarget, pickupBag, elapsed, world.rotation.y);
    renderScene();
    if (active) frame = requestAnimationFrame(animate);
  };

  resize();
  if (pickupTarget && !reduced) animate();
  else renderScene();
  cleanup = () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    canvas.removeEventListener("contextmenu", onContextMenu);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    disposeObject(scene);
    renderer.dispose();
  };
}

export function unmountGame(): void {
  cleanup?.();
  cleanup = undefined;
}

function addCloud(root: THREE.Group): void {
  const cloud = new THREE.Group();
  cloud.position.y = -1.28;
  root.add(cloud);

  const puffMaterial = material(palette.cloud, 0.95);
  const shadeMaterial = material(palette.cloudShade, 0.98);
  const puffs: [number, number, number, number, number, number][] = [
    [0, -0.1, 0, 3.7, 0.44, 2.55],
    [-3.25, 0.04, -0.45, 1.12, 0.66, 0.88],
    [-2.55, 0.16, 1.22, 1.28, 0.72, 1.0],
    [-0.78, 0.24, 2.16, 1.18, 0.66, 0.95],
    [0.92, 0.22, 2.14, 1.26, 0.7, 1.02],
    [2.6, 0.15, 1.08, 1.18, 0.7, 0.95],
    [3.3, 0.06, -0.54, 1.05, 0.62, 0.86],
    [2.24, 0.1, -1.86, 1.2, 0.66, 1.0],
    [0.38, 0.12, -2.26, 1.3, 0.66, 1.05],
    [-1.62, 0.1, -1.94, 1.16, 0.64, 0.95],
    [-3.38, -0.18, 0.62, 0.92, 0.5, 0.72],
    [3.36, -0.18, 0.56, 0.86, 0.48, 0.7],
    [-0.2, -0.28, 2.7, 0.86, 0.44, 0.7],
    [0.22, -0.28, -2.72, 0.9, 0.44, 0.72],
    [-1.35, -0.36, 2.48, 0.84, 0.38, 0.62],
    [1.42, -0.36, 2.44, 0.82, 0.38, 0.62],
    [-2.35, -0.34, -2.12, 0.78, 0.36, 0.58],
    [2.38, -0.34, -2.04, 0.8, 0.36, 0.58]
  ];

  for (const [x, y, z, sx, sy, sz] of puffs) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), x === 0 ? shadeMaterial : puffMaterial);
    puff.position.set(x, y, z);
    puff.scale.set(sx, sy, sz);
    puff.receiveShadow = true;
    cloud.add(puff);
  }
}

function addIsland(root: THREE.Group): void {
  const footprint = islandShape();
  const earth = new THREE.Mesh(
    new THREE.ExtrudeGeometry(footprint, { depth: 0.72, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.035, bevelSegments: 1 }),
    material(palette.earth, 0.92)
  );
  earth.rotation.x = -Math.PI / 2;
  earth.position.y = -0.52;
  earth.castShadow = true;
  earth.receiveShadow = true;
  root.add(earth);

  const underside = new THREE.Mesh(new THREE.ConeGeometry(2.25, 1.7, 11), material(palette.soil, 0.98));
  underside.position.set(0.02, -1.06, 0.02);
  underside.scale.set(1.08, 1, 0.76);
  underside.rotation.y = 0.2;
  underside.castShadow = true;
  root.add(underside);

  const grass = new THREE.Mesh(
    new THREE.ExtrudeGeometry(footprint, { depth: 0.16, bevelEnabled: true, bevelSize: 0.045, bevelThickness: 0.025, bevelSegments: 1 }),
    material(palette.grass, 0.82)
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = 0.12;
  grass.scale.set(0.95, 0.95, 0.95);
  grass.castShadow = true;
  grass.receiveShadow = true;
  root.add(grass);

  for (const [x, z, scale] of [[-1.55, -0.9, 0.58], [1.55, 0.7, 0.46]] as const) {
    const mound = new THREE.Mesh(new THREE.SphereGeometry(0.75, 18, 12), material(palette.grassDark, 0.9));
    mound.position.set(x, 0.18, z);
    mound.scale.set(scale * 1.45, scale * 0.35, scale);
    mound.receiveShadow = true;
    root.add(mound);
  }
}

function islandShape(): THREE.Shape {
  const shape = new THREE.Shape();
  const points: THREE.Vector2[] = [];
  const radii = [1.02, 1.12, 1.04, 0.94, 1.08, 0.98, 1.1, 1.03, 0.92, 1.0, 1.08, 0.96];
  for (let index = 0; index < radii.length; index += 1) {
    const angle = index / radii.length * Math.PI * 2;
    points.push(new THREE.Vector2(Math.cos(angle) * radii[index] * 2.85, Math.sin(angle) * radii[index] * 2.08));
  }
  shape.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const previous = points[index - 1];
    shape.quadraticCurveTo(previous.x, previous.y, (previous.x + current.x) / 2, (previous.y + current.y) / 2);
  }
  const last = points[points.length - 1];
  const first = points[0];
  shape.quadraticCurveTo(last.x, last.y, (last.x + first.x) / 2, (last.y + first.y) / 2);
  shape.closePath();
  return shape;
}

function addFarmhouse(root: THREE.Group): void {
  const house = new THREE.Group();
  house.position.set(-1.28, 0.27, -0.8);
  house.rotation.y = 0.08;
  root.add(house);

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.86, 0.98), material(palette.cream, 0.82));
  body.position.y = 0.43;
  body.castShadow = true;
  body.receiveShadow = true;
  house.add(body);

  const sideShade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.78, 0.9), material(palette.wallShade, 0.86));
  sideShade.position.set(0.61, 0.43, -0.02);
  house.add(sideShade);

  const eave = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.12, 1.16), material(palette.roofDark, 0.82));
  eave.position.y = 0.91;
  eave.castShadow = true;
  house.add(eave);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.96, 0.72, 4), material(palette.roof, 0.78));
  roof.position.y = 1.25;
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1.08, 0.92, 0.92);
  roof.castShadow = true;
  house.add(roof);

  const roofHighlight = new THREE.Mesh(new THREE.ConeGeometry(0.58, 0.45, 4), material(palette.roofLight, 0.78));
  roofHighlight.position.set(-0.12, 1.31, 0.08);
  roofHighlight.rotation.y = Math.PI / 4;
  roofHighlight.scale.set(0.78, 0.6, 0.7);
  roofHighlight.castShadow = true;
  house.add(roofHighlight);

  const frontAwning = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.09, 0.18), material(palette.roofDark, 0.8));
  frontAwning.position.set(0.02, 0.76, 0.62);
  frontAwning.rotation.x = -0.18;
  frontAwning.castShadow = true;
  house.add(frontAwning);

  const doorShape = new THREE.Shape();
  doorShape.moveTo(-0.15, -0.23);
  doorShape.lineTo(-0.15, 0.08);
  doorShape.quadraticCurveTo(-0.15, 0.23, 0, 0.23);
  doorShape.quadraticCurveTo(0.15, 0.23, 0.15, 0.08);
  doorShape.lineTo(0.15, -0.23);
  doorShape.closePath();
  const door = new THREE.Mesh(new THREE.ExtrudeGeometry(doorShape, { depth: 0.04, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 1 }), material(palette.door, 0.88));
  door.position.set(0.02, 0.28, 0.51);
  house.add(door);

  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), material(palette.roofLight, 0.55, 0.1));
  knob.position.set(0.1, 0.29, 0.56);
  house.add(knob);

  const step = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.08, 0.28), material(palette.stone, 0.96));
  step.position.set(0.02, 0.04, 0.66);
  step.castShadow = true;
  house.add(step);

  for (const x of [-0.34, 0.38]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.25, 0.045), material(palette.cream, 0.8));
    frame.position.set(x, 0.58, 0.515);
    house.add(frame);

    const window = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.05), material(palette.glass, 0.28));
    window.position.set(x, 0.58, 0.545);
    house.add(window);

    const mullionV = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.19, 0.055), material(palette.cream, 0.78));
    mullionV.position.set(x, 0.58, 0.575);
    house.add(mullionV);

    const mullionH = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.022, 0.055), material(palette.cream, 0.78));
    mullionH.position.set(x, 0.58, 0.58);
    house.add(mullionH);
  }

  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.22), material(palette.roofDark, 0.9));
  chimney.position.set(-0.34, 1.32, -0.16);
  chimney.castShadow = true;
  house.add(chimney);

  const smokeMaterial = material(palette.cloud, 0.95);
  for (let index = 0; index < 3; index += 1) {
    const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.08 + index * 0.02, 10, 8), smokeMaterial);
    smoke.position.set(-0.43 - index * 0.08, 1.55 + index * 0.13, -0.14);
    smoke.scale.set(1.1, 0.72, 0.86);
    house.add(smoke);
  }
}

function addDecor(root: THREE.Group): void {
  for (const [x, z, scale] of [[1.55, -0.9, 0.9], [2.05, -0.12, 0.68], [-2.12, 0.72, 0.66]] as const) {
    const tree = new THREE.Group();
    tree.position.set(x, 0.24, z);
    tree.scale.setScalar(scale);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.66, 10), material(palette.wood, 0.92));
    trunk.position.y = 0.32;
    trunk.castShadow = true;
    tree.add(trunk);
    for (const [cx, cy, cz, radius] of [[0, 0.9, 0, 0.42], [-0.25, 0.8, 0.04, 0.32], [0.25, 0.8, 0.03, 0.33]] as const) {
      const crown = new THREE.Mesh(new THREE.SphereGeometry(radius, 18, 12), material(palette.grassDark, 0.9));
      crown.position.set(cx, cy, cz);
      crown.scale.y = 0.9;
      crown.castShadow = true;
      tree.add(crown);
    }
    root.add(tree);
  }

  for (const [x, z] of [[0.62, 1.35], [-1.28, 1.28], [1.94, 0.7], [-2.15, -0.45]] as const) {
    const rock = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), material(palette.stone, 0.96));
    rock.position.set(x, 0.29, z);
    rock.scale.set(1.35, 0.42, 0.86);
    rock.rotation.y = x + z;
    rock.castShadow = true;
    root.add(rock);
  }

  for (const [index, x, z] of [[0, -0.88, -0.26], [1, -0.62, 0.08], [2, -0.32, 0.36], [3, 0.04, 0.58]] as const) {
    const stone = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), material(index % 2 ? palette.paper : palette.stone, 0.96));
    stone.position.set(x, 0.31, z);
    stone.scale.set(1.25, 0.18, 0.78);
    stone.rotation.y = index * 0.42;
    root.add(stone);
  }

  for (const [x, z, color] of [[-0.25, -1.52, palette.coral], [1.55, 1.05, palette.cheek]] as const) {
    const flower = new THREE.Group();
    flower.position.set(x, 0.28, z);
    for (let index = 0; index < 4; index += 1) {
      const petal = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), material(color, 0.78));
      const angle = index * Math.PI / 2;
      petal.position.set(Math.cos(angle) * 0.06, 0.06, Math.sin(angle) * 0.06);
      flower.add(petal);
    }
    const center = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), material(palette.cream, 0.78));
    center.position.y = 0.07;
    flower.add(center);
    root.add(flower);
  }

  const pond = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.025, 24), material(palette.bottle, 0.5));
  pond.position.set(0.65, 0.285, 1.42);
  pond.scale.z = 0.66;
  root.add(pond);

  const fence = new THREE.Group();
  fence.position.set(0.55, 0.3, -1.52);
  fence.rotation.y = -0.08;
  for (const x of [-0.48, 0, 0.48]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.46, 8), material(palette.wood, 0.92));
    post.position.set(x, 0.2, 0);
    post.castShadow = true;
    fence.add(post);
  }
  for (const y of [0.16, 0.32]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.055, 0.06), material(palette.cream, 0.84));
    rail.position.y = y;
    rail.castShadow = true;
    fence.add(rail);
  }
  root.add(fence);
}

function addTrash(root: THREE.Group, count: number): THREE.Group[] {
  const items: THREE.Group[] = [];
  const maxVisible = Math.min(count, 36);
  for (let index = 0; index < maxVisible; index += 1) {
    const item = makeTrashItem(index);
    item.position.copy(trashPosition(index));
    item.userData.baseY = item.position.y;
    root.add(item);
    items.push(item);
  }
  return items;
}

function trashPosition(index: number): THREE.Vector3 {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  let accepted = -1;
  for (let candidate = 0; candidate < 260; candidate += 1) {
    const ring = Math.min(0.92, 0.22 + Math.sqrt(candidate + 1) * 0.115);
    const angle = candidate * goldenAngle + 0.3;
    const position = new THREE.Vector3(Math.cos(angle) * ring * 2.55, 0.38, Math.sin(angle) * ring * 1.82);
    if (!isValidTrashPosition(position)) continue;
    accepted += 1;
    if (accepted === index) return position;
  }
  const fallbackAngle = index * goldenAngle;
  return new THREE.Vector3(Math.cos(fallbackAngle) * 1.95, 0.38, Math.sin(fallbackAngle) * 1.35);
}

function isValidTrashPosition(position: THREE.Vector3): boolean {
  const insideHouseBuffer = position.x > houseBounds.minX
    && position.x < houseBounds.maxX
    && position.z > houseBounds.minZ
    && position.z < houseBounds.maxZ;
  const nearHelper = distance2D(position, helperHome) < 0.58;
  const likelyHousePath = position.x < -0.4 && position.z < 0.18;
  const nearPond = distance2D(position, new THREE.Vector3(0.65, 0, 1.42)) < 0.42;
  return !insideHouseBuffer && !nearHelper && !likelyHousePath && !nearPond;
}

function distance2D(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function makeTrashItem(index: number): THREE.Group {
  const root = new THREE.Group();
  const colors = [palette.bagDark, palette.bagBlue, palette.bagGreen, palette.bagPurple, palette.bagBlack];
  const sizes = [
    [1.08, 1.24, 0.96],
    [0.86, 0.98, 0.82],
    [1.24, 1.05, 0.9],
    [0.72, 0.82, 0.7],
    [1.0, 0.92, 1.08]
  ] as const;
  const bagMaterial = material(colors[index % colors.length], 0.9);
  const body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18, 1), bagMaterial);
  const [sx, sy, sz] = sizes[index % sizes.length];
  body.scale.set(sx, sy, sz);
  body.position.y = 0.06;
  root.add(body);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.095, 0.11, 7), bagMaterial);
  neck.position.y = 0.25;
  neck.scale.x = 0.9;
  root.add(neck);

  const knot = new THREE.Mesh(new THREE.DodecahedronGeometry(0.06, 0), bagMaterial);
  knot.position.y = 0.33;
  knot.scale.set(1.2, 0.72, 0.86);
  root.add(knot);

  for (const side of [-1, 1]) {
    const tie = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 7), bagMaterial);
    tie.position.set(side * 0.07, 0.32, 0);
    tie.rotation.z = side * 0.85;
    root.add(tie);
  }

  const cinch = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.008, 5, 16), material(palette.cream, 0.82));
  cinch.position.y = 0.245;
  cinch.rotation.x = Math.PI / 2;
  root.add(cinch);

  const highlight = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), material(0xffffff, 0.85));
  highlight.position.set(-0.07, 0.14, 0.13);
  highlight.scale.set(1.3, 0.36, 0.24);
  root.add(highlight);

  root.scale.setScalar(1.15 + index % 4 * 0.16);
  root.rotation.set(0.06 * (index % 3 - 1), index * 0.4, 0.08 * (index % 2 ? 1 : -1));
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) child.castShadow = true;
  });
  return root;
}

function makeHelper(cameraPosition: THREE.Vector3): HelperModel {
  const root = new THREE.Group();
  root.name = "nesti-helper";
  root.position.copy(helperHome);
  const idleYaw = yawToward(root.position, cameraPosition);
  root.rotation.y = idleYaw;

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.34, 8, 16), material(palette.overalls, 0.72));
  body.position.y = 0.58;
  body.scale.set(1.0, 1.05, 0.82);
  body.castShadow = true;
  root.add(body);

  const shirt = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.16, 6, 14), material(palette.cream, 0.78));
  shirt.position.y = 0.74;
  shirt.scale.set(1.02, 0.72, 0.84);
  shirt.castShadow = true;
  root.add(shirt);

  for (const x of [-0.1, 0.1]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.32, 0.035), material(palette.roofDark, 0.78));
    strap.position.set(x, 0.73, 0.18);
    strap.rotation.z = -x * 0.55;
    root.add(strap);
  }

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 18), material(palette.skin, 0.78));
  head.position.y = 1.08;
  head.scale.set(1.04, 1.0, 0.96);
  head.castShadow = true;
  root.add(head);

  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.35, 20, 10), material(palette.wood, 0.86));
  hair.position.set(0, 1.2, -0.03);
  hair.scale.set(1.04, 0.58, 0.98);
  root.add(hair);

  const fringeMaterial = material(palette.wood, 0.86);
  const backHair = new THREE.Mesh(new THREE.SphereGeometry(0.32, 18, 12), fringeMaterial);
  backHair.position.set(0, 1.05, -0.16);
  backHair.scale.set(1.02, 0.98, 0.72);
  backHair.castShadow = true;
  root.add(backHair);

  for (const [x, rotation] of [[-0.26, -0.22], [0.26, 0.22]] as const) {
    const sideHair = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.18, 5, 10), fringeMaterial);
    sideHair.position.set(x, 1.04, 0.12);
    sideHair.rotation.z = rotation;
    sideHair.castShadow = true;
    root.add(sideHair);
  }

  for (const [x, rotation] of [[-0.12, 0.36], [0, 0], [0.12, -0.36]] as const) {
    const bang = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 7), fringeMaterial);
    bang.position.set(x, 1.16, 0.25);
    bang.rotation.x = Math.PI;
    bang.rotation.z = rotation;
    root.add(bang);
  }

  for (const x of [-0.3, 0.3]) {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 9), fringeMaterial);
    bun.position.set(x, 1.15, -0.04);
    bun.scale.set(0.92, 0.86, 0.86);
    bun.castShadow = true;
    root.add(bun);
  }

  for (const x of [-0.11, 0.11]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), material(palette.navy, 0.8));
    eye.position.set(x, 1.08, 0.31);
    eye.scale.set(1, 1.15, 0.45);
    root.add(eye);
  }

  for (const x of [-0.17, 0.17]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), material(palette.cheek, 0.8));
    cheek.position.set(x, 1.0, 0.31);
    cheek.scale.set(1.25, 0.62, 0.28);
    root.add(cheek);
  }

  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.007, 5, 18, Math.PI), material(palette.navy, 0.82));
  smile.position.set(0, 0.995, 0.322);
  smile.rotation.set(0, 0, Math.PI);
  smile.scale.y = 0.58;
  root.add(smile);

  for (const [x, rotation] of [[-0.26, 0.28], [0.26, -0.28]] as const) {
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.12, 5, 10), material(palette.cream, 0.78));
    sleeve.position.set(x, 0.73, 0.08);
    sleeve.rotation.z = rotation;
    sleeve.castShadow = true;
    root.add(sleeve);
  }

  const leftArm = limb(-0.31, 0.58, palette.skin, 0.24);
  leftArm.position.z = 0.09;
  leftArm.rotation.z = 0.18;
  const rightArm = limb(0.31, 0.58, palette.skin, 0.24);
  rightArm.position.z = 0.09;
  rightArm.rotation.z = -0.18;
  const leftLeg = limb(-0.1, 0.26, palette.navy, 0.3);
  leftLeg.rotation.z = 0.08;
  const rightLeg = limb(0.1, 0.26, palette.navy, 0.3);
  rightLeg.rotation.z = -0.08;
  root.add(leftArm, rightArm, leftLeg, rightLeg);

  for (const x of [-0.13, 0.13]) {
    const boot = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.06, 5, 8), material(palette.boot, 0.82));
    boot.position.set(x, 0.08, 0.035);
    boot.rotation.x = Math.PI / 2;
    boot.scale.set(1.35, 0.8, 0.8);
    root.add(boot);
  }

  for (const x of [-0.33, 0.33]) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), material(palette.glove, 0.82));
    hand.position.set(x, 0.43, 0.1);
    hand.castShadow = true;
    root.add(hand);
  }

  const picker = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.58, 6), material(palette.wood, 0.82));
  picker.position.set(0.42, 0.44, 0.12);
  picker.rotation.z = -0.28;
  picker.rotation.x = 0.25;
  root.add(picker);

  const pickerTip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.08, 6), material(palette.can, 0.45, 0.2));
  pickerTip.position.set(0.5, 0.2, 0.17);
  pickerTip.rotation.z = -0.28;
  root.add(pickerTip);

  root.scale.setScalar(1.05);
  return { root, leftArm, rightArm, leftLeg, rightLeg, idleYaw };
}

function limb(x: number, y: number, color: number, height: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, height, 5, 10), material(color, 0.8));
  mesh.position.set(x, y, 0);
  mesh.castShadow = true;
  return mesh;
}

function animatePickup(helper: HelperModel, target: THREE.Vector3, bag: THREE.Group, elapsed: number, worldYaw: number): void {
  const start = helperHome.clone();
  const pickup = new THREE.Vector3(target.x - 0.16, 0.35, target.z + 0.12);
  const end = start;
  const t = Math.min(elapsed / 2.6, 1);
  const travelOut = smoothstep(Math.min(t / 0.32, 1));
  const reachIn = smoothstep(Math.max(0, Math.min((t - 0.28) / 0.16, 1)));
  const reachOut = smoothstep(Math.max(0, Math.min((t - 0.58) / 0.14, 1)));
  const bend = reachIn * (1 - reachOut);
  const lift = smoothstep(Math.max(0, Math.min((t - 0.44) / 0.22, 1)));
  const travelBack = smoothstep(Math.max(0, Math.min((t - 0.68) / 0.32, 1)));

  const position = t < 0.62
    ? start.clone().lerp(pickup, travelOut)
    : pickup.clone().lerp(end, travelBack);
  helper.root.position.set(position.x, position.y + Math.sin(t * Math.PI * 5) * 0.025, position.z);
  helper.root.rotation.y = t < 0.66
    ? yawToward(helper.root.position, target)
    : THREE.MathUtils.lerp(yawToward(helper.root.position, target), helper.idleYaw - worldYaw, travelBack);
  helper.root.rotation.x = bend * 0.28;
  helper.leftArm.rotation.x = -bend * 1.25;
  helper.rightArm.rotation.x = -bend * 1.55;
  helper.leftArm.rotation.z = 0.18 + bend * 0.32;
  helper.rightArm.rotation.z = -0.18 - bend * 0.52;
  const walking = t < 0.35 || (t > 0.68 && t < 0.96);
  helper.leftLeg.rotation.x = walking ? Math.sin(t * Math.PI * 14) * 0.32 : 0;
  helper.rightLeg.rotation.x = walking ? Math.sin(t * Math.PI * 14 + Math.PI) * 0.32 : 0;

  const baseScale = bag.userData.baseScale as number;
  if (lift > 0) {
    bag.position.set(
      THREE.MathUtils.lerp(target.x, helper.root.position.x + 0.18, lift),
      target.y + lift * 0.55,
      THREE.MathUtils.lerp(target.z, helper.root.position.z + 0.1, lift)
    );
    const shrink = baseScale * (1 - lift * 0.78);
    bag.scale.setScalar(Math.max(0.08, shrink));
    bag.rotation.y += 0.12;
    setGroupOpacity(bag, 1 - lift);
  }

  if (t >= 1) {
    bag.visible = false;
    resetHelperPose(helper, worldYaw);
  }
}

function resetHelperPose(helper: HelperModel, worldYaw = 0): void {
  helper.root.position.copy(helperHome);
  helper.root.rotation.set(0, helper.idleYaw - worldYaw, 0);
  helper.leftArm.rotation.x = 0;
  helper.rightArm.rotation.x = 0;
  helper.leftArm.rotation.z = 0.18;
  helper.rightArm.rotation.z = -0.18;
  helper.leftLeg.rotation.x = 0;
  helper.rightLeg.rotation.x = 0;
}

function faceCamera(helper: HelperModel, worldYaw: number): void {
  helper.root.rotation.y = helper.idleYaw - worldYaw;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function yawToward(from: THREE.Vector3, to: THREE.Vector3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

function setGroupOpacity(group: THREE.Group, opacity: number): void {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((item) => {
      item.transparent = true;
      item.opacity = Math.max(0, opacity);
    });
  });
}

function material(color: number, roughness: number, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((item) => item.dispose());
  });
}
