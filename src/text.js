// Text to letter outlines for the ring, via opentype.js. Browser and Node.
import * as opentypeNs from 'opentype.js';

const opentype = opentypeNs.default ?? opentypeNs;

export function parseFont(buffer) {
  return opentype.parse(buffer);
}

/** Flatten an opentype path's commands into closed polygons, y up. */
function pathPolygons(cmds, steps = 10) {
  const polys = [];
  let cur = [], x = 0, y = 0;
  const close = () => { if (cur.length >= 3) polys.push(cur); cur = []; };
  for (const c of cmds) {
    if (c.type === 'M') { close(); x = c.x; y = c.y; cur.push([x, -y]); }
    else if (c.type === 'L') { x = c.x; y = c.y; cur.push([x, -y]); }
    else if (c.type === 'Q') {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        cur.push([u * u * x + 2 * u * t * c.x1 + t * t * c.x, -(u * u * y + 2 * u * t * c.y1 + t * t * c.y)]);
      }
      x = c.x; y = c.y;
    } else if (c.type === 'C') {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        cur.push([
          u ** 3 * x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t ** 3 * c.x,
          -(u ** 3 * y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t ** 3 * c.y),
        ]);
      }
      x = c.x; y = c.y;
    } else if (c.type === 'Z') close();
  }
  close();
  return polys;
}

/**
 * One entry per visible character: {cs, x0, x1} in font units scaled to
 * `size`, baseline at y = 0. `height` is the cap height, so capitals fill the
 * band and lower case sits inside it.
 */
export function textGlyphs(wasm, font, text, { size = 100, tracking = 0.06 } = {}) {
  const { CrossSection } = wasm;
  const k = size / font.unitsPerEm;
  const capUnits = font.tables.os2?.sCapHeight || font.charToGlyph('H').getBoundingBox().y2;
  const glyphs = [];
  let pen = 0;
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    const adv = g.advanceWidth * k;
    const polys = pathPolygons(g.getPath(0, 0, size).commands);
    if (polys.length) {
      const cs = new CrossSection(polys, 'NonZero').translate([pen, 0]);
      const b = cs.bounds();
      if (b.max[0] > b.min[0]) glyphs.push({ cs, x0: pen, x1: pen + adv });
    }
    pen += adv + tracking * size;
  }
  return { glyphs, height: capUnits * k };
}
