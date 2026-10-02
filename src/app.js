// The creator page: pick artwork, see it spin, download a two-colour 3MF.
import Module from 'manifold-3d';
import { zipSync } from 'fflate';
import { makeBody, makeGyro, fitCore, arcLayout, satellites, clusterGlyphs, check, FITS } from './gyro.js';
import { parseFont, textGlyphs } from './text.js';
import { fileToCrossSection, svgToCrossSection } from './art.js';
import { stl, threeMf } from './export.js';
import { createPreview } from './preview.js';

const $ = (s) => document.querySelector(s);
const status = $('#status');
const say = (msg, kind = '') => { status.textContent = msg; status.dataset.kind = kind; };

say('Loading the geometry engine…');
const wasm = await Module();
wasm.setup();
const { Manifold } = wasm;

const loadFont = async (u) => parseFont(await (await fetch(u)).arrayBuffer());
const fonts = { sans: await loadFont('fonts/Manrope-ExtraBold.ttf'), mono: await loadFont('fonts/JetBrainsMono-ExtraBold.ttf') };
const loadSvg = async (u) => svgToCrossSection(wasm, await (await fetch(u)).text());

const PRESETS = {
  orbital: {
    core: 'examples/orbital/cross.svg', coreName: 'Orbital cross',
    ringMode: 'art', ringArt: 'examples/orbital/wordmark.svg', ringArtName: 'Orbital wordmark',
    ringText: 'ORBITAL', bottom: 'ORBITALHQ.COM', body: '#1d1d1f', art: '#e7551e', name: 'orbital',
  },
  startup: {
    core: 'examples/startup/logo.svg', coreName: 'placeholder bolt',
    ringMode: 'text', ringText: 'YOUR STARTUP', bottom: 'YOURSTARTUP.COM', body: '#14213d', art: '#f5f5f0', name: 'my-startup',
  },
};

const state = {
  coreCs: null, coreName: '', coreFile: null,
  ringMode: 'text', ringArtCs: null, ringArtName: '', ringArtFile: null,
  ringText: '', ringFont: 'sans', bottom: '',
  thicken: 0, invert: false, fit: 'standard',
  body: '#1d1d1f', art: '#e7551e', name: 'merch-gyro',
};

const preview = createPreview($('#preview'));
const bodies = {};
const bodyFor = (fit) => (bodies[fit] ??= makeBody(wasm, { gap: FITS[fit] }));
let current = null;
let checkTimer = 0;

function slug(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'merch-gyro';
}

function build() {
  if (!state.coreCs) return;
  const gap = FITS[state.fit];
  const notes = [];
  const coreArt = fitCore(wasm, state.coreCs, state.thicken);

  let top = null;
  if (state.ringMode === 'art' && state.ringArtCs) {
    const c = clusterGlyphs(wasm, state.ringArtCs);
    top = arcLayout(wasm, c.glyphs, { height: c.height, gap, top: true, targetH: 7.0, maxSpanDeg: 160 });
  } else if (state.ringText.trim()) {
    const t = textGlyphs(wasm, fonts[state.ringFont], state.ringText.trim());
    if (t.glyphs.length) top = arcLayout(wasm, t.glyphs, { height: t.height, gap, top: true, targetH: 4.6, maxSpanDeg: 150 });
    if (top && top.letterH < 2.6) notes.push(`Ring text is long, so capitals come out ${top.letterH.toFixed(1)} mm tall. Shorter prints crisper.`);
  }
  let bottom = null;
  if (state.bottom.trim()) {
    const b = textGlyphs(wasm, fonts.mono, state.bottom.trim());
    if (b.glyphs.length) bottom = arcLayout(wasm, b.glyphs, { height: b.height, gap, top: false, targetH: 2.7, maxSpanDeg: 120 });
    if (bottom && bottom.letterH < 2.0) notes.push(`Bottom line is long: letters are ${bottom.letterH.toFixed(1)} mm. Under 2 mm prints soft.`);
  }

  let ring = satellites(wasm, gap);
  if (top) ring = ring.add(top.cs);
  if (bottom) ring = ring.add(bottom.cs);

  const g = makeGyro(wasm, { gap, body: bodyFor(state.fit), coreArt, ringArt: ring });
  if (current) { current.g.coreArt?.delete(); current.g.ringArt?.delete(); }
  current = { g, notes };
  preview.setParts(g);
  preview.setColours(state.body, state.art);
  $('#notes').innerHTML = notes.map((n) => `<li>${n}</li>`).join('');

  say('Checking it prints in place…', 'busy');
  clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    const r = check(g, { angles: 12 });
    if (r.ok) say('Prints in place: 4 free parts, every ring spins clear, nothing falls out.', 'ok');
    else say(`Problem: ${r.pieces} pieces; ${r.pairs.filter((p) => !p.ok).map((p) => p.name).join(', ')} failed. Try a looser fit.`, 'bad');
  }, 700);
}

let buildTimer = 0;
const rebuild = (delay = 250) => { clearTimeout(buildTimer); buildTimer = setTimeout(() => { try { build(); } catch (e) { say(e.message, 'bad'); } }, delay); };

