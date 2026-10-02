// merch-gyro geometry: a print-in-place gimbal of nested rings on 45-degree cone pins.
//
// Runs in the browser and in Node. Pass in an initialised manifold-3d module;
// everything else is plain numbers. All sizes are millimetres. The part
// prints flat, z in [0, H], with the artwork raised RAISE mm on the top face
// so it can be a second colour (AMS part, or a filament change at z = H).

export const P = {
  H: 8.0,           // band height
  WALL: 2.8,        // ring wall
  R_CORE: 10.0,     // core sphere radius
  R_OUTER: 28.0,    // outside of the outer ring (56 mm across)
  PIN_BASE: 2.8,    // cone pin base radius
  PIN_EMBED: 0.8,   // how far the pin base sits inside its own ring
  PIN_CLEAR: 0.35,  // perpendicular pin/socket clearance
  RAISE: 0.6,       // artwork height (3 layers at 0.2 mm)
  EDGE: 0.6,        // chamfer on the outer ring's outside edges
  SEG: 160,         // circular segments
};

export const FITS = { snug: 0.4, standard: 0.5, loose: 0.6 };

const CZ = P.H / 2; // sphere centre height

export function radii(gap) {
  const r2 = [P.R_CORE + gap, P.R_CORE + gap + P.WALL];
  const r1 = [r2[1] + gap, r2[1] + gap + P.WALL];
  const r0in = r1[1] + gap;
  return { r2, r1, r0in };
}

/** Largest radius the core artwork may reach and still clear ring 2 when it turns. */
export function coreArtRadius() {
  return Math.sqrt(P.R_CORE ** 2 - (CZ + P.RAISE) ** 2) - 0.3;
}

/** Centre radius of the outer ring's top face, where the ring artwork sits. */
export function ringBand(gap) {
  const { r0in } = radii(gap);
  const inner = Math.sqrt(r0in ** 2 - CZ ** 2);
  const outer = P.R_OUTER - P.EDGE;
  return { inner, outer, mid: (inner + outer) / 2, width: outer - inner };
}

/**
 * The four moving parts: outer ring, ring 1, ring 2 and the core. They depend
 * only on the fit, so callers that rebuild often (the web page) cache them.
 */
export function makeBody(wasm, { gap = FITS.standard, seg = P.SEG } = {}) {
  const { Manifold, CrossSection } = wasm;
  const { r2, r1, r0in } = radii(gap);
  const span = 2 * P.R_OUTER + 10;

  const slab = () => Manifold.cube([span, span, P.H], true).translate([0, 0, CZ]);
  const sphere = (r) => Manifold.sphere(r, seg).translate([0, 0, CZ]);
  const band = (rin, rout) => sphere(rout).subtract(sphere(rin)).intersect(slab());

  const ROT = { 'x+': [0, 90, 0], 'x-': [0, -90, 0], 'y+': [-90, 0, 0], 'y-': [90, 0, 0] };
  const cone = (axis, sign, start) => {
    const c = Manifold.cylinder(P.PIN_BASE, P.PIN_BASE, 0, 64).rotate(ROT[axis + (sign > 0 ? '+' : '-')]);
    return c.translate(axis === 'x' ? [sign * start, 0, CZ] : [0, sign * start, CZ]);
  };
  const pins = (axis, rOut) => {
    const s = rOut - P.PIN_EMBED;
    return cone(axis, 1, s).add(cone(axis, -1, s));
  };
  const sockets = (axis, rOut) => {
    // the same cone pushed outward, so every face clears the pin by PIN_CLEAR
    const s = rOut - P.PIN_EMBED + P.PIN_CLEAR * Math.SQRT2;
    return cone(axis, 1, s).add(cone(axis, -1, s));
  };

  const outer = () => {
    const e = P.EDGE, R = P.R_OUTER, H = P.H;
    const profile = new CrossSection([[[0, 0], [R - e, 0], [R, e], [R, H - e], [R - e, H], [0, H]]]);
    return profile.revolve(seg).subtract(sphere(r0in));
  };

  const core = sphere(P.R_CORE).intersect(slab()).add(pins('x', P.R_CORE));
  const ring2 = band(...r2).add(pins('y', r2[1])).subtract(sockets('x', P.R_CORE));
  const ring1 = band(...r1).add(pins('x', r1[1])).subtract(sockets('y', r2[1]));
  const ring0 = outer().subtract(sockets('x', r1[1]));
  return { ring0, ring1, ring2, core, gap };
}

