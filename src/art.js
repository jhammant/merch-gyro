// Logo files to 2D outlines (browser only: uses the DOM to read SVG and canvas to read PNG).
// Output is a manifold CrossSection with y pointing up; units are arbitrary
// (the gyro rescales everything to fit).
import 'https://cdn.jsdelivr.net/npm/path-data-polyfill@1.0.10/path-data-polyfill.js';

const SHAPES = 'path,rect,circle,ellipse,polygon,polyline';

function luminance(color) {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return 0;
  const [r, g, b] = m[1].split(',').map((v) => parseFloat(v) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function opacity(color) {
  const m = color.match(/rgba\(([^)]+)\)/);
  return m ? parseFloat(m[1].split(',')[3]) : 1;
}

/** Normalised path data (absolute M/L/C/Z) to polygons in the SVG's root coordinates. */
function elementPolygons(el, steps = 12) {
  const ctm = el.getCTM();
  const tx = (x, y) => (ctm ? [ctm.a * x + ctm.c * y + ctm.e, ctm.b * x + ctm.d * y + ctm.f] : [x, y]);
  const polys = [];
  let cur = [], x = 0, y = 0, sx = 0, sy = 0;
  const close = () => { if (cur.length >= 3) polys.push(cur); cur = []; };
  for (const seg of el.getPathData({ normalize: true })) {
    const v = seg.values;
    if (seg.type === 'M') { close(); x = sx = v[0]; y = sy = v[1]; cur.push(tx(x, y)); }
    else if (seg.type === 'L') { x = v[0]; y = v[1]; cur.push(tx(x, y)); }
    else if (seg.type === 'C') {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        cur.push(tx(
          u ** 3 * x + 3 * u * u * t * v[0] + 3 * u * t * t * v[2] + t ** 3 * v[4],
          u ** 3 * y + 3 * u * u * t * v[1] + 3 * u * t * t * v[3] + t ** 3 * v[5],
        ));
      }
      x = v[4]; y = v[5];
    } else if (seg.type === 'Z') { x = sx; y = sy; close(); }
  }
  close();
  return polys;
}

/**
 * Every filled shape, in document order. Dark fills add, light fills
 * (white knock-outs drawn over a dark shape) cut away. Strokes are ignored.
 */
export function svgToCrossSection(wasm, svgText) {
  const { CrossSection } = wasm;
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('That SVG file could not be read.');
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;left:-10000px;top:0;width:10px;height:10px;overflow:hidden';
  const svg = document.importNode(doc.documentElement, true);
  holder.appendChild(svg);
  document.body.appendChild(holder);
  try {
    let acc = null;
    for (const el of svg.querySelectorAll(SHAPES)) {
      if (el.closest('defs,clipPath,mask,symbol,pattern,marker')) continue;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || st.fill === 'none' || !st.fill) continue;
      if (parseFloat(st.opacity) === 0 || parseFloat(st.fillOpacity) === 0 || opacity(st.fill) === 0) continue;
      const polys = elementPolygons(el).map((p) => p.map(([px, py]) => [px, -py]));
      if (!polys.length) continue;
      const shape = new CrossSection(polys, st.fillRule === 'evenodd' ? 'EvenOdd' : 'NonZero');
      const light = luminance(st.fill) > 0.85;
      if (light) acc = acc ? acc.subtract(shape) : acc;
      else acc = acc ? acc.add(shape) : shape;
    }
    if (!acc || acc.isEmpty()) throw new Error('No filled shapes found in that SVG. Outlined text or strokes only? Convert strokes to fills first.');
    return acc;
  } finally {
    holder.remove();
  }
}

/**
 * Trace a raster logo. Transparent PNGs use the alpha channel; opaque images
 * use darkness. `invert` swaps what counts as ink.
 */
export async function imageToCrossSection(wasm, blob, { invert = false, maxPx = 320 } = {}) {
  const { CrossSection } = wasm;
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const cv = new OffscreenCanvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  let transparent = false;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 250) { transparent = true; break; }
  const ink = (i) => {
    const a = px[i + 3] / 255;
    const lum = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    const on = transparent ? a > 0.5 : lum < 0.5;
    return invert ? !on : on;
  };
  // one rectangle per horizontal run of ink, then a single union
  const rects = [];
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      while (x < w && !ink((y * w + x) * 4)) x++;
      const x0 = x;
      while (x < w && ink((y * w + x) * 4)) x++;
      if (x > x0) rects.push([[x0, -y], [x, -y], [x, -y - 1], [x0, -y - 1]]);
    }
  }
  if (!rects.length) throw new Error('No logo found in that image. Try ticking "invert".');
  return new CrossSection(rects, 'NonZero').offset(0.45, 'Round', 2, 16).offset(-0.45, 'Round', 2, 16).simplify(0.25);
}

/** Read whatever the user dropped in. */
export async function fileToCrossSection(wasm, file, opts) {
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) return svgToCrossSection(wasm, await file.text());
  if (/^image\//.test(file.type)) return imageToCrossSection(wasm, file, opts);
  throw new Error('Use an SVG (best) or a PNG/JPG.');
}