function syncInputs() {
  $('#ringText').value = state.ringText;
  $('#bottom').value = state.bottom;
  $('#bodyColour').value = state.body;
  $('#artColour').value = state.art;
  $('#coreName').textContent = state.coreName;
  $('#ringArtName').textContent = state.ringArtName || 'none yet';
  $('#thicken').value = state.thicken;
  for (const r of document.querySelectorAll('input[name=ringMode]')) r.checked = r.value === state.ringMode;
  for (const r of document.querySelectorAll('input[name=fit]')) r.checked = r.value === state.fit;
  $('#ringFont').value = state.ringFont;
  document.body.dataset.ringMode = state.ringMode;
}

async function usePreset(key) {
  const p = PRESETS[key];
  say('Loading example…', 'busy');
  state.coreCs = await loadSvg(p.core);
  state.coreName = p.coreName; state.coreFile = null;
  state.ringArtCs = p.ringArt ? await loadSvg(p.ringArt) : null;
  state.ringArtName = p.ringArtName || ''; state.ringArtFile = null;
  Object.assign(state, { ringMode: p.ringMode, ringText: p.ringText, bottom: p.bottom, body: p.body, art: p.art, name: p.name, thicken: 0 });
  for (const b of document.querySelectorAll('[data-preset]')) b.setAttribute('aria-pressed', b.dataset.preset === key);
  syncInputs();
  rebuild(0);
}

async function takeFile(file, which) {
  try {
    say(`Reading ${file.name}…`, 'busy');
    const cs = await fileToCrossSection(wasm, file, { invert: state.invert });
    if (which === 'core') { state.coreCs = cs; state.coreName = file.name; state.coreFile = file; }
    else { state.ringArtCs = cs; state.ringArtName = file.name; state.ringArtFile = file; state.ringMode = 'art'; }
    if (which === 'core' && state.name === PRESETS.orbital.name) state.name = slug(file.name.replace(/\.[^.]+$/, ''));
    syncInputs();
    rebuild(0);
  } catch (e) {
    say(e.message, 'bad');
  }
}

function dropZone(el, which) {
  const input = el.querySelector('input[type=file]');
  input.addEventListener('change', () => input.files[0] && takeFile(input.files[0], which));
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault(); el.classList.remove('over');
    if (e.dataTransfer.files[0]) takeFile(e.dataTransfer.files[0], which);
  });
}

function save(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function parts() {
  const g = current.g;
  return { body: Manifold.compose([g.ring0, g.ring1, g.ring2, g.core]), art: Manifold.compose([g.ringArt, g.coreArt]) };
}

function fileBase() {
  return `${slug(state.ringMode === 'text' && state.ringText ? state.ringText : state.name)}-gyro`;
}

// ---- wiring -----------------------------------------------------------------

for (const b of document.querySelectorAll('[data-preset]')) b.addEventListener('click', () => usePreset(b.dataset.preset));
dropZone($('#coreDrop'), 'core');
dropZone($('#ringDrop'), 'ring');
$('#ringText').addEventListener('input', (e) => { state.ringText = e.target.value; rebuild(); });
$('#bottom').addEventListener('input', (e) => { state.bottom = e.target.value; rebuild(); });
$('#ringFont').addEventListener('change', (e) => { state.ringFont = e.target.value; rebuild(0); });
$('#thicken').addEventListener('input', (e) => { state.thicken = +e.target.value; rebuild(); });
$('#invert').addEventListener('change', async (e) => {
  state.invert = e.target.checked;
  if (state.coreFile && !/svg/i.test(state.coreFile.type + state.coreFile.name)) await takeFile(state.coreFile, 'core');
});
for (const r of document.querySelectorAll('input[name=ringMode]')) {
  r.addEventListener('change', () => { state.ringMode = r.value; document.body.dataset.ringMode = r.value; rebuild(0); });
}
for (const r of document.querySelectorAll('input[name=fit]')) r.addEventListener('change', () => { state.fit = r.value; rebuild(0); });
$('#bodyColour').addEventListener('input', (e) => { state.body = e.target.value; preview.setColours(state.body, state.art); });
$('#artColour').addEventListener('input', (e) => { state.art = e.target.value; preview.setColours(state.body, state.art); });
$('#spin').addEventListener('change', (e) => preview.setSpin(e.target.checked));
$('#top').addEventListener('click', () => { $('#spin').checked = false; preview.topView(); });

$('#dl3mf').addEventListener('click', () => {
  if (!current) return;
  const { body, art } = parts();
  save(threeMf(body, art, { name: fileBase(), colours: [state.body, state.art] }), `${fileBase()}.3mf`, 'model/3mf');
  body.delete(); art.delete();
});
$('#dlstl').addEventListener('click', () => {
  if (!current) return;
  const { body, art } = parts();
  const single = body.add(art);
  const base = fileBase();
  save(zipSync({
    [`${base}-body.stl`]: stl(body, `${base} body`),
    [`${base}-logo.stl`]: stl(art, `${base} logo`),
    [`${base}-one-colour.stl`]: stl(single, `${base} single`),
  }), `${base}-stl.zip`, 'application/zip');
  body.delete(); art.delete(); single.delete();
});

window.merchGyro = { state, get current() { return current; }, check: () => current && check(current.g) };

await usePreset(new URLSearchParams(location.search).get('start') === 'blank' ? 'startup' : 'orbital');