/** Body plus artwork raised on the top faces. Pass `body` to reuse a cached one. */
export function makeGyro(wasm, opts = {}) {
  const gap = opts.gap ?? FITS.standard;
  const body = opts.body ?? makeBody(wasm, { gap, seg: opts.seg });
  const lift = (cs) => cs.extrude(P.RAISE).translate([0, 0, P.H]);
  return {
    ...body,
    coreArt: opts.coreArt ? lift(opts.coreArt) : null,
    ringArt: opts.ringArt ? lift(opts.ringArt) : null,
  };
}

/** Rotate a part about the X or Y axis through the sphere centre. */
export function turn(m, axis, deg) {
  const v = axis === 'x' ? [deg, 0, 0] : [0, deg, 0];
  return m.translate([0, 0, -CZ]).rotate(v).translate([0, 0, CZ]);
}

// ---- artwork layout ---------------------------------------------------------

/**
 * Fit artwork (a CrossSection, y up) into the core's top face: centred on its
 * bounding box and scaled so no point is further than the safe radius.
 */
export function fitCore(wasm, cs, thicken = 0) {
  const b = cs.bounds();
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
  let centred = cs.translate([-cx, -cy]);
  let far = 0;
  for (const poly of centred.toPolygons()) for (const [x, y] of poly) far = Math.max(far, Math.hypot(x, y));
  const target = coreArtRadius() - Math.max(0, thicken);
  let out = centred.scale(target / far);
  if (thicken > 0) out = out.offset(thicken, 'Round', 2, 24);
  return out;
}

/**
 * Lay glyphs round an arc of the outer ring. `glyphs` are
 * {cs, x0, x1} in any unit with the baseline at y = 0 and `height` the
 * tallest letter; they come back as one CrossSection in millimetres.
 * top: reads clockwise across the top, letters pointing out.
 * bottom: reads anticlockwise across the bottom, letters pointing in.
 */
export function arcLayout(wasm, glyphs, { height, gap, top = true, targetH, maxSpanDeg }) {
  const { CrossSection } = wasm;
  if (!glyphs.length) return null;
  const bandInfo = ringBand(gap);
  const x0 = glyphs[0].x0, x1 = glyphs[glyphs.length - 1].x1, W = x1 - x0;
  const sgn = top ? -1 : 1; // baseline sits inside the band centre on top, outside it underneath
  let s = Math.min(targetH, bandInfo.width - 2.2) / height;
  const rbOf = (sc) => bandInfo.mid + sgn * height * sc / 2;
  const spanDeg = () => (W * s / rbOf(s)) * 180 / Math.PI;
  if (spanDeg() > maxSpanDeg) {
    // too long: shrink the letters so the arc is exactly maxSpanDeg.
    // span = W s / (mid + sgn H s / 2), solved for s.
    const th = maxSpanDeg * Math.PI / 180;
    s = th * bandInfo.mid / (W - sgn * th * height / 2);
  }
  const h = height * s, rb = rbOf(s);
  const xm = (x0 + x1) / 2;
  const parts = [];
  for (const g of glyphs) {
    const xc = (g.x0 + g.x1) / 2;
    const local = g.cs.translate([-xc, 0]).scale([s, s]);
    const d = ((xc - xm) * s / rb) * 180 / Math.PI;
    const th = top ? 90 - d : 270 + d;
    const t = th * Math.PI / 180;
    parts.push(local.rotate(top ? th - 90 : th + 90).translate([rb * Math.cos(t), rb * Math.sin(t)]));
  }
  return { cs: CrossSection.union(parts), spanDeg: spanDeg(), letterH: h };
}

