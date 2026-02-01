(() => {
  const G = (window.G = window.G || {});

  const MATTE_SETS = {
    snow: [
      {
        name: 'Alpine Dawn',
        sky: { top: [8, 14, 26], bot: [40, 70, 120] },
        haze: [120, 160, 210],
        layers: [
          { color: [70, 90, 130], points: [
            [0.00, 0.42], [0.20, 0.40], [0.40, 0.44], [0.62, 0.38], [0.82, 0.41], [1.00, 0.39],
          ] },
          { color: [52, 68, 102], points: [
            [0.00, 0.55], [0.18, 0.60], [0.36, 0.53], [0.58, 0.62], [0.78, 0.56], [1.00, 0.60],
          ] },
          { color: [32, 44, 70], points: [
            [0.00, 0.70], [0.22, 0.74], [0.45, 0.68], [0.68, 0.76], [0.90, 0.71], [1.00, 0.74],
          ] },
        ],
      },
    ],
    mines: [
      {
        name: 'Slate Valley',
        sky: { top: [12, 16, 22], bot: [52, 64, 84] },
        haze: [90, 110, 140],
        layers: [
          { color: [68, 76, 96], points: [
            [0.00, 0.48], [0.24, 0.52], [0.50, 0.46], [0.78, 0.50], [1.00, 0.47],
          ] },
          { color: [44, 52, 70], points: [
            [0.00, 0.62], [0.30, 0.67], [0.55, 0.60], [0.82, 0.66], [1.00, 0.63],
          ] },
          { color: [26, 32, 44], points: [
            [0.00, 0.76], [0.25, 0.78], [0.52, 0.72], [0.78, 0.80], [1.00, 0.75],
          ] },
        ],
      },
    ],
    desert: [
      {
        name: 'Amber Ridges',
        sky: { top: [20, 18, 24], bot: [120, 94, 70] },
        haze: [180, 140, 110],
        layers: [
          { color: [140, 108, 78], points: [
            [0.00, 0.46], [0.22, 0.42], [0.46, 0.48], [0.70, 0.44], [0.92, 0.50], [1.00, 0.46],
          ] },
          { color: [102, 76, 56], points: [
            [0.00, 0.60], [0.24, 0.66], [0.52, 0.58], [0.78, 0.64], [1.00, 0.60],
          ] },
          { color: [68, 50, 36], points: [
            [0.00, 0.74], [0.30, 0.78], [0.58, 0.70], [0.86, 0.80], [1.00, 0.74],
          ] },
        ],
      },
    ],
    toxic: [
      {
        name: 'Verdant Mist',
        sky: { top: [8, 14, 18], bot: [60, 90, 70] },
        haze: [120, 160, 140],
        layers: [
          { color: [70, 110, 90], points: [
            [0.00, 0.44], [0.22, 0.48], [0.48, 0.42], [0.74, 0.50], [1.00, 0.46],
          ] },
          { color: [46, 76, 60], points: [
            [0.00, 0.60], [0.28, 0.66], [0.52, 0.58], [0.82, 0.65], [1.00, 0.60],
          ] },
          { color: [30, 50, 40], points: [
            [0.00, 0.74], [0.22, 0.78], [0.50, 0.72], [0.78, 0.80], [1.00, 0.74],
          ] },
        ],
      },
    ],
  };

  function lerp(a, b, t) { return a + (b - a) * t; }

  function sampleCurve(points, t) {
    if (t <= points[0][0]) return points[0][1];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (t >= a[0] && t <= b[0]) {
        const u = (t - a[0]) / Math.max(1e-6, (b[0] - a[0]));
        return lerp(a[1], b[1], u);
      }
    }
    return points[points.length - 1][1];
  }

  function buildLayer(arr, color, points, skyH, skyW, seed) {
    const r0 = color[0], g0 = color[1], b0 = color[2];
    for (let x = 0; x < skyW; x++) {
      const t = x / (skyW - 1);
      const n = (G.valueNoise1D(x + seed * 13, 180) - 0.5) * 0.02;
      const y0 = (sampleCurve(points, t) + n) * skyH;
      const yy0 = Math.max(0, Math.min(skyH - 1, y0 | 0));
      for (let y = yy0; y < skyH; y++) {
        const idx = y * skyW + x;
        arr[idx] = G.packRGBA(r0, g0, b0, 255);
      }
    }
  }

  function buildGradient(base, top, bot, skyW, skyH) {
    for (let y = 0; y < skyH; y++) {
      const t = y / (skyH - 1);
      const r = lerp(top[0], bot[0], t) | 0;
      const g = lerp(top[1], bot[1], t) | 0;
      const b = lerp(top[2], bot[2], t) | 0;
      const row = y * skyW;
      for (let x = 0; x < skyW; x++) {
        base[row + x] = G.packRGBA(r, g, b, 255);
      }
    }
  }

  function buildHaze(mid, color, skyW, skyH) {
    const r = color[0], g = color[1], b = color[2];
    const y0 = (skyH * 0.55) | 0;
    const y1 = (skyH * 0.88) | 0;
    for (let y = y0; y <= y1; y++) {
      const t = (y - y0) / Math.max(1, (y1 - y0));
      const a = (0.10 + 0.22 * (1 - t));
      const row = y * skyW;
      for (let x = 0; x < skyW; x++) {
        mid[row + x] = G.packRGBA(r, g, b, (a * 255) | 0);
      }
    }
  }

  G.selectBackgroundSet = (biome) => {
    const B = G.BIOME || {};
    let key = 'mines';
    if (biome === B.SNOW) key = 'snow';
    else if (biome === B.DESERT) key = 'desert';
    else if (biome === B.TOXIC) key = 'toxic';
    const arr = MATTE_SETS[key] || MATTE_SETS.mines;
    if (!arr.length) return null;
    const idx = (G.seed | 0) % arr.length;
    return arr[(idx + arr.length) % arr.length];
  };

  G.buildMatteSky = (base, l0, l1, l2, l3, mid, set) => {
    const skyW = G.CONF.WORLD_W | 0;
    const skyH = Math.min(512, (G.CONF.WORLD_H | 0));
    const skyTop = set.sky.top;
    const skyBot = set.sky.bot;
    buildGradient(base, skyTop, skyBot, skyW, skyH);
    buildHaze(mid, set.haze, skyW, skyH);

    const layers = set.layers || [];
    if (layers[0]) buildLayer(l0, layers[0].color, layers[0].points, skyH, skyW, 1);
    if (layers[1]) buildLayer(l1, layers[1].color, layers[1].points, skyH, skyW, 2);
    if (layers[2]) buildLayer(l2, layers[2].color, layers[2].points, skyH, skyW, 3);
    // l3 kept empty for future near silhouettes
    if (l3) l3.fill(0);
  };
})();
