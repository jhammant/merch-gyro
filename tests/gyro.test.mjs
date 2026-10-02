// node tests/gyro.test.mjs [--write]
// Builds a gyro with text on the ring and a cross in the core, then proves the
// print-in-place guarantees. --write also saves the 3MF and STLs to tests/out/.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import Module from 'manifold-3d';
import { makeGyro, fitCore, arcLayout, satellites, check, coreArtRadius, FITS } from '../src/gyro.js';
import { parseFont, textGlyphs } from '../src/text.js';
import { stl, threeMf } from '../src/export.js';

const wasm = await Module();
wasm.setup();
const { CrossSection, Manifold } = wasm;

function cross(box) {
  // a rounded plus, the same construction as the Orbital mark
  const k = box / 500, w = 82 * k, ro = 25 * k, ri = 70 * k;
  const plus = CrossSection.square([box, w], true).add(CrossSection.square([w, box], true));
  return plus.offset(ri, 'Round', 2, 96).offset(-ri, 'Round', 2, 96).offset(-ro, 'Round', 2, 48).offset(ro, 'Round', 2, 48);
}

const font = parseFont(readFileSync(new URL('../fonts/JetBrainsMono-ExtraBold.ttf', import.meta.url)).buffer);
let failed = 0;
const assert = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failed++; };

for (const [fitName, gap] of Object.entries(FITS)) {
  const top = textGlyphs(wasm, font, 'MERCH GYRO');
  const topArt = arcLayout(wasm, top.glyphs, { height: top.height, gap, top: true, targetH: 4.2, maxSpanDeg: 150 });
  const bot = textGlyphs(wasm, font, 'GITHUB.COM/JHAMMANT/MERCH-GYRO');
  const botArt = arcLayout(wasm, bot.glyphs, { height: bot.height, gap, top: false, targetH: 2.7, maxSpanDeg: 120 });
  const ringArt = topArt.cs.add(botArt.cs).add(satellites(wasm, gap));
  const coreArt = fitCore(wasm, cross(500), 0);

  let far = 0;
  for (const p of coreArt.toPolygons()) for (const [x, y] of p) far = Math.max(far, Math.hypot(x, y));

  const g = makeGyro(wasm, { gap, coreArt, ringArt });
  const r = check(g);
  console.log(`\nfit ${fitName} (gap ${gap} mm)`);
  assert(r.pieces === 4, `body is 4 separate pieces (got ${r.pieces})`);
  for (const p of r.pairs) {
    assert(p.ok, `${p.name}: overlap ${p.overlap.toFixed(4)} over 24 angles, 0.2 mm nudge ${p.nudge.toFixed(4)}, 1.5 mm push ${p.push.toFixed(2)} mm3`);
  }
  assert(far <= coreArtRadius() + 1e-6, `core art within ${coreArtRadius().toFixed(2)} mm (reaches ${far.toFixed(2)})`);
  assert(botArt.spanDeg <= 120.01, `long bottom text shrinks to fit the arc (${botArt.spanDeg.toFixed(0)} deg, letters ${botArt.letterH.toFixed(2)} mm)`);

  if (process.argv.includes('--write') && fitName === 'standard') {
    const out = new URL('./out/', import.meta.url);
    mkdirSync(out, { recursive: true });
    const body = Manifold.compose([g.ring0, g.ring1, g.ring2, g.core]);
    const art = Manifold.compose([g.ringArt, g.coreArt]);
    writeFileSync(new URL('test-gyro.3mf', out), threeMf(body, art, { name: 'test-gyro' }));
    writeFileSync(new URL('test-gyro-body.stl', out), stl(body));
    writeFileSync(new URL('test-gyro-logo.stl', out), stl(art));
    console.log('wrote tests/out/test-gyro.3mf and STLs');
  }
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