/** Two small dots on the pin axis, like satellites. */
export function satellites(wasm, gap) {
  const { CrossSection } = wasm;
  const r = ringBand(gap).mid;
  const dot = CrossSection.circle(1.3, 48);
  return dot.translate([r, 0]).add(dot.translate([-r, 0]));
}

/**
 * Split artwork into letters for arc layout: connected pieces whose x-ranges
 * overlap stay together (the dot of an i rides with its stem).
 */
export function clusterGlyphs(wasm, cs) {
  const { CrossSection } = wasm;
  const pieces = cs.decompose().map((p) => ({ p, b: p.bounds() })).sort((a, b) => a.b.min[0] - b.b.min[0]);
  const bb = cs.bounds();
  const tol = (bb.max[1] - bb.min[1]) * 0.02;
  const groups = [];
  for (const { p, b } of pieces) {
    const g = groups[groups.length - 1];
    if (g && b.min[0] < g.x1 - tol) {
      g.list.push(p); g.x1 = Math.max(g.x1, b.max[0]);
    } else {
      groups.push({ list: [p], x0: b.min[0], x1: b.max[0] });
    }
  }
  const baseline = bb.min[1];
  return {
    glyphs: groups.map((g) => ({ cs: CrossSection.union(g.list).translate([0, -baseline]), x0: g.x0, x1: g.x1 })),
    height: bb.max[1] - bb.min[1],
  };
}

// ---- checks -----------------------------------------------------------------

/**
 * The print-in-place guarantees, as numbers: every ring clears its neighbour
 * at any angle, a 0.2 mm nudge in any direction is still free, and a 1.5 mm
 * push hits something (nothing can fall out).
 */
export function check(g, { angles = 24, full = true } = {}) {
  const temps = [];
  const keep = (m) => { temps.push(m); return m; };
  const overlap = (host, moved) => {
    const i = host.intersect(moved);
    const v = i.volume();
    i.delete(); moved.delete();
    return v;
  };
  try {
    const coreAll = g.coreArt ? keep(g.core.add(g.coreArt)) : g.core;
    const sub2 = keep(g.ring2.add(coreAll));
    const sub1 = keep(g.ring1.add(sub2));
    const fixed = g.ringArt ? keep(g.ring0.add(g.ringArt)) : g.ring0;
    const pairs = [
      ['core in ring 2', g.ring2, coreAll, 'x'],
      ['ring 2 in ring 1', g.ring1, sub2, 'y'],
      ['ring 1 in outer ring', fixed, sub1, 'x'],
    ];
    const res = [];
    const step = 360 / angles;
    for (const [name, host, mover, axis] of (full ? pairs : pairs.slice(0, 1))) {
      let worst = 0;
      for (let a = 0; a < 360; a += step) worst = Math.max(worst, overlap(host, turn(mover, axis, a)));
      let nudge = 0, push = Infinity;
      if (full) {
        for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          nudge = Math.max(nudge, overlap(host, mover.translate(d.map((c) => c * 0.2))));
          push = Math.min(push, overlap(host, mover.translate(d.map((c) => c * 1.5))));
        }
      }
      res.push({ name, overlap: worst, nudge, push, ok: worst < 1e-3 && (!full || (nudge < 1e-3 && push > 1e-3)) });
    }
    const body = keep(g.ring0.add(g.ring1).add(g.ring2).add(g.core));
    const parts = body.decompose();
    const pieces = parts.length;
    parts.forEach((p) => p.delete());
    return { pieces, pairs: res, ok: pieces === 4 && res.every((r) => r.ok) };
  } finally {
    temps.forEach((m) => m.delete());
  }
}
