'use strict';
(() => {
  const G = (window.G = window.G || {});

  // ------------------------------
  // RNG (xorshift32) + hashing helpers
  // ------------------------------
  const defaultSeed =
    (G.CONF.START_SEED | 0) || ((Date.now() ^ ((Math.random() * 1e9) | 0)) | 0);

  G.seed = defaultSeed | 0;
  G.rngState = G.seed | 0;

  G.setSeed = (s) => {
    G.seed = (s | 0) || 1;
    G.rngState = G.seed | 0;
  };

  G.rand01 = () => {
    // xorshift32
    let x = G.rngState | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    G.rngState = x | 0;
    return (x >>> 0) / 4294967296;
  };

  G.randi = (n) => ((G.rand01() * n) | 0);

  // Hash helpers (stable across platforms)
  function hash32(x) {
    x = (x | 0) ^ (x >>> 16);
    x = Math.imul(x, 2246822507);
    x = x ^ (x >>> 13);
    x = Math.imul(x, 3266489909);
    x = x ^ (x >>> 16);
    return x >>> 0;
  }

  G.hash2i = (x, y) => {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ (G.seed | 0);
    return hash32(h);
  };

  G.noise01 = (x, y) => G.hash2i(x, y) / 4294967296;

  // Value noise helpers (generation only)
  G.valueNoise1D = (x, scale) => {
    const fx = x / scale;
    const x0 = Math.floor(fx);
    const t = fx - x0;
    const v0 = G.noise01(x0, 0);
    const v1 = G.noise01(x0 + 1, 0);
    const u = G.smoothstep(t);
    return v0 * (1 - u) + v1 * u;
  };

  G.valueNoise2D = (x, y, scale) => {
    const fx = x / scale;
    const fy = y / scale;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const v00 = G.noise01(x0, y0);
    const v10 = G.noise01(x0 + 1, y0);
    const v01 = G.noise01(x0, y0 + 1);
    const v11 = G.noise01(x0 + 1, y0 + 1);
    const ux = G.smoothstep(tx);
    const uy = G.smoothstep(ty);
    const a = v00 * (1 - ux) + v10 * ux;
    const b = v01 * (1 - ux) + v11 * ux;
    return a * (1 - uy) + b * uy;
  };

  G.fbm2 = (x, y) => {
    let n = 0;
    let amp = 0.55;
    n += amp * G.valueNoise2D(x, y, 260);
    amp *= 0.5;
    n += amp * G.valueNoise2D(x + 1000, y + 2000, 120);
    amp *= 0.5;
    n += amp * G.valueNoise2D(x + 3333, y + 4444, 60);
    amp *= 0.5;
    n += amp * G.valueNoise2D(x + 7777, y + 8888, 24);

    const norm = 0.55 + 0.275 + 0.1375 + 0.06875;
    return n / norm;
  };
})();
