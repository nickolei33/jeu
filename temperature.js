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
  function ambientTempAt(_x, _y) {
    return 21;
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
