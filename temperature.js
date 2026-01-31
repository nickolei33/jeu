'use strict';
(() => {
  const G = (window.G = window.G || {});
  const C = G.CONF;
  const { WORLD_W: W, WORLD_H: H } = C;
  const { MAT } = G;

  // =========================================================
  // Temperature simulation
  // =========================================================

  // Ambient temperature as a function of biome + depth.
  // Tuned for "readable" gameplay rather than strict physics.
  const BASE = {
    [G.BIOME.SNOW]: -10,
    [G.BIOME.MINES]: 12,
    [G.BIOME.DESERT]: 26,
    [G.BIOME.TOXIC]: 18,
  };

  function ambientTempAt(x, y) {
    const b = G.biomeAt(x, y);
    const depth01 = y / H;
    let t = (BASE[b] ?? 12);

    // Mild warming with depth, then a stronger "deep earth" curve.
    t += depth01 * 45;
    if (depth01 > 0.65) t += (depth01 - 0.65) * 120;

    // Surface air a bit cooler (more comfortable gameplay near spawn).
    if (y < 80) t -= 6;
    return t | 0;
  }
  G.ambientTempAt = ambientTempAt;

  function initTemperature() {
    const temp = G.temp;
    const mat = G.mat;
    const N = mat.length;

    for (let i = 0; i < N; i++) {
      const xy = G.xyFromIndex(i);
      let t = ambientTempAt(xy.x, xy.y);

      const m = mat[i];
      if (m === MAT.LAVA) t = 950;
      else if (m === MAT.FIRE) t = 520;
      else if (m === MAT.STEAM) t = 110;
      else if (m === MAT.ICE) t = -8;
      else if (m === MAT.PACKED_SNOW) t = -7;
      else if (m === MAT.SNOW) t = -5;

      temp[i] = t;
    }
  }
  G.initTemperature = initTemperature;

  // Utility: add heat (positive) or cold (negative) in a circle.
  function addTempCircle(cx, cy, r, delta) {
    const r2 = r * r;
    const x0 = Math.max(1, (cx - r) | 0);
    const x1 = Math.min(W - 2, (cx + r) | 0);
    const y0 = Math.max(1, (cy - r) | 0);
    const y1 = Math.min(H - 2, (cy + r) | 0);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        const i = G.idx(x, y);
        G.temp[i] = (G.temp[i] + delta) | 0;
      }
    }
  }
  G.addTempCircle = addTempCircle;
})();
