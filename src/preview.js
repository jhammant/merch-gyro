// three.js preview with the real gimbal: each ring turns on its own pin axis.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { P } from './gyro.js';

const CZ = P.H / 2;

function geometryOf(manifold) {
  const m = manifold.getMesh();
  const n = m.numProp, v = m.vertProperties;
  const pos = new Float32Array((v.length / n) * 3);
  for (let i = 0, j = 0; i < v.length; i += n, j += 3) { pos[j] = v[i]; pos[j + 1] = v[i + 1]; pos[j + 2] = v[i + 2] - CZ; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(m.triVerts, 1));
  return toCreasedNormals(g, Math.PI / 6);
}

export function createPreview(el) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 1000);
  camera.up.set(0, 0, 1);
  camera.position.set(0, -95, 80);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 60;
  controls.maxDistance = 260;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-40, -60, 90);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.9);
  rim.position.set(60, 50, 30);
  scene.add(rim);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.55, metalness: 0.0 });
  const artMat = new THREE.MeshStandardMaterial({ color: 0xe7551e, roughness: 0.5, metalness: 0.0 });

  const root = new THREE.Group();
  scene.add(root);
  const pivot1 = new THREE.Group(), pivot2 = new THREE.Group(), pivot3 = new THREE.Group();
  let meshes = [];

  let spinning = true, a1 = 0, a2 = 0, a3 = 0;

  function clear() {
    for (const m of meshes) { m.parent.remove(m); m.geometry.dispose(); }
    meshes = [];
    root.clear(); pivot1.clear(); pivot2.clear(); pivot3.clear();
  }

  function add(parent, manifold, mat) {
    if (!manifold) return;
    const mesh = new THREE.Mesh(geometryOf(manifold), mat);
    parent.add(mesh);
    meshes.push(mesh);
  }

  function setParts(g) {
    clear();
    add(root, g.ring0, bodyMat);
    add(root, g.ringArt, artMat);
    root.add(pivot1);
    add(pivot1, g.ring1, bodyMat);
    pivot1.add(pivot2);
    add(pivot2, g.ring2, bodyMat);
    pivot2.add(pivot3);
    add(pivot3, g.core, bodyMat);
    add(pivot3, g.coreArt, artMat);
  }

  function setColours(body, art) {
    bodyMat.color.set(body);
    artMat.color.set(art);
  }

  function resize() {
    const w = el.clientWidth, h = el.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(el);
  resize();

  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (spinning) { a1 += dt * 0.9; a2 += dt * 1.3; a3 += dt * 2.1; }
    pivot1.rotation.set(Math.sin(a1) * 1.2, 0, 0);
    pivot2.rotation.set(0, a2, 0);
    pivot3.rotation.set(a3, 0, 0);
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    setParts,
    setColours,
    setSpin(on) { spinning = on; if (!on) { a1 = a2 = a3 = 0; } },
    topView() {
      spinning = false; a1 = a2 = a3 = 0;
      camera.position.set(0, -0.01, 120);
      controls.update();
    },
    snapshot() { return renderer.domElement.toDataURL('image/png'); },
  };
}
