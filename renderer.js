'use strict';
(function () {
  const G = (window.G = window.G || {});
  const { VIEW_W, VIEW_H, WORLD_W, WORLD_H } = G.CONF;
  const { MAT } = G;

  // Small local aliases (hot paths + cache builders)
  const packRGBA = G.packRGBA;
  const clamp = G.clamp;

  // Fallback loading helpers (in case core.js did not set them)
  if (!G.setLoading || !G.finishLoading) {
    const getLoadingEls = () => ({
      el: document.getElementById('loading'),
      text: document.getElementById('loading-text'),
      bar: document.getElementById('loading-bar-inner'),
    });
    G.setLoading = (text, progress) => {
      const { el, text: tEl, bar } = getLoadingEls();
      if (!el) return;
      el.style.display = 'flex';
      el.classList.remove('hide');
      if (tEl && text) tEl.textContent = String(text);
      if (bar && typeof progress === 'number') {
        const p = clamp(progress, 0, 1);
        bar.style.width = Math.round(p * 100) + '%';
      }
    };
    G.finishLoading = () => {
      const { el } = getLoadingEls();
      if (!el) return;
      el.classList.add('hide');
      setTimeout(() => {
        if (el.classList.contains('hide')) el.style.display = 'none';
      }, 400);
    };
  }

  /* =========================================================
     Canvas
     ========================================================= */
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d', { alpha: false });
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  ctx.imageSmoothingEnabled = false;

  // Dynamic pixel-perfect scaling
  // - VIEW_W/H define the *simulation* resolution.
  // - We scale the canvas in CSS with an integer factor to keep crisp pixel art.
  // - AUTO_SCALE fits the window automatically (still integer scale).
  function computeScale() {
    let s = (G.CONF.SCALE | 0) || 1;
    if (G.CONF.AUTO_SCALE) {
      const maxW = Math.max(1, (window.innerWidth | 0));
      const maxH = Math.max(1, (window.innerHeight | 0));
      const sw = (maxW / VIEW_W) | 0;
      const sh = (maxH / VIEW_H) | 0;
      const sMax = (G.CONF.SCALE_MAX | 0) || 99;
      const sMin = (G.CONF.SCALE_MIN | 0) || 1;
      s = Math.max(sMin, Math.min(sw, sh, sMax));
      if (s < 1) s = 1;
    }
    return (s | 0) || 1;
  }

  function applyScale(s) {
    s = (s | 0) || 1;
    G.renderScale = s;
    canvas.style.width = (VIEW_W * s) + 'px';
    canvas.style.height = (VIEW_H * s) + 'px';
  }

  G.applyCanvasScale = applyScale;
  applyScale(computeScale());
  window.addEventListener('resize', () => applyScale(computeScale()));

  G.canvas = canvas;
  G.ctx = ctx;

  /* =========================================================
     Camera
     ========================================================= */
  G.camera = { x: 0, y: 0 };

  G.updateCamera = function updateCamera(dt) {
    const camera = G.camera;
    const player = G.player;
    const mouse = G.mouse;

    const lookAhead = 28;
    const dir = (mouse && (mouse.worldX >= player.x)) ? 1 : -1;

    const targetX = player.x - VIEW_W / 2 + dir * lookAhead;
    const targetY = player.y - VIEW_H / 2 - 22;

    const k = 1 - Math.pow(0.001, dt);
    camera.x += (targetX - camera.x) * k;
    camera.y += (targetY - camera.y) * k;

    camera.x = G.clamp(camera.x, 0, WORLD_W - VIEW_W);
    camera.y = G.clamp(camera.y, 0, WORLD_H - VIEW_H);
  };

  /* =========================================================
     Rendering buffers
     ========================================================= */
  const img = ctx.createImageData(VIEW_W, VIEW_H);
  const pix32 = new Uint32Array(img.data.buffer);
  G._img = img;
  G._pix32 = pix32;

  function shadeRGB(r, g, b, mul, add) {
    return [
      G.clamp((r * mul + add) | 0, 0, 255),
      G.clamp((g * mul + add) | 0, 0, 255),
      G.clamp((b * mul + add) | 0, 0, 255),
    ];
  }

  function makeStyle(def) {
    const pal = new Uint32Array(4);
    const hi = new Uint32Array(4);
    const lo = new Uint32Array(4);
    const edge = new Uint32Array(4);

    const mulHi = def.hi ?? 1.12;
    const mulLo = def.lo ?? 0.86;
    const mulEd = def.edgeMul ?? 0.78;

    for (let i = 0; i < 4; i++) {
      const c = def.pal[i];
      const r = c[0], g = c[1], b = c[2];
      pal[i] = G.packRGBA(r, g, b, 255);

      const [rh, gh, bh] = shadeRGB(r, g, b, mulHi, 8);
      const [rl, gl, bl] = shadeRGB(r, g, b, mulLo, -10);
      const [re, ge, be] = shadeRGB(r, g, b, mulEd, -14);

      hi[i] = G.packRGBA(rh, gh, bh, 255);
      lo[i] = G.packRGBA(rl, gl, bl, 255);
      edge[i] = G.packRGBA(re, ge, be, 255);
    }

    // 16-level shading ramp (used with AO + directional light)
    const shade16 = new Uint32Array(16 * 4);
    const mulDark = ((def.lo ?? 0.86) * 0.72);
    const mulLight = ((def.hi ?? 1.12) * 1.08);
    const addDark = -28;
    const addLight = 10;
    for (let s = 0; s < 16; s++) {
      const t = s / 15;
      const mul = mulDark + (mulLight - mulDark) * t;
      const add = addDark + (addLight - addDark) * t;
      const o = s << 2;
      for (let i = 0; i < 4; i++) {
        const c = def.pal[i];
        const [rr, gg, bb] = shadeRGB(c[0], c[1], c[2], mul, add);
        shade16[o + i] = G.packRGBA(rr, gg, bb, 255);
      }
    }
    return { pal, hi, lo, edge, shade16, edgeMode: def.edge ?? false };
  }

  function texPick4(i, wx, wy, salt) {
    let h = (Math.imul(i ^ (salt * 0x45d9f3b), 0x9E3779B1) ^ (G.seed | 0)) >>> 0;
    let m = G.hash2i(wx >> 3, wy >> 3);
    return (h ^ m) & 3;
  }

  const MAT_DEF = {
    [MAT.ROCK]: { pal: [[34, 38, 46], [42, 48, 58], [50, 56, 68], [30, 34, 42]], edge: true, hi: 1.18, lo: 0.80, edgeMul: 0.72 },
    [MAT.DIRT]: { pal: [[118, 78, 46], [98, 62, 36], [132, 92, 54], [108, 72, 42]], edge: true, hi: 1.12, lo: 0.84, edgeMul: 0.78 },
    [MAT.SAND]: { pal: [[232, 198, 120], [216, 178, 102], [198, 160, 88], [224, 190, 112]], edge: true, hi: 1.12, lo: 0.86, edgeMul: 0.78 },
    [MAT.SNOW]: { pal: [[236, 246, 255], [214, 232, 252], [198, 220, 246], [226, 240, 255]], edge: true, hi: 1.12, lo: 0.88, edgeMul: 0.82 },
    [MAT.ICE]: { pal: [[170, 206, 255], [146, 186, 248], [198, 226, 255], [130, 170, 235]], edge: true, hi: 1.16, lo: 0.90, edgeMul: 0.84 },

    [MAT.PACKED_SNOW]: { pal: [[224, 238, 250], [206, 224, 244], [192, 214, 238], [214, 232, 252]], edge: true, hi: 1.12, lo: 0.88, edgeMul: 0.82 },
    [MAT.DARK_ROCK]: { pal: [[18, 20, 28], [22, 26, 34], [28, 32, 42], [20, 22, 30]], edge: true, hi: 1.18, lo: 0.78, edgeMul: 0.70 },
    [MAT.SANDSTONE]: { pal: [[196, 156, 92], [176, 140, 80], [210, 172, 104], [186, 148, 86]], edge: true, hi: 1.12, lo: 0.84, edgeMul: 0.76 },

    [MAT.WOOD]: { pal: [[168, 110, 62], [146, 90, 50], [130, 78, 42], [158, 100, 56]], edge: true, hi: 1.12, lo: 0.84, edgeMul: 0.78 },
    [MAT.LEAVES]: { pal: [[46, 108, 62], [38, 92, 54], [58, 130, 74], [32, 80, 46]], edge: true, hi: 1.10, lo: 0.86, edgeMul: 0.80 },

    [MAT.WATER]: { pal: [[40, 112, 210], [54, 128, 224], [34, 98, 198], [70, 144, 236]], edge: "surface", hi: 1.16, lo: 0.92, edgeMul: 0.90 },
    [MAT.OIL]: { pal: [[88, 70, 46], [76, 60, 38], [66, 52, 32], [104, 84, 52]], edge: "surface", hi: 1.10, lo: 0.86, edgeMul: 0.88 },
    [MAT.ACID]: { pal: [[30, 150, 80], [42, 178, 98], [26, 128, 70], [64, 210, 120]], edge: "surface", hi: 1.18, lo: 0.88, edgeMul: 0.90 },
    [MAT.LAVA]: { pal: [[200, 50, 30], [234, 82, 30], [178, 40, 24], [250, 134, 54]], edge: "surface", hi: 1.20, lo: 0.90, edgeMul: 0.92 },
    [MAT.FIRE]: { pal: [[255, 118, 40], [255, 176, 72], [255, 90, 30], [255, 212, 110]], edge: false, hi: 1.12, lo: 0.90, edgeMul: 0.80 },
    [MAT.STEAM]: { pal: [[208, 220, 236], [196, 208, 226], [224, 234, 245], [184, 196, 214]], edge: false, hi: 1.06, lo: 0.94, edgeMul: 0.90 },
  };

  const RSTYLE = new Array(256).fill(null);
  for (const k in MAT_DEF) {
    RSTYLE[+k] = makeStyle(MAT_DEF[+k]);
  }

  /* =========================================================
     Background caves per biome & depth
     ========================================================= */
  const BG_LEVELS = 16;
  const BG = [];
  const BGWALL = [];
  const BG_DEF = [
    // SNOW: cold blue stone
    { pal: [[12, 20, 34], [10, 16, 28], [18, 28, 44], [12, 18, 32]] },
    // MINES: neutral slate
    { pal: [[16, 18, 26], [12, 14, 22], [20, 22, 32], [14, 16, 24]] },
    // DESERT: warm sandstone
    { pal: [[28, 22, 18], [24, 18, 14], [36, 28, 22], [26, 20, 16]] },
    // TOXIC: greenish damp rock
    { pal: [[10, 18, 16], [8, 14, 12], [14, 24, 20], [10, 16, 14]] },
  ];

  function precomputeBackground() {
    for (let b = 0; b < 4; b++) {
      BG[b] = new Array(BG_LEVELS);
      BGWALL[b] = new Array(BG_LEVELS);
      for (let d = 0; d < BG_LEVELS; d++) {
        const t = d / (BG_LEVELS - 1);
        const mul = 1.00 - 0.42 * t;

        const pal = new Uint32Array(4);
        const palWall = new Uint32Array(4);

        for (let i = 0; i < 4; i++) {
          const c = BG_DEF[b].pal[i];
          const [r0, g0, b0] = shadeRGB(c[0], c[1], c[2], mul, -4);
          pal[i] = G.packRGBA(r0, g0, b0, 255);

          // Near-wall background a touch brighter + cooler (no warm biomes in mode 2)
          let [rw, gw, bw] = shadeRGB(c[0], c[1], c[2], mul * 1.10, 6);
          bw = G.clamp(bw + 10, 0, 255);
          gw = G.clamp(gw + 4, 0, 255);
          palWall[i] = G.packRGBA(rw, gw, bw, 255);
        }
        BG[b][d] = pal;
        BGWALL[b][d] = palWall;
      }
    }
  }
  precomputeBackground();

  /* =========================================================
     Visual caches (seed-based, built once per seed)
     - Sky: separate parallax layers (3–5) precomputed in buffers
     - Mid: fog + distant silhouettes in a semi-transparent (dither) layer
     - Cave BG: cold-night unified palette (depth-stratified)
     - Outdoor mask + AO: precomputed; no per-frame noise
     - Foreground overlay: snow rims + icicles drawn over EMPTY
     ========================================================= */

  // Cave background cache (world-space)
  G.bgCache = null;

  // Outdoor sky layers (tile in X, clamped in Y)
  G.skyBaseCache = null;
  G.skyLayer0 = null;
  G.skyLayer1 = null;
  G.skyLayer2 = null;
  G.skyLayer3 = null;
  G.midCache = null;

  // Outdoor connectivity + AO for air (world-space, used for shadows)
  G.outdoorDS = 4;
  G.outdoorW = 0;
  G.outdoorH = 0;
  G.outdoorMask = null; // Uint8Array
  G.aoAir = null; // Uint8Array (0..255)

  // Visual texture helpers (world-space)
  G.tex4 = null; // Uint8Array (0..3)
  G.detail = null; // Uint8Array bitfield
  G.chunkToneRock = null; // Int8Array
  G.chunkToneSnow = null; // Int8Array
  G.chunkToneIce = null; // Int8Array
  G.iceStreakX = null; // Int8Array per column

  // Foreground overlay pixels (world-space), drawn over background for EMPTY
  G.fgOverlay = null; // Uint32Array (0=none)

  const SKY_H = Math.min(512, WORLD_H | 0);
  const SKY_W = WORLD_W | 0;
  const SKY_P2 = (SKY_W & (SKY_W - 1)) === 0;
  const SKY_MASK = SKY_P2 ? (SKY_W - 1) : 0;

  // 8x8 Bayer (0..63)
  const BAYER8 = new Uint8Array([
    0, 48, 12, 60, 3, 51, 15, 63,
    32, 16, 44, 28, 35, 19, 47, 31,
    8, 56, 4, 52, 11, 59, 7, 55,
    40, 24, 36, 20, 43, 27, 39, 23,
    2, 50, 14, 62, 1, 49, 13, 61,
    34, 18, 46, 30, 33, 17, 45, 29,
    10, 58, 6, 54, 9, 57, 5, 53,
    42, 26, 38, 22, 41, 25, 37, 21,
  ]);

  function wrapSkyX(x) {
    if (SKY_P2) return x & SKY_MASK;
    x %= SKY_W;
    return x < 0 ? x + SKY_W : x;
  }

  function ensureU32(key, len, clear = true) {
    let a = G[key];
    if (!a || a.length !== len) a = G[key] = new Uint32Array(len);
    if (clear) a.fill(0);
    return a;
  }
  function ensureU8(key, len, clear = true) {
    let a = G[key];
    if (!a || a.length !== len) a = G[key] = new Uint8Array(len);
    if (clear) a.fill(0);
    return a;
  }
  function ensureI8(key, len, clear = true) {
    let a = G[key];
    if (!a || a.length !== len) a = G[key] = new Int8Array(len);
    if (clear) a.fill(0);
    return a;
  }

  function buildOutdoorCoarse() {
    const ds = (G.outdoorDS | 0) || 4;
    const gw = (WORLD_W / ds) | 0;
    const gh = (WORLD_H / ds) | 0;
    const gridN = (gw * gh) | 0;

    G.outdoorW = gw;
    G.outdoorH = gh;

    const out = ensureU8('outdoorMask', gridN, true);

    // BFS queue (reused)
    let q = G._tmpOutdoorQ;
    if (!q || q.length !== gridN) q = G._tmpOutdoorQ = new Int32Array(gridN);
    let head = 0,
      tail = 0;

    // Seed with the top coarse row (y ~ ds/2). Top border is rock, so we start just below.
    const sy = (ds >> 1) | 0;
    for (let gx = 0; gx < gw; gx++) {
      const wx = (gx * ds + sy) | 0;
      const wy = sy;
      const i = G.idx(wx, wy);
      if (G.mat[i] === MAT.EMPTY) {
        const id = gx;
        out[id] = 1;
        q[tail++] = id;
      }
    }

    while (head < tail) {
      const id = q[head++];
      const gx = id % gw;
      const gy = (id / gw) | 0;

      // 4-neighbors
      // left
      if (gx > 0) {
        const nid = id - 1;
        if (!out[nid]) {
          const wx = ((gx - 1) * ds + sy) | 0;
          const wy = (gy * ds + sy) | 0;
          if (G.mat[G.idx(wx, wy)] === MAT.EMPTY) {
            out[nid] = 1;
            q[tail++] = nid;
          }
        }
      }
      // right
      if (gx + 1 < gw) {
        const nid = id + 1;
        if (!out[nid]) {
          const wx = ((gx + 1) * ds + sy) | 0;
          const wy = (gy * ds + sy) | 0;
          if (G.mat[G.idx(wx, wy)] === MAT.EMPTY) {
            out[nid] = 1;
            q[tail++] = nid;
          }
        }
      }
      // up
      if (gy > 0) {
        const nid = id - gw;
        if (!out[nid]) {
          const wx = (gx * ds + sy) | 0;
          const wy = ((gy - 1) * ds + sy) | 0;
          if (G.mat[G.idx(wx, wy)] === MAT.EMPTY) {
            out[nid] = 1;
            q[tail++] = nid;
          }
        }
      }
      // down
      if (gy + 1 < gh) {
        const nid = id + gw;
        if (!out[nid]) {
          const wx = (gx * ds + sy) | 0;
          const wy = ((gy + 1) * ds + sy) | 0;
          if (G.mat[G.idx(wx, wy)] === MAT.EMPTY) {
            out[nid] = 1;
            q[tail++] = nid;
          }
        }
      }
    }
  }

  function buildAoAir() {
    const N = WORLD_W * WORLD_H;
    const ao = ensureU8('aoAir', N, true);

    // Temporary distance fields (reused)
    let distUp = G._tmpDistUp;
    if (!distUp || distUp.length !== N) distUp = G._tmpDistUp = new Uint8Array(N);
    let distLR = G._tmpDistLR;
    if (!distLR || distLR.length !== N) distLR = G._tmpDistLR = new Uint8Array(N);

    const mat = G.mat;
    const W = WORLD_W | 0;
    const H = WORLD_H | 0;

    // distUp: distance since last solid above (0..255)
    for (let x = 0; x < W; x++) {
      let d = 255;
      for (let y = 0; y < H; y++) {
        const i = y * W + x;
        if (mat[i] !== MAT.EMPTY) d = 0;
        else if (d < 255) d++;
        distUp[i] = d;
      }
    }

    // distLR: min distance to solid left/right
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let d = 255;
      for (let x = 0; x < W; x++) {
        const i = row + x;
        if (mat[i] !== MAT.EMPTY) d = 0;
        else if (d < 255) d++;
        distLR[i] = d;
      }
      d = 255;
      for (let x = W - 1; x >= 0; x--) {
        const i = row + x;
        if (mat[i] !== MAT.EMPTY) d = 0;
        else if (d < 255) d++;
        if (d < distLR[i]) distLR[i] = d;
      }
    }

    // Average surface height (for depth tint)
    let avgSurface = 220;
    const surf = G.surfaceY;
    if (surf && surf.length === W) {
      let s = 0;
      for (let x = 0; x < W; x++) s += surf[x] | 0;
      avgSurface = (s / W) | 0;
    }

    const out = G.outdoorMask;
    const ds = (G.outdoorDS | 0) || 4;
    const outW = G.outdoorW | 0;

    for (let y = 0; y < H; y++) {
      const row = y * W;
      const oy = ((y / ds) | 0) * outW;
      const depthT = y <= avgSurface ? 0 : Math.min(1, (y - avgSurface) / (H - avgSurface));
      for (let x = 0; x < W; x++) {
        const i = row + x;
        if (mat[i] !== MAT.EMPTY) {
          ao[i] = 0;
          continue;
        }
        const outdoor = out ? out[((x / ds) | 0) + oy] : 0;

        // Base darkness (caves are darker; outdoor starts at 0)
        let a = outdoor ? 0 : (110 + (depthT * 80)) | 0;

        const du = distUp[i];
        if (du < 36) a += (36 - du) * 3;

        const dlr = distLR[i];
        if (dlr < 26) a += (26 - dlr) * 4;

        if (a > 255) a = 255;
        ao[i] = a;
      }
    }
  }

  function buildTexMaps() {
    const N = WORLD_W * WORLD_H;
    const seed = (G.seed | 0) >>> 0;

    const tex4 = ensureU8('tex4', N, false);
    for (let i = 0; i < N; i++) {
      // Fast LCG-ish hash on index (stable, no RNG state)
      const v = (Math.imul(i ^ seed, 1103515245) + 12345) >>> 0;
      tex4[i] = (v >>> 30) & 3;
    }

    // Chunk tone variations (coarse, avoids salt-and-pepper)
    const CW = (G.WORLD_CW | 0) || ((WORLD_W / (G.CHUNK_SIZE | 0)) | 0);
    const CH = (G.WORLD_CH | 0) || ((WORLD_H / (G.CHUNK_SIZE | 0)) | 0);
    const CN = (CW * CH) | 0;

    const rockT = ensureI8('chunkToneRock', CN, false);
    const snowT = ensureI8('chunkToneSnow', CN, false);
    const iceT = ensureI8('chunkToneIce', CN, false);

    for (let cy = 0; cy < CH; cy++) {
      for (let cx = 0; cx < CW; cx++) {
        const ci = cx + cy * CW;
        const h = (G.hash2i(cx, cy) ^ seed ^ 0x9e3779b9) >>> 0;
        rockT[ci] = ((h >>> 24) & 31) - 15;
        snowT[ci] = ((h >>> 16) & 15) - 7;
        iceT[ci] = ((h >>> 8) & 15) - 7;
      }
    }

    // Column streaks for ice (vertical banding)
    const streak = ensureI8('iceStreakX', WORLD_W | 0, false);
    for (let x = 0; x < WORLD_W; x++) {
      const h = (G.hash2i(x >> 3, 77) ^ seed ^ 0x85ebca6b) >>> 0;
      streak[x] = ((h >>> 24) & 15) - 7;
    }

    // Surface/cavity detail bitfield (cracks/sparkles/specks)
    const det = ensureU8('detail', N, true);
    const mat = G.mat;
    const W = WORLD_W | 0;
    const H = WORLD_H | 0;

    for (let y = 1; y < H - 1; y++) {
      const row = y * W;
      const rowU = (y - 1) * W;
      const rowD = (y + 1) * W;
      for (let x = 1; x < W - 1; x++) {
        const i = row + x;
        const m = mat[i];
        if (m === MAT.EMPTY) continue;

        const upEmpty = mat[rowU + x] === MAT.EMPTY;
        const dnEmpty = mat[rowD + x] === MAT.EMPTY;
        const lEmpty = mat[i - 1] === MAT.EMPTY;
        const rEmpty = mat[i + 1] === MAT.EMPTY;
        if (!(upEmpty || dnEmpty || lEmpty || rEmpty)) continue;

        const h = (Math.imul(i ^ seed, 2246822519) + 3266489917) >>> 0;

        // Rock cracks + specks (subtle)
        if (m === MAT.ROCK || m === MAT.DARK_ROCK || m === MAT.SANDSTONE || m === MAT.DIRT) {
          if (((h & 2047) < 10) && (upEmpty || lEmpty || rEmpty)) det[i] |= 1; // crack
          if (((h >>> 11) & 4095) < 4) det[i] |= 8; // speck
        }

        // Ice cracks (rare, mostly on exposed surfaces)
        if (m === MAT.ICE && upEmpty) {
          if ((h & 1023) < 8) det[i] |= 2;
        }

        // Snow sparkle (rare, only top surfaces)
        if ((m === MAT.SNOW || m === MAT.PACKED_SNOW) && upEmpty) {
          if ((h & 1023) < 10) det[i] |= 4;
        }
      }
    }
  }

  function buildForegroundOverlay() {
    const N = WORLD_W * WORLD_H;
    const over = ensureU32('fgOverlay', N, true);

    const mat = G.mat;
    const W = WORLD_W | 0;
    const H = WORLD_H | 0;

    const tex4 = G.tex4;
    const ao = G.aoAir;
    const out = G.outdoorMask;
    const outW = G.outdoorW | 0;
    const ds = (G.outdoorDS | 0) || 4;

    const BIOME = G.BIOME;

    const rimOut0 = packRGBA(240, 248, 255, 255);
    const rimOut1 = packRGBA(218, 236, 255, 255);
    const rimIn0 = packRGBA(210, 228, 250, 255);
    const rimIn1 = packRGBA(188, 210, 242, 255);

    const ic0 = packRGBA(200, 230, 255, 255);
    const ic1 = packRGBA(178, 212, 248, 255);
    const ic2 = packRGBA(160, 196, 238, 255);

    const sh0 = packRGBA(10, 12, 18, 255);
    const sh1 = packRGBA(14, 16, 22, 255);

    const dust0 = packRGBA(220, 188, 120, 255);
    const dust1 = packRGBA(202, 172, 106, 255);
    const tox0 = packRGBA(110, 170, 120, 255);
    const tox1 = packRGBA(90, 150, 102, 255);

    const surf = G.surfaceY;

    const rate = +(G.CONF?.LEVEL_GEN?.icicleRate ?? 0.70);
    const baseTh = Math.max(1, Math.min(64, (6 + rate * 28) | 0)); // 0..64 out of 1024-ish

    for (let y = 2; y < H - 2; y++) {
      const row = y * W;
      const rowU = (y - 1) * W;
      const rowD = (y + 1) * W;
      const oy = ((y / ds) | 0) * outW;
      const oyU = (((y - 1) / ds) | 0) * outW;

      for (let x = 2; x < W - 2; x++) {
        const i = row + x;
        const m = mat[i];
        const sb = G.surfaceBiome ? (G.surfaceBiome[x] | 0) : BIOME.MINES;
        const sy = surf ? (surf[x] | 0) : 220;

        // Snow rim: draw into the air pixel just above exposed snow/packed snow
        if ((m === MAT.SNOW || m === MAT.PACKED_SNOW) && mat[rowU + x] === MAT.EMPTY) {
          const j = rowU + x;
          // Dither so rims don't look like a perfect strip
          if (((x + y + (tex4 ? tex4[i] : 0)) & 1) === 0) {
            const outdoor = out ? out[((x / ds) | 0) + oyU] : 0;
            const t = tex4 ? tex4[i] : 0;
            over[j] = outdoor ? (t & 1 ? rimOut1 : rimOut0) : (t & 1 ? rimIn1 : rimIn0);
          }

          // Micro shadow just under the rim (helps cornice depth)
          const k = rowD + x;
          if (mat[k] === MAT.EMPTY) {
            const a = ao ? ao[k] : 0;
            if (a > 18) {
              const b = BAYER8[(x & 7) + ((y & 7) << 3)];
              if (b < 24) over[k] = (a > 90 ? sh0 : sh1);
            }
          }
        }

        // Icicles: under snow/ice overhangs
        if ((m === MAT.PACKED_SNOW || m === MAT.ICE || m === MAT.SNOW) && mat[rowD + x] === MAT.EMPTY) {
          // More icicles in SNOW biome; much fewer elsewhere
          let th = baseTh;
          if (sb !== BIOME.SNOW) th = (th * 0.25) | 0;

          if (th > 0) {
            const seed = (G.seed | 0) >>> 0;
            const h = (Math.imul(i ^ seed, 747796405) + 2891336453) >>> 0;
            if ((h & 1023) < th) {
              const len = 2 + ((h >>> 10) & 7);
              for (let t = 1; t <= len; t++) {
                const jj = i + t * W;
                if (jj <= 0 || jj >= N) break;
                if (mat[jj] !== MAT.EMPTY) break;
                const col = t <= 2 ? ic0 : t <= 4 ? ic1 : ic2;
                // Slight dither taper
                if (t == 1 || ((BAYER8[(x & 7) + (((y + t) & 7) << 3)] < (58 - t * 5)) | 0)) {
                  over[jj] = col;
                }
              }
            }
          }
        }

        // Desert dust / toxic spores (outdoor air only, just above surface)
        if (!over[i] && m === MAT.EMPTY) {
          const outdoor = out ? out[((x / ds) | 0) + oy] : 0;
          if (outdoor && y < sy && y > sy - 28) {
            const b = BAYER8[(x & 7) + ((y & 7) << 3)];
            if (sb === BIOME.DESERT) {
              if (b < 12) over[i] = (b & 1) ? dust0 : dust1;
            } else if (sb === BIOME.TOXIC) {
              if (b < 10) over[i] = (b & 1) ? tox0 : tox1;
            }
          }
        }
      }
    }
  }

  function buildCaveBgCache() {
    const N = WORLD_W * WORLD_H;
    const out = ensureU32('bgCache', N, false);

    const mat = G.mat;
    const W = WORLD_W | 0;
    const H = WORLD_H | 0;
    const surf = G.surfaceY;

    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const i = row + x;

        // Depth stratification relative to surface (column-aware)
        const sy = surf ? (surf[x] | 0) : 220;
        let depth = y - sy;
        if (depth < 0) depth = 0;
        const denom = Math.max(1, (H - sy) | 0);
        let depthLevel = ((depth / denom) * (BG_LEVELS - 1)) | 0;
        if (depthLevel < 0) depthLevel = 0;
        if (depthLevel > BG_LEVELS - 1) depthLevel = BG_LEVELS - 1;

        const b = (G.biomeAt ? G.biomeAt(x, y) : (G.BIOME?.MINES ?? 1)) | 0;
        const pal = BG[b][depthLevel];
        const palWall = BGWALL[b][depthLevel];

        let nearWall = false;
        if (mat[i] === MAT.EMPTY) {
          // Close to terrain => use wall variant
          if (x > 0 && G.isTerrain(mat[i - 1])) nearWall = true;
          else if (x + 1 < W && G.isTerrain(mat[i + 1])) nearWall = true;
          else if (y > 0 && G.isTerrain(mat[i - W])) nearWall = true;
          else if (y + 1 < H && G.isTerrain(mat[i + W])) nearWall = true;
        }

        const p = nearWall ? palWall : pal;

        // Slow dither variation (precomputed, deterministic)
        const h = (G.hash2i(x >> 3, y >> 3) ^ (G.seed | 0)) >>> 0;
        const t = (h >>> 30) & 3;
        out[i] = p[t];
      }
    }

    G.bgCache = out;
  }

  function buildSkyCaches() {
    const len = SKY_W * SKY_H;

    const base = ensureU32('skyBaseCache', len, true);
    const l0 = ensureU32('skyLayer0', len, true);
    const l1 = ensureU32('skyLayer1', len, true);
    const l2 = ensureU32('skyLayer2', len, true);
    const l3 = ensureU32('skyLayer3', len, true);
    const mid = ensureU32('midCache', len, true);

    const seed = (G.seed | 0) >>> 0;

    // Horizon anchored loosely to the average surface
    let horizon = 220;
    const surf = G.surfaceY;
    if (surf && surf.length === WORLD_W) {
      let s = 0;
      for (let x = 0; x < WORLD_W; x++) s += surf[x] | 0;
      horizon = (s / WORLD_W) | 0;
      horizon = clamp(horizon, 160, 280);
    }

    // Sky gradient (richer dusk + aurora hints)
    for (let y = 0; y < SKY_H; y++) {
      const t = SKY_H <= 1 ? 0 : y / (SKY_H - 1);
      const k = t * t;
      let r = (8 + k * 58) | 0;
      let g = (14 + k * 76) | 0;
      let b = (26 + k * 138) | 0;

      // Warm horizon haze
      const hz = clamp((t - 0.52) / 0.48, 0, 1);
      r = clamp(r + (hz * 22) | 0, 0, 255);
      g = clamp(g + (hz * 26) | 0, 0, 255);
      b = clamp(b + (hz * 28) | 0, 0, 255);

      const row = y * SKY_W;
      for (let x = 0; x < SKY_W; x++) {
        let rr = r;
        let gg = g;
        let bb = b;

        // Aurora ribbons (top half only)
        if (y < (horizon * 0.55)) {
          const a = G.valueNoise1D(x + (y * 0.55) + (seed & 1023), 180);
          if (a > 0.62) {
            const amp = (a - 0.62) / 0.38;
            rr = clamp(rr + (amp * 10) | 0, 0, 255);
            gg = clamp(gg + (amp * 38) | 0, 0, 255);
            bb = clamp(bb + (amp * 46) | 0, 0, 255);
          }
        }

        // Tiny dither to avoid flat bands
        const d = BAYER8[(x & 7) + ((y & 7) << 3)] - 32;
        rr = clamp(rr + (d >> 5), 0, 255);
        gg = clamp(gg + (d >> 5), 0, 255);
        bb = clamp(bb + (d >> 5), 0, 255);
        base[row + x] = packRGBA(rr, gg, bb, 255);
      }
    }

    // Stars (top ~60%) — deterministic, no per-frame twinkle
    const yMax = (SKY_H * 0.60) | 0;
    for (let y = 2; y < yMax; y++) {
      const row = y * SKY_W;
      for (let x = 2; x < SKY_W - 2; x++) {
        const h = (G.hash2i(x >> 1, y >> 1) ^ seed) >>> 0;
        // Density tuned to avoid "salt & pepper" — clusters with a threshold
        const v = h & 8191;
        if (v < 4) {
          const c = 228 + ((h >>> 13) & 20);
          base[row + x] = packRGBA(c, c, clamp(c + 10, 0, 255), 255);
          // small cross for brighter stars
          if (v <= 1 && y > 4) {
            const c2 = clamp(c - 22, 0, 255);
            base[row + x - 1] = packRGBA(c2, c2, clamp(c2 + 8, 0, 255), 255);
            base[row + x + 1] = packRGBA(c2, c2, clamp(c2 + 8, 0, 255), 255);
            base[row - SKY_W + x] = packRGBA(c2, c2, clamp(c2 + 8, 0, 255), 255);
            base[row + SKY_W + x] = packRGBA(c2, c2, clamp(c2 + 8, 0, 255), 255);
          }
        }
      }
    }

    // Moon
    {
      const mx = wrapSkyX(((seed * 2654435761) >>> 0) % SKY_W);
      const my = 52 + (((seed >>> 16) & 63) % 120);
      const mr = 26 + ((seed >>> 24) & 15);
      for (let y = Math.max(0, my - mr - 1); y <= Math.min(SKY_H - 1, my + mr + 1); y++) {
        const dy = y - my;
        const row = y * SKY_W;
        for (let x = Math.max(0, mx - mr - 1); x <= Math.min(SKY_W - 1, mx + mr + 1); x++) {
          const dx = x - mx;
          const d2 = dx * dx + dy * dy;
          if (d2 <= mr * mr) {
            const t = Math.sqrt(d2) / mr;
            const shade = clamp(255 - (t * 55) | 0, 0, 255);
            let rr = shade;
            let gg = shade;
            let bb = clamp(shade + 10, 0, 255);

            // Craters (subtle)
            const h = (G.hash2i((x - mx) >> 1, (y - my) >> 1) ^ seed) >>> 0;
            if ((h & 255) < 18) {
              rr = clamp(rr - 20, 0, 255);
              gg = clamp(gg - 20, 0, 255);
              bb = clamp(bb - 16, 0, 255);
            }
            base[row + x] = packRGBA(rr, gg, bb, 255);
          }
        }
      }
    }

    // Mountain layers (filled silhouettes with depth + snow caps)
    const layers = [
      { arr: l0, scale: 0.11, baseUp: 118, amp: 74, off: 9101, rough: 1.25, top: [64, 78, 112], bot: [20, 24, 36], cap: 8, fade: 240 },
      { arr: l1, scale: 0.16, baseUp: 98, amp: 90, off: 18181, rough: 1.30, top: [48, 60, 94], bot: [16, 20, 32], cap: 10, fade: 300 },
      { arr: l2, scale: 0.22, baseUp: 78, amp: 108, off: 27191, rough: 1.34, top: [36, 46, 76], bot: [12, 16, 26], cap: 12, fade: 360 },
      { arr: l3, scale: 0.30, baseUp: 60, amp: 132, off: 33331, rough: 1.38, top: [28, 36, 58], bot: [10, 12, 20], cap: 14, fade: 420 },
    ];

    for (let li = 0; li < layers.length; li++) {
      const L = layers[li];
      const a = L.arr;
      for (let x = 0; x < SKY_W; x++) {
        let y0 = skyMountainY(x, horizon, L.scale, L.baseUp, L.amp, L.off + (seed & 1023), L.rough);
        if (y0 < 0) y0 = 0;
        if (y0 >= SKY_H) continue;

        const yFadeStart = Math.min(SKY_H - 1, (horizon + L.fade) | 0);

        for (let y = y0; y < SKY_H; y++) {
          // Fade out far below the horizon (prevents "mountains everywhere" when clamped)
          if (y > yFadeStart) {
            const f = clamp((y - yFadeStart) / (SKY_H - yFadeStart), 0, 1);
            const thr = (1 - f) * 48;
            if (BAYER8[(x & 7) + ((y & 7) << 3)] > thr) continue;
          }

          const dy = y - y0;
          const t = clamp(dy / 220, 0, 1);

          // Vertical shading: lighter near ridge, darker deeper
          let rr = (L.top[0] + (L.bot[0] - L.top[0]) * t) | 0;
          let gg = (L.top[1] + (L.bot[1] - L.top[1]) * t) | 0;
          let bb = (L.top[2] + (L.bot[2] - L.top[2]) * t) | 0;

          // Subtle grain (chunky, not noise)
          const g = (BAYER8[(x & 7) + ((y & 7) << 3)] - 32) >> 4;
          rr = clamp(rr + g, 0, 255);
          gg = clamp(gg + g, 0, 255);
          bb = clamp(bb + g, 0, 255);

          // Snow cap band near ridge line
          if (dy <= L.cap) {
            const s = 1 - dy / Math.max(1, L.cap);
            rr = clamp(rr + (s * 110) | 0, 0, 255);
            gg = clamp(gg + (s * 120) | 0, 0, 255);
            bb = clamp(bb + (s * 135) | 0, 0, 255);
          }

          a[y * SKY_W + x] = packRGBA(rr, gg, bb, 255);
        }
      }
    }

    // Mid layer: fog bands + distant cliff silhouettes (dithered for pseudo-alpha)
    {
      // Soft cliffs
      const cliffY = new Int16Array(SKY_W);
      for (let x = 0; x < SKY_W; x++) {
        const n = (G.valueNoise1D(x + 4040, 120) - 0.5) * 40;
        cliffY[x] = (horizon + 140 + n) | 0;
      }
      for (let x = 0; x < SKY_W; x++) {
        const y0 = clamp(cliffY[x], 0, SKY_H - 1);
        for (let y = y0; y < SKY_H; y++) {
          const b = BAYER8[(x & 7) + ((y & 7) << 3)];
          if (b < 36) {
            mid[y * SKY_W + x] = packRGBA(12, 14, 22, 255);
          }
        }
      }

      // Fog bands
      const bands = [
        { y: horizon + 110, h: 34, den: 18 },
        { y: horizon + 180, h: 42, den: 22 },
        { y: horizon + 260, h: 56, den: 26 },
        { y: horizon + 340, h: 70, den: 30 },
      ];
      for (const band of bands) {
        const y1 = clamp(band.y | 0, 0, SKY_H - 1);
        const y2 = clamp((band.y + band.h) | 0, 0, SKY_H - 1);
        for (let y = y1; y <= y2; y++) {
          const t = (y - y1) / Math.max(1, y2 - y1);
          const den = (band.den + (t * 8)) | 0;
          const row = y * SKY_W;
          for (let x = 0; x < SKY_W; x++) {
            if (BAYER8[(x & 7) + ((y & 7) << 3)] < den) {
              // Light bluish fog
              mid[row + x] = packRGBA(54, 72, 124, 255);
            }
          }
        }
      }
    }

    // Parallax fixedpoint (xShift = (camX*par)>>8)
    G._skyPar = {
      base: 18, // 18/256
      l0: 28,
      l1: 44,
      l2: 64,
      l3: 92,
      mid: 176,
      off: (seed ^ 0x4cf5ad43) >>> 0,
    };
  }

  function buildBgCache() {
    // Seed guard
    if (G._bgCacheSeed === (G.seed | 0) && G.bgCache && G.skyBaseCache) return;

    if (G.setLoading) G.setLoading('Building visual caches...', 0.7);

    precomputeBackground();
    buildCaveBgCache();
    buildOutdoorCoarse();
    buildAoAir();
    buildTexMaps();
    buildSkyCaches();
    buildForegroundOverlay();

    G._bgCacheSeed = (G.seed | 0);
    if (G.setLoading) G.setLoading('Finalizing...', 0.85);
  }

  G.rebuildBgCache = buildBgCache;


  /* =========================================================
     Outdoor sky background (Noita-ish)
     ========================================================= */
  function ridge01(v) {
    // v in [0,1] -> ridge in [0,1] (peaks), helps form sharp mountain silhouettes
    v = v * 2 - 1;
    v = 1 - Math.abs(v);
    return v;
  }

  function skyMountainY(wx, surfY, par, baseUp, amp, off, sharp = 1.28) {
    // Returns the y coordinate where the mountain silhouette starts (y increases downward).
    // Ridge noise + domain warp => more distinct peaks (closer to hand-made pixel silhouettes).
    const x0 = wx * par + off;

    // Big domain warp (macro peaks)
    const warp = (G.valueNoise1D(x0 + 17171, 880) - 0.5) * 220;
    const x = x0 + warp;

    // Multi-octave ridge fbm
    let n = 0;
    let a = 1.0;
    let sc = 980;
    for (let o = 0; o < 4; o++) {
      const v = ridge01(G.valueNoise1D(x + o * 1337, sc));
      n += (v - 0.52) * a;
      a *= 0.55;
      sc *= 0.55;
    }

    // Narrow peaks on top (adds more readable mountain tops)
    const pk = ridge01(G.valueNoise1D(x + 9191, 210));
    n += (pk - 0.55) * 0.55;

    // Keep peaks sharp, valleys softer
    const s = (n >= 0) ? Math.pow(n, sharp) : -Math.pow(-n, 0.90);

    return (surfY - baseUp - s * amp) | 0;
  }

  function skyBG(wx, wy, surfY) {
    // Basic night sky gradient (slightly biome-tinted)
    const denom = Math.max(1, surfY);
    const t0 = G.clamp(wy / denom, 0, 1);
    const t = G.smoothstep(t0);

    // Use the surface biome when available (precomputed per-column by worldgen).
    const sb = (G.surfaceBiome ? (G.surfaceBiome[wx] | 0) : G.BIOME.MINES);

    // Colder gradient for snow maps, warmer elsewhere.
    const cold = (sb === G.BIOME.SNOW);

    let r = (G.lerp(cold ? 6 : 9, cold ? 34 : 44, t)) | 0;
    let g = (G.lerp(cold ? 10 : 12, cold ? 54 : 60, t)) | 0;
    let b = (G.lerp(cold ? 26 : 24, cold ? 102 : 92, t)) | 0;

    // Gentle horizon haze
    const hz = G.clamp((t0 - 0.62) / 0.38, 0, 1);
    const haze = G.smoothstep(hz);
    r = (r + 18 * haze) | 0;
    g = (g + 22 * haze) | 0;
    b = (b + 26 * haze) | 0;

    // Mountains (4 parallax layers)
    // Order: far -> mid -> near -> front (front overrides)
    const farY   = skyMountainY(wx, surfY, 0.12, 78, 52, (G.seed & 1023), 1.18);
    const midY   = skyMountainY(wx, surfY, 0.20, 62, 44, (G.seed & 2047) + 900, 1.22);
    const nearY  = skyMountainY(wx, surfY, 0.32, 46, 34, (G.seed & 4095) + 2000, 1.26);
    const frontY = skyMountainY(wx, surfY, 0.48, 34, 26, (G.seed & 8191) + 4000, 1.30);

    const inFar = (wy >= farY);
    const inMid = (wy >= midY);
    const inNear = (wy >= nearY);
    const inFront = (wy >= frontY);

    // Base colors per layer (snow biome is colder / bluer)
    if (inFar) {
      r = cold ? 16 : 18; g = cold ? 20 : 22; b = cold ? 34 : 30;
    }
    if (inMid) {
      r = cold ? 20 : 22; g = cold ? 26 : 26; b = cold ? 44 : 38;
    }
    if (inNear) {
      r = cold ? 26 : 28; g = cold ? 32 : 32; b = cold ? 58 : 50;
    }
    if (inFront) {
      r = cold ? 30 : 32; g = cold ? 38 : 38; b = cold ? 72 : 60;
    }

    // Atmospheric fog between layers
    // (slightly lighter near the horizon, darker at the top)
    if (inFar) {
      const fog = G.clamp((t0 - 0.58) / 0.42, 0, 1);
      const f = G.smoothstep(fog) * 0.45;
      r = (r + (cold ? 26 : 22) * f) | 0;
      g = (g + (cold ? 30 : 24) * f) | 0;
      b = (b + (cold ? 36 : 26) * f) | 0;
    }

    // Snowcaps highlight (helps sell the look)
    if (cold) {
      // Ridge line proximity test per layer
      const cap = (y, t) => (wy >= y && wy <= y + t);
      if (cap(farY, 2))   { r = 44; g = 54; b = 72; }
      if (cap(midY, 2))   { r = 52; g = 62; b = 86; }
      if (cap(nearY, 2))  { r = 62; g = 72; b = 98; }
      if (cap(frontY, 3)) { r = 76; g = 88; b = 122; }
    }


    // Moon (seed-based position)
    const moonX = (((G.seed >>> 0) % (WORLD_W - 200)) + 100) | 0;
    const moonY = (28 + (((G.seed >>> 8) % 40) | 0)) | 0;
    const dxm = wx - moonX;
    const dym = wy - moonY;
    const rr = 13;
    const d2 = dxm * dxm + dym * dym;
    if (d2 <= rr * rr) {
      const edge = (d2 > (rr - 2) * (rr - 2));
      r = edge ? 190 : 215;
      g = edge ? 205 : 225;
      b = edge ? 230 : 245;
    }

    // Stars (only in open sky, not inside mountain silhouettes)
    if (!inFar && wy < (surfY * 0.70)) {
      const h = G.hash2i(wx >> 2, wy >> 2);
      const pick = h & 8191;
      if (pick < 3) {
        const tw = ((G.frameId >> 2) + (h >>> 12)) & 3;
        const add = 140 + tw * 20;
        r = G.clamp(r + add, 0, 255);
        g = G.clamp(g + add, 0, 255);
        b = G.clamp(b + add, 0, 255);
      }
    }

    // Subtle clouds/noise (very faint)
    if (!inFar && wy < (surfY * 0.78)) {
      const c = G.valueNoise2D(wx + (G.seed & 1023), wy + 2000, 160);
      if (c > 0.72) {
        const k = (c - 0.72) / 0.28;
        const kk = k * 12;
        r = G.clamp((r + kk) | 0, 0, 255);
        g = G.clamp((g + kk) | 0, 0, 255);
        b = G.clamp((b + kk) | 0, 0, 255);
      }
    }

    // Tiny dithering to keep it pixel-art
    if (((G.hash2i(wx, wy) + (G.seed | 0)) & 7) === 0) {
      r = G.clamp(r - 2, 0, 255);
      g = G.clamp(g - 2, 0, 255);
      b = G.clamp(b - 3, 0, 255);
    }

    return G.packRGBA(r, g, b, 255);
  }

  /* =========================================================
     World rendering
     ========================================================= */
  // Tiny color helpers (no allocations)
  const AO_MUL_LUT = new Uint16Array(256);
  for (let i = 0; i < 256; i++) AO_MUL_LUT[i] = (256 - ((i * 176) >> 8)) | 0; // strength

  function mulColorU32(col, mul) {
    // mul: 0..256
    const r = ((col & 255) * mul) >> 8;
    const g = (((col >>> 8) & 255) * mul) >> 8;
    const b = (((col >>> 16) & 255) * mul) >> 8;
    return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  }
  function renderWorld(camX, camY) {
    const cx = camX | 0;
    const cy = camY | 0;
    const W = WORLD_W;
    const H = WORLD_H;

    // Visual quality (0..2)
    const q = (G.CONF?.VISUALS?.quality | 0) || 0;
    const useMid = q >= 1;
    const useOverlay = q >= 1;
    const useDetail = q >= 1;
    const useAO = q >= 2;

    const mat = G.mat;
    const bgCache = G.bgCache;
    const bgDeco = G.bgDeco;
    const aoAir = useAO ? G.aoAir : null;
    const fgOverlay = useOverlay ? G.fgOverlay : null;
    const tex4 = G.tex4;
    const detail = useDetail ? G.detail : null;

    // Outdoor sky caches (parallax, tiled X)
    const outdoor = G.outdoorMask;
    const outW = G.outdoorW | 0;
    const skyBase = G.skyBaseCache;
    const skyL0 = G.skyLayer0;
    const skyL1 = G.skyLayer1;
    const skyL2 = G.skyLayer2;
    const skyL3 = G.skyLayer3;
    const midCache = useMid ? G.midCache : null;
    const skyPar = G._skyPar || { baseFP: 0, l0FP: 0, l1FP: 0, l2FP: 0, l3FP: 0, midFP: 0 };
    const skyOff = G._skyOff || { base: 0, l0: 0, l1: 0, l2: 0, l3: 0, mid: 0 };

    // Chunk tone variation
    const CSHIFT = G.CHUNK_SHIFT | 0;
    const CW = G.WORLD_CW | 0;
    const rockTone = G.chunkToneRock;
    const snowTone = G.chunkToneSnow;
    const iceTone = G.chunkToneIce;
    const iceStreakX = G.iceStreakX;
    const grain = +(G.CONF?.VISUALS?.rockGrain ?? 0.65);
    const grainK = (grain * 8) | 0; // 0..8

    // Precompute parallax X starts (same for all scanlines)
    const xBase0 = wrapSkyX(((cx * skyPar.baseFP) >> 8) + (skyOff.base | 0));
    const xL00 = wrapSkyX(((cx * skyPar.l0FP) >> 8) + (skyOff.l0 | 0));
    const xL10 = wrapSkyX(((cx * skyPar.l1FP) >> 8) + (skyOff.l1 | 0));
    const xL20 = wrapSkyX(((cx * skyPar.l2FP) >> 8) + (skyOff.l2 | 0));
    const xL30 = wrapSkyX(((cx * skyPar.l3FP) >> 8) + (skyOff.l3 | 0));
    const xMid0 = wrapSkyX(((cx * skyPar.midFP) >> 8) + (skyOff.mid | 0));

    // Render
    let out = 0;
    for (let sy = 0; sy < VIEW_H; sy++) {
      const wy = (cy + sy) | 0;
      if (wy < 0 || wy >= H) {
        // Off-world rows: just clear
        for (let sx = 0; sx < VIEW_W; sx++) pix32[out++] = 0xff000000;
        continue;
      }

      // Outdoor mask row (DS=4)
      const outRow = outdoor ? (((wy >> 2) * outW) | 0) : 0;

      // Sky row (clamped)
      const skyY = wy < 0 ? 0 : wy >= SKY_H ? SKY_H - 1 : wy;
      const skyRow = skyY * SKY_W;

      // Parallax X cursors
      let xb = xBase0;
      let x0 = xL00;
      let x1 = xL10;
      let x2 = xL20;
      let x3 = xL30;
      let xm = xMid0;

      let wx = cx | 0;
      let i = (wy * W + cx) | 0;

      for (let sx = 0; sx < VIEW_W; sx++) {
        const m = mat[i];

        // --- background sample (needed for EMPTY and for STEAM dithering) ---
        let bgCol = 0xff000000;
        const deco = bgDeco ? bgDeco[i] : 0;
        if (deco) {
          bgCol = deco;
        } else if (skyBase && outdoor && outdoor[(wx >> 2) + outRow]) {
          // Base sky
          bgCol = skyBase[skyRow + xb];
          // Mountains (far -> near)
          let t = skyL0 ? skyL0[skyRow + x0] : 0;
          if (t) bgCol = t;
          t = skyL1 ? skyL1[skyRow + x1] : 0;
          if (t) bgCol = t;
          t = skyL2 ? skyL2[skyRow + x2] : 0;
          if (t) bgCol = t;
          t = skyL3 ? skyL3[skyRow + x3] : 0;
          if (t) bgCol = t;
          // Midground fog / near cliffs
          if (midCache) {
            t = midCache[skyRow + xm];
            if (t) bgCol = t;
          }
        } else if (bgCache) {
          bgCol = bgCache[i] || 0xff000000;
        }

        // Air AO darkens the background under overhangs / caves
        if (aoAir) {
          const a = aoAir[i] | 0;
          if (a) bgCol = mulColorU32(bgCol, AO_MUL_LUT[a]);
        }

        // Foreground overlay pixels are only for EMPTY (snow rims, icicles, shadows)
        if (m === MAT.EMPTY) {
          if (fgOverlay) {
            const ov = fgOverlay[i];
            if (ov) bgCol = ov;
          }
          pix32[out++] = bgCol;
        } else {
          // --- material rendering ---
          const style = RSTYLE[m] || RSTYLE[MAT.ROCK];
          const edgeMode = style.edgeMode;

          // Packed-material texture pick (precomputed)
          const pi = tex4 ? (tex4[i] ^ ((m * 13) & 3)) & 3 : texPick4(i, wx, wy, m * 13);

          // Translucent steam: dither against background (no per-pixel hash)
          if (m === MAT.STEAM) {
            const fade = (G.life[i] & 255) / 255;
            // 0..255 threshold, based on stable dither + small time phase
            const phase = (G.frameId >> 1) & 3;
            const thr = (((((wx & 3) << 2) ^ ((wy & 3) << 1) ^ phase) & 15) * 17) | 0;
            const a = (fade * 255) | 0;
            // If steam pixel "wins" the dither, draw bright steam; else show background
            if (a > thr) {
              pix32[out++] = style.hi[pi];
            } else {
              pix32[out++] = bgCol;
            }

          } else if (m === MAT.FIRE) {
            // Fire: always emissive + flicker
            const flick = (G.frameId + (wx * 3) + (wy * 7)) & 3;
            pix32[out++] = flick ? style.hi[pi] : style.pal[pi];

          } else if (edgeMode === 'surface') {
            // Liquids: surface highlight
            const upEmpty = wy > 0 ? mat[i - W] === MAT.EMPTY : true;
            let col = upEmpty ? style.hi[pi] : style.pal[pi];
            // Lava glow, mild flicker
            if (m === MAT.LAVA) {
              const f = (G.frameId + (wx << 1) + (wy << 2)) & 7;
              col = f ? style.hi[pi] : style.pal[pi];
            }
            pix32[out++] = col;

          } else {
            // Solids / powders: directional + AO shaded 16-step ramp
            const upM = wy > 0 ? mat[i - W] : MAT.ROCK;
            const dnM = wy + 1 < H ? mat[i + W] : MAT.ROCK;
            const lfM = wx > 0 ? mat[i - 1] : MAT.ROCK;
            const rtM = wx + 1 < W ? mat[i + 1] : MAT.ROCK;

            const upEmpty = upM === MAT.EMPTY;
            const dnEmpty = dnM === MAT.EMPTY;
            const lfEmpty = lfM === MAT.EMPTY;
            const rtEmpty = rtM === MAT.EMPTY;

            // Base shade per material family
            let shade = 8;
            if (m === MAT.SNOW || m === MAT.PACKED_SNOW) shade = 11;
            else if (m === MAT.ICE) shade = 10;
            else if (m === MAT.DARK_ROCK) shade = 7;
            else if (m === MAT.SANDSTONE) shade = 8;
            else if (m === MAT.DIRT) shade = 8;
            else if (m === MAT.SAND) shade = 9;

            // Directional light: top-left
            if (upEmpty) shade += 3;
            if (lfEmpty) shade += 1;
            if (rtEmpty) shade -= 1;
            if (dnEmpty) shade -= 3;
            if (upEmpty && lfEmpty) shade += 1;
            if (dnEmpty && rtEmpty) shade -= 1;

            // Air AO: borrow from neighboring empty cells
            if (aoAir) {
              let a = 0;
              if (upEmpty) a = aoAir[i - W] | 0;
              if (lfEmpty) a = Math.max(a, aoAir[i - 1] | 0);
              if (rtEmpty) a = Math.max(a, aoAir[i + 1] | 0);
              if (dnEmpty) a = Math.max(a, aoAir[i + W] | 0);
              shade -= a >> 5; // 0..7
            }

            // Depth: slightly darker deeper down
            shade -= ((wy * 3) / H) | 0;

            // Chunk tone (subtle, controlled)
            if (CW && (rockTone || snowTone || iceTone)) {
              const ci = ((wx >> CSHIFT) + ((wy >> CSHIFT) * CW)) | 0;
              if ((m === MAT.ROCK || m === MAT.DARK_ROCK || m === MAT.SANDSTONE || m === MAT.DIRT) && rockTone) {
                const t = rockTone[ci] | 0;
                shade += (t * grainK) >> 7; // ~[-1..1]
              } else if ((m === MAT.SNOW || m === MAT.PACKED_SNOW) && snowTone) {
                const t = snowTone[ci] | 0;
                shade += (t * 5) >> 7;
              } else if (m === MAT.ICE && iceTone) {
                const t = iceTone[ci] | 0;
                shade += (t * 5) >> 7;
              }
            }

            // Ice streaks (vertical feel)
            if (m === MAT.ICE && iceStreakX) {
              const s = iceStreakX[wx] | 0; // [-7..8]
              shade += s >> 3; // ~[-1..1]
              if (((wy + (s & 7)) & 7) === 0) shade -= 1;
            }

            // Cracks / sparkles / specks (precomputed)
            if (detail) {
              const d = detail[i] | 0;
              if (d & 1) shade -= 2; // rock crack
              if (d & 2) shade -= 2; // ice crack
              if ((d & 4) && upEmpty) shade += 2; // snow sparkle
              if (d & 8) shade += 2; // mineral speck
            }

            if (shade < 0) shade = 0;
            else if (shade > 15) shade = 15;

            let col = style.shade16[(shade << 2) + pi];

            // Temperature tint (keep existing gameplay cues)
            const temp = G.temp ? G.temp[i] : 0;
            if (temp && m !== MAT.ICE) {
              // unpack
              let r = col & 255;
              let g = (col >>> 8) & 255;
              let b = (col >>> 16) & 255;
              const t = temp;
              if (t > 0) {
                r = clamp(r + (t >> 3), 0, 255);
                g = clamp(g + (t >> 5), 0, 255);
              } else {
                b = clamp(b + ((-t) >> 3), 0, 255);
              }
              col = 0xff000000 | (b << 16) | (g << 8) | r;
            }

            pix32[out++] = col;
          }
        }

        // advance
        wx++;
        i++;
        xb = SKY_P2 ? (xb + 1) & SKY_MASK : xb + 1 >= SKY_W ? 0 : xb + 1;
        x0 = SKY_P2 ? (x0 + 1) & SKY_MASK : x0 + 1 >= SKY_W ? 0 : x0 + 1;
        x1 = SKY_P2 ? (x1 + 1) & SKY_MASK : x1 + 1 >= SKY_W ? 0 : x1 + 1;
        x2 = SKY_P2 ? (x2 + 1) & SKY_MASK : x2 + 1 >= SKY_W ? 0 : x2 + 1;
        x3 = SKY_P2 ? (x3 + 1) & SKY_MASK : x3 + 1 >= SKY_W ? 0 : x3 + 1;
        xm = SKY_P2 ? (xm + 1) & SKY_MASK : xm + 1 >= SKY_W ? 0 : xm + 1;
      }
    }
  }

  G.renderWorld = renderWorld;

  /* =========================================================
     Crosshair & brush preview
     ========================================================= */
  function renderCrosshair() {
    const mouse = G.mouse;
    if (!mouse) return;
    const x = mouse.sx | 0;
    const y = mouse.sy | 0;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillRect(x - 3, y, 7, 1);
    ctx.fillRect(x, y - 3, 1, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(x - 1, y - 1, 3, 3);
  }
  G.renderCrosshair = renderCrosshair;

  function renderBrushPreview() {
    const mouse = G.mouse;
    if (!mouse || !mouse.right) return;
    const x = mouse.sx | 0;
    const y = mouse.sy | 0;
    const r = G.paintRadius | 0;

    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    for (let a = 0; a < 24; a++) {
      const t = (a / 24) * Math.PI * 2;
      const px0 = (x + Math.cos(t) * r) | 0;
      const py0 = (y + Math.sin(t) * r) | 0;
      if (px0 >= 0 && px0 < VIEW_W && py0 >= 0 && py0 < VIEW_H) ctx.fillRect(px0, py0, 1, 1);
    }
  }
  G.renderBrushPreview = renderBrushPreview;

  /* =========================================================
     PostFX (subtle) - does NOT affect UI (drawn before UI)
     ========================================================= */
  G.postFX = true;

  function renderPostFX() {
    if (!G.postFX) return;

    const player = G.player;
    const camera = G.camera;

    const pxs = (player.x - camera.x);
    const pys = (player.y - camera.y - player.h * 0.7);

    const g = ctx.createRadialGradient(pxs, pys, 26, pxs, pys, 170);
    g.addColorStop(0.0, 'rgba(0,0,0,0.00)');
    g.addColorStop(0.70, 'rgba(0,0,0,0.12)');
    g.addColorStop(1.0, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // small light sampling (cheap)
    // Deterministic (no RNG state mutation)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const tL = (G.frameId | 0) >> 3;
    for (let k = 0; k < 26; k++) {
      const h = (G.hash2i(k, ((G.seed ^ 0x6d2b79f5) + tL) | 0) >>> 0);
      const sx = (h % VIEW_W) | 0;
      const sy = ((h >>> 16) % VIEW_H) | 0;
      const wx = (camera.x | 0) + sx;
      const wy = (camera.y | 0) + sy;
      const m2 = G.mat[G.idx(wx, wy)];
      if (m2 === MAT.FIRE || m2 === MAT.LAVA) {
        const r = (m2 === MAT.LAVA) ? 54 : 38;
        const gg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        gg.addColorStop(0, 'rgba(255,190,110,0.16)');
        gg.addColorStop(1, 'rgba(255,190,110,0.00)');
        ctx.fillStyle = gg;
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      }
    }
    ctx.restore();

    // Outdoor snow (simple overlay)
    // Set G.snowFX = false to disable.
    if (G.snowFX !== false && player && G.surfaceY) {
      const px = player.x | 0;
      const surf = G.surfaceY[px] | 0;
      const outdoor = (surf > 0 && player.y < surf + 48);
      if (outdoor && G.biomeAt(px, (surf + 10) | 0) === G.BIOME.SNOW) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        const t = G.frameId | 0;
        const nFlakes = 120;
        for (let k = 0; k < nFlakes; k++) {
          const h = G.hash2i(k, (G.seed ^ 0x9e3779b9) | 0) >>> 0;
          const x0 = (h % VIEW_W) | 0;
          const sp = 1 + ((h >>> 12) & 3);
          const y0 = (((h >>> 16) + t * sp) % VIEW_H) | 0;
          const drift = (((h >>> 8) & 15) - 7);
          const xd = (x0 + ((t >> 3) + drift)) % VIEW_W;
          ctx.fillRect(xd, y0, 1, 1);
          if (((h >>> 20) & 7) === 0) ctx.fillRect((xd + 1) % VIEW_W, y0, 1, 1);
        }
        ctx.restore();
      }
    }

    // Outdoor rain (simple overlay)
    // Set G.rainFX = false to disable.
    if (G.rainFX !== false && player && G.surfaceY) {
      const px = player.x | 0;
      const surf = G.surfaceY[px] | 0;
      const outdoor = (surf > 0 && player.y < surf + 48);
      if (outdoor) {
        const b = G.biomeAt(px, (surf + 10) | 0);
        if (b === G.BIOME.MINES || b === G.BIOME.TOXIC) {
          const isToxic = (b === G.BIOME.TOXIC);
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.fillStyle = isToxic ? 'rgba(120,255,150,0.10)' : 'rgba(170,190,255,0.08)';

          const t = G.frameId | 0;
          const nDrops = isToxic ? 140 : 170;
          for (let k = 0; k < nDrops; k++) {
            const h = G.hash2i(k, (G.seed ^ 0x1234abcd) | 0) >>> 0;
            const x0 = (h % VIEW_W) | 0;
            const sp = 3 + ((h >>> 12) & 3);
            const y0 = (((h >>> 16) + t * sp) % VIEW_H) | 0;

            // slight diagonal drift to avoid a static look
            const drift = (((h >>> 8) & 15) - 7);
            const wind = isToxic ? -1 : 1;
            const xd = (x0 + ((t >> 2) * wind) + drift) % VIEW_W;

            // draw a short streak
            ctx.fillRect(xd, y0, 1, isToxic ? 5 : 6);
          }
          ctx.restore();
        }
      }
    }

  }
  G.renderPostFX = renderPostFX;

  /* =========================================================
     Wizard sprite (procedural) — V2 (rig + springs + redraw)
     ========================================================= */
  const WZ = {
    OUT: '#0a0b11',
    SK1: '#e7c09b',
    SK2: '#c99368',
    PUR1: '#7b2cc4',
    PUR2: '#4c1976',
    PUR3: '#a56af0',
    PUR4: '#2c0e46',
    GR1: '#c9c9d8',
    GR2: '#eeeeff',
    GR3: '#8e8ea0',
    BO1: '#2a1a13',
    BO2: '#3b2419',
    ST1: '#6b4221',
    ST2: '#b57b3e',
    GD1: '#d6b24a',
    GD2: '#f3dc7a',
    EY: '#0b0b0b',
    MA: '#4cff6a',
    MA2: '#b8ffcb',
  };

  function px(x, y, c) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, 1, 1); }
  function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w | 0, h | 0); }
  function row(x, y, len, c) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, len | 0, 1); }

  function rectO(x, y, w, h, fill) {
    ctx.fillStyle = WZ.OUT;
    ctx.fillRect((x - 1) | 0, (y - 1) | 0, (w + 2) | 0, (h + 2) | 0);
    ctx.fillStyle = fill;
    ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  }

  // Silhouette scanline (outline 1px)
  function drawSil(rows, ox, oy, fill) {
    ctx.fillStyle = WZ.OUT;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      ctx.fillRect((ox + r[0] - 1) | 0, (oy + r[1]) | 0, (r[2] + 2) | 0, 1);
    }
    ctx.fillStyle = fill;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      ctx.fillRect((ox + r[0]) | 0, (oy + r[1]) | 0, (r[2]) | 0, 1);
    }
  }

  // Bresenham line (pixel-perfect)
  function linePx(x0, y0, x1, y1, c) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    while (true) {
      px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = err << 1;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // --- Anim state (springs = inertie cape/chapeau/barbe/staff)
  const wizAnim = {
    t: 0,
    phase: 0,
    cloak: { x: 0, v: 0 },
    hat: { x: 0, v: 0 },
    beard: { x: 0, v: 0 },
    staff: { x: 0, v: 0 },
  };

  function wizSpring(s, target, k = 0.22, d = 0.72) {
    s.v += (target - s.x) * k;
    s.v *= d;
    s.x += s.v;
  }

  function updateWizardAnim(dt) {
    wizAnim.t += dt;

    const player = G.player;
    if (!player) return;
    const wizard = G.wizard;

    // 1. REVERT FACING (Velocity Based)
    // Always face movement direction if moving
    if (Math.abs(player.vx) > 1) {
      wizard.facing = Math.sign(player.vx);
    }
    // (Optional) If idle, could face mouse, but let's stick to velocity for now to match request "instead of backwards"

    // Smooth Flip
    if (wizard.visualFacing === undefined) wizard.visualFacing = wizard.facing;
    const fDiff = wizard.facing - wizard.visualFacing;
    wizard.visualFacing += fDiff * Math.min(1, dt * 15);
    if (Math.abs(wizard.visualFacing - wizard.facing) < 0.01) wizard.visualFacing = wizard.facing;

    // 2. AIM (Calculated in Render for precision)
    // Removed stateful logic to avoid lag/desync.

    // Smooth Flip (Visual)
    if (wizard.visualFacing === undefined) wizard.visualFacing = wizard.facing;
    // ... existing flip logic ...

    const speed01 = G.clamp(Math.abs(player.vx) / 70, 0, 1);
    const onGround = player.onGround;
    const running = onGround && speed01 > 0.10;

    // Timing
    const omega = running ? (8 + 10 * speed01) : 2.2;
    const castSlow = (player.castT > 0.001) ? 0.55 : 1.0;

    // Standard playback speed (no reverse)
    wizAnim.phase += omega * dt * castSlow;

    // PROCEDURAL TILT
    const targetTilt = -player.vx * 0.15; // deg
    if (wizard.tilt === undefined) wizard.tilt = 0;
    wizard.tilt += (targetTilt - wizard.tilt) * dt * 5;

    // SQUASH & STRETCH
    if (wizard.scale === undefined) wizard.scale = { x: 1, y: 1 };
    // Return to 1,1
    wizard.scale.x += (1 - wizard.scale.x) * dt * 10;
    wizard.scale.y += (1 - wizard.scale.y) * dt * 10;

    if (!onGround && wizard.wasOnGround) {
      // Jump Start -> Stretch Y
      wizard.scale.x = 0.8; wizard.scale.y = 1.3;
    }
    if (onGround && !wizard.wasOnGround) {
      // Land -> Squash Y
      wizard.scale.x = 1.4; wizard.scale.y = 0.7;
    }
    wizard.wasOnGround = onGround;

    // Normalisations vitesse
    const vxl = G.clamp(player.vx / 70, -1, 1);
    const vyl = G.clamp(player.vy / 260, -1, 1);

    // “Follow-through”
    const cloakT = G.clamp(-vxl * 0.85 + vyl * 0.25, -1, 1);
    const hatT = G.clamp(-vxl * 0.35 + vyl * 0.10, -1, 1);
    const beardT = G.clamp(-vxl * 0.25 + vyl * 0.22, -1, 1);
    const staffT = (player.castT > 0.001 ? -0.8 : 0) + G.clamp(-vxl * 0.15, -0.6, 0.6);

    wizSpring(wizAnim.cloak, cloakT, 0.20, 0.70);
    wizSpring(wizAnim.hat, hatT, 0.25, 0.74);
    wizSpring(wizAnim.beard, beardT, 0.20, 0.70);
    wizSpring(wizAnim.staff, staffT, 0.30, 0.76);
  }
  // Wizard animation may be provided by another module (ex: SDF rig).
  // Keep this as a legacy fallback.
  if (!G.updateWizardAnim) G.updateWizardAnim = updateWizardAnim;
  else G.updateWizardAnimLegacy = updateWizardAnim;

  // --- Shapes (scanlines)
  const WZ_TAIL = [
    [1, 0, 3],
    [0, 1, 4],
    [0, 2, 5],
    [0, 3, 5],
    [1, 4, 6],
    [2, 5, 6],
    [2, 6, 5],
    [3, 7, 4],
    [4, 8, 3],
  ];

  const WZ_BEARD = [
    [-3, 0, 6],
    [-4, 1, 7],
    [-5, 2, 8],
    [-5, 3, 8],
    [-4, 4, 7],
    [-4, 5, 7],
    [-3, 6, 6],
    [-2, 7, 5],
  ];

  const WZ_ROBE_UP = [
    [-5, -21, 10],
    [-6, -20, 12],
    [-6, -19, 12],
    [-6, -18, 12],
    [-7, -17, 14],
    [-7, -16, 14],
    [-7, -15, 14],
    [-8, -14, 16],
    [-8, -13, 16],
  ];

  const WZ_ROBE_LO = [
    [-8, -12, 16],
    [-8, -11, 16],
    [-8, -10, 16],
    [-8, -9, 16],
    [-8, -8, 16],
    [-8, -7, 16],
    [-8, -6, 16],
    [-8, -5, 16],
    [-7, -4, 14],
    [-6, -3, 12],
  ];

  function drawWizard(screenX, screenY) {
    const player = G.player;
    const wizard = G.wizard;

    const sx = Math.round(screenX);
    const sy = Math.round(screenY);

    const speed = Math.abs(player.vx);
    const speed01 = G.clamp(speed / 70, 0, 1);
    const running = player.onGround && speed > 10;
    const jumping = !player.onGround;
    const casting = player.castT > 0.001;

    const p = wizAnim.phase;
    const s1 = Math.sin(p);
    const s2 = Math.sin(p * 2);

    // cast easing (0..1)
    const castP = casting ? G.clamp(1 - player.castT / 0.22, 0, 1) : 0;
    const castEase = castP * castP * (3 - 2 * castP);

    // Body motion
    const idleBreath = (!running && !jumping) ? Math.sin(wizAnim.t * 2.2) * 1.0 : 0;
    const runBob = running ? (s2 * (1.2 + 0.8 * speed01)) : 0;
    const bob = Math.round(idleBreath + runBob);

    const leanFwd = running ? (1 + 2 * speed01) : 0;
    const recoil = casting ? (-1.2 * castEase) : 0;
    const lean = Math.round(leanFwd + recoil);

    // Secondary motion -> pixels
    const cloakX = Math.round(G.clamp(wizAnim.cloak.x, -1, 1) * 3);
    const hatX = Math.round(G.clamp(wizAnim.hat.x, -1, 1) * 2);
    const beardX = Math.round(G.clamp(wizAnim.beard.x, -1, 1) * 2);

    // Run feet
    let footA = 0, footB = 0, liftA = 0, liftB = 0;
    if (running) {
      const stride = 2 + 2 * speed01;
      footA = Math.round(s1 * stride);
      footB = Math.round(-s1 * stride);
      liftA = Math.round(Math.max(0, s1) * 2);
      liftB = Math.round(Math.max(0, -s1) * 2);
    }
    // Jump tuck
    if (jumping) {
      const tuck = G.clamp(-player.vy / 120, 0, 1);
      liftA = liftB = 2 + Math.round(tuck * 2);
      footA = 1; footB = -1;
    }

    // Arms swing
    let armFront = 0, armBack = 0;
    if (running) {
      armFront = Math.round(Math.sin(p + 0.5) * 2);
      armBack = Math.round(Math.sin(p + 0.5 + Math.PI) * 1);
    }
    if (casting) {
      armFront = Math.round(-2 - 3 * castEase);
      armBack = Math.round(-1 - 2 * castEase);
    }
    if (jumping && !casting) {
      armFront = -2;
      armBack = -2;
    }

    // Staff motion
    const staffRaise = Math.round((-7 * castEase) + (wizAnim.staff.x * 2));
    const staffTilt = (casting ? -2 : (running ? -1 : 0));

    // Blink (rare, only idle)
    const blink = (!running && !jumping && !casting && ((G.frameId + (G.seed & 255)) % 140) < 3);

    const scale = wizard.scale || { x: 1, y: 1 };
    const tilt = wizard.tilt || 0;
    const vFacing = wizard.visualFacing || player.facing;

    ctx.save();
    ctx.translate(sx, sy);

    // Scale X for facing + Squash/Stretch
    ctx.scale(vFacing * scale.x, scale.y);

    // Tilt (Rotate entire body)
    ctx.rotate((tilt * Math.PI) / 180);

    ctx.translate(lean, -bob);

    // --- STAFF "SOULE" OVERRIDE ---
    // We modify the staff rotation or position based on wizard.staffBias
    // If bias is high, we rotate the staff 'backward' relative to the wizard.
    // Standard staff is roughly upright. 
    // We want it to point towards -MouseX. Since we are flipped by `vFacing`, "Backward" is always screen-opposite.
    // Actually, if we are flipped Right, Back is Left.
    // If we are flipped Left, Back is Right.
    // So "Back" is always opposite to forward.
    // Let's add a rotation to the arm/staff logic later in the draw stack?
    // OR we can just modify `wizAnim.staff` parameters if possible. 
    // But `wizAnim.staff` is a spring system.
    // Provide a rotational offset to the staff rendering.

    const souleRot = (wizard.staffBias || 0) * 2.5; // Radians? No, let's say scaling factor for "drag"
    // Actually we need to rotate the *staff* drawing itself.
    // Let's pass this down or modify `staffTilt` below.

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(-8, -1, 16, 2);

    // Cape tail
    {
      const tx = -12 + cloakX;
      const ty = -19 + Math.round(s2 * 0.5 * speed01);
      drawSil(WZ_TAIL, tx, ty, WZ.PUR2);
      rect(tx + 2, ty + 3, 1, 3, WZ.PUR3);
      rect(tx + 1, ty + 6, 1, 2, WZ.PUR4);
    }

    // Boots
    {
      const bx = -4 + footB;
      const by = -2 - liftB;
      rect(bx - 1, by - 1, 5, 3, WZ.OUT);
      rect(bx, by, 3, 2, WZ.BO1);
      row(bx, by + 1, 3, WZ.BO2);

      const fx = 2 + footA;
      const fy = -2 - liftA;
      rect(fx - 1, fy - 1, 5, 3, WZ.OUT);
      rect(fx, fy, 3, 2, WZ.BO1);
      row(fx, fy + 1, 3, WZ.BO2);

      if (running && liftA === 0 && (G.frameId & 15) === 0) {
        px(fx + 1, -1, 'rgba(255,255,255,0.08)');
      }
    }

    // Robe lower sway
    {
      const swayX = running ? Math.round(s1 * 1) : 0;
      const swayY = running ? Math.round(s2 * 1) : 0;
      drawSil(WZ_ROBE_LO, swayX, swayY, WZ.PUR1);

      rect(-8 + swayX, -12 + swayY, 4, 9, WZ.PUR4);
      rect(-1 + swayX, -12 + swayY, 2, 9, WZ.PUR3);
      rect(3 + swayX, -11 + swayY, 1, 7, WZ.PUR3);
    }

    // Robe upper
    {
      drawSil(WZ_ROBE_UP, 0, 0, WZ.PUR1);

      rect(-6, -20, 3, 8, WZ.PUR4);
      rect(0, -19, 2, 7, WZ.PUR3);
      rect(3, -19, 1, 5, WZ.PUR3);

      rect(-7, -11, 14, 2, WZ.PUR2);
      rect(-1, -11, 3, 2, WZ.GD1);
      px(0, -10, WZ.GD2);
    }

    // Arms
    {
      rectO(-8, -17 + armBack, 2, 5, WZ.PUR1);
      rectO(-8, -12 + armBack, 2, 2, WZ.SK1);

      rectO(5, -17 + armFront, 3, 5, WZ.PUR1);
      rectO(5, -12 + armFront, 2, 2, WZ.SK1);

      // Staff (in front hand)
      ctx.save();
      // Pivot at hand (approx 6, -11 + armFront)
      const pivX = 6;
      const pivY = -11 + armFront;
      ctx.translate(pivX, pivY);

      // STATELESS ROBUST AIM (Inverse Matrix)
      // Transforms Mouse Screen Coords -> Local Hand Space
      // This handles Scale, Face, Tilt, Sway, and Pivot automatically.
      let aimRot = 0;

      if (G.mouse && G.mouse.sx !== undefined) {
        try {
          // Get current transform matrix (World -> Hand)
          const transform = ctx.getTransform();
          // Invert it (Hand -> World) -> (World -> Hand) ?? 
          // Wait. Transform is Local -> Screen. We want Screen -> Local.
          // So we want the Inverse of the Current Transform.
          const inv = transform.inverse();

          // Transform Mouse Point to Local Space
          const p = new DOMPoint(G.mouse.sx, G.mouse.sy).matrixTransform(inv);

          // Calculate angle in local space
          // Standard: Right is 0. Up is -PI/2.
          // Staff points DOWN (+PI/2).
          // We want Staff to point at P.
          // Theta = atan2(y, x).
          // Rotation needed = Theta - (StartAngle). StartAngle = PI/2.
          aimRot = Math.atan2(p.y, p.x) - Math.PI / 2;

        } catch (e) {
          console.error("Matrix Aim Error", e);
        }
      }

      const wobble = (staffTilt * 0.1);

      ctx.rotate(aimRot + wobble);

      // Draw Staff relative to Pivot
      // Staff is long stick. Handle at 0,0.
      ctx.fillStyle = WZ.ST1;
      ctx.fillRect(-1, -6 + staffRaise, 2, 28); // Main shaft

      // Orb/Top
      ctx.fillStyle = WZ.GD1;
      ctx.fillRect(-2, -9 + staffRaise, 4, 3);
      ctx.fillStyle = WZ.MA;
      ctx.fillRect(-1, -8 + staffRaise, 2, 1);

      ctx.restore();
      if (casting) {
        const staffX = 10; // This staffX is relative to the wizard, not the pivoted staff.
        const topY = -34 + staffRaise; // This topY is relative to the wizard, not the pivoted staff.
        px(staffX + staffTilt, topY - 4, WZ.MA2);
        px(staffX + staffTilt + 1, topY - 4, WZ.MA);
        if ((G.frameId & 1) === 0) {
          const wx = player.x + player.facing * 10;
          const wy = player.y - player.h * 0.90;
          G.spawnParticle(wx, wy, (G.rand01() * 2 - 1) * 25, -40 - G.rand01() * 40, 0.22 + G.rand01() * 0.22, 0xffb8ffcb);
        }
      }
    }

    // Head
    {
      const hx = -1, hy = -28;
      rect(hx - 4, hy - 1, 9, 7, WZ.OUT);
      rect(hx - 3, hy, 7, 5, WZ.SK1);
      rect(hx - 3, hy + 2, 2, 2, WZ.SK2);

      if (!blink) px(hx + 2, hy + 2, WZ.EY);
      else { px(hx + 1, hy + 3, WZ.EY); px(hx + 2, hy + 3, WZ.EY); }

      px(hx + 3, hy + 3, WZ.SK2);
    }

    // Beard
    {
      const bx = beardX;
      const by = -23;
      drawSil(WZ_BEARD, bx, by, WZ.GR1);
      rect(-1 + bx, by + 1, 1, 6, WZ.GR2);
      rect(-4 + bx, by + 2, 1, 6, WZ.GR3);
    }

    // Hat
    {
      const tip = hatX;
      const brimY = -30;

      const BRIM = [
        [-9, brimY, 18],
        [-8, brimY + 1, 16],
        [-7, brimY + 2, 14],
      ];
      drawSil(BRIM, 0, 0, WZ.PUR2);
      row(-6, brimY + 1, 12, WZ.GD1);

      for (let r = 0; r < 10; r++) {
        const w = 4 + r;
        const x0 = (-(w >> 1) + ((r >> 2))) + (tip >> 1);
        const y0 = -40 + r;
        row(x0 - 1, y0, w + 2, WZ.OUT);
        row(x0, y0, w, (r < 3 ? WZ.PUR3 : WZ.PUR1));
      }

      px(-2, brimY + 2, WZ.PUR3);
      px(-1, brimY + 2, WZ.PUR3);
    }

    ctx.restore();
  }
  if (!G.drawWizard) G.drawWizard = drawWizard;
  else G.drawWizardLegacy = drawWizard;

  // ---------------------------------------------------------
  // Level generation debug overlay
  // (toggle with F2)
  // ---------------------------------------------------------
  function renderLevelGenDebug(camX, camY) {
    const dbg = G.levelGenDebug;
    if (!dbg) return;

    const ctx = G.ctx;
    ctx.save();

    // Rooms
    if (dbg.rooms && dbg.rooms.length) {
      ctx.strokeStyle = 'rgba(0,255,120,0.85)';
      for (const r of dbg.rooms) {
        const x = (r.x - (r.w >> 1) - camX) | 0;
        const y = (r.y - (r.h >> 1) - camY) | 0;
        const w = r.w | 0;
        const h = r.h | 0;
        if (x + w < 0 || y + h < 0 || x > VIEW_W || y > VIEW_H) continue;
        ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      }
    }

    // Corridors (polylines)
    if (dbg.corridors && dbg.corridors.length) {
      ctx.strokeStyle = 'rgba(0,180,255,0.85)';
      for (const c of dbg.corridors) {
        const pts = c.points;
        if (!pts || pts.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo((pts[0].x - camX) | 0, (pts[0].y - camY) | 0);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo((pts[i].x - camX) | 0, (pts[i].y - camY) | 0);
        }
        ctx.stroke();
      }
    }

    // Validated path (coarse grid)
    const vg = dbg.validation;
    if (vg && vg.path && vg.path.length) {
      const ds = vg.ds | 0;
      const gw = vg.gridW | 0;
      ctx.strokeStyle = 'rgba(255,235,80,0.9)';
      ctx.beginPath();
      for (let i = 0; i < vg.path.length; i += 2) {
        const id = vg.path[i] | 0;
        const gx = id % gw;
        const gy = (id / gw) | 0;
        const wx = (gx * ds + (ds >> 1)) | 0;
        const wy = (gy * ds + (ds >> 1)) | 0;
        const sx = (wx - camX) | 0;
        const sy = (wy - camY) | 0;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // Spawn / goal markers
    if (dbg.spawn) {
      const sx = (dbg.spawn.x - camX) | 0;
      const sy = (dbg.spawn.y - camY) | 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(sx - 6, sy);
      ctx.lineTo(sx + 6, sy);
      ctx.moveTo(sx, sy - 6);
      ctx.lineTo(sx, sy + 6);
      ctx.stroke();
    }
    if (dbg.goal) {
      const sx = (dbg.goal.x - camX) | 0;
      const sy = (dbg.goal.y - camY) | 0;
      ctx.strokeStyle = 'rgba(255,120,120,0.9)';
      ctx.beginPath();
      ctx.moveTo(sx - 6, sy);
      ctx.lineTo(sx + 6, sy);
      ctx.moveTo(sx, sy - 6);
      ctx.lineTo(sx, sy + 6);
      ctx.stroke();
    }

    ctx.restore();
  }

  /* =========================================================
     Final render
     ========================================================= */
  function render() {
    const camera = G.camera;

    // 1) world into pix32
    renderWorld(camera.x, camera.y);

    // 2) particles into pix32 (single putImageData)
    // 2) particles into pix32 (single putImageData)
    for (const p of G.particles) {
      const sx = (p.x - camera.x) | 0;
      const sy = (p.y - camera.y) | 0;
      if (sx >= 0 && sx < VIEW_W && sy >= 0 && sy < VIEW_H) {
        const col = p.col >>> 0;
        pix32[sy * VIEW_W + sx] = col;

        // Voluminous (Size > 1) -> Draw 2x2 block
        if (p.size && p.size > 1) {
          if (sx + 1 < VIEW_W) pix32[sy * VIEW_W + (sx + 1)] = col;
          if (sy + 1 < VIEW_H) pix32[(sy + 1) * VIEW_W + sx] = col;
          if (sx + 1 < VIEW_W && sy + 1 < VIEW_H) pix32[(sy + 1) * VIEW_W + (sx + 1)] = col;
        }
      }
    }

    // 2b) material particles (real matter in flight)
    if (G.matParticles && G.matParticles.length) {
      for (const p of G.matParticles) {
        const sx = (p.x - camera.x) | 0;
        const sy = (p.y - camera.y) | 0;
        if (sx >= 0 && sx < VIEW_W && sy >= 0 && sy < VIEW_H) {
          pix32[sy * VIEW_W + sx] = (p.col >>> 0) || 0xffffffff;
        }
      }
    }

    ctx.putImageData(img, 0, 0);

    // 3) projectiles
    for (const p of G.projectiles) {
      const sx = (p.x - camera.x);
      const sy = (p.y - camera.y);
      if (sx >= 0 && sx < VIEW_W && sy >= 0 && sy < VIEW_H) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sx | 0, sy | 0, 1, 1);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect((sx - p.vx * 0.02) | 0, (sy - p.vy * 0.02) | 0, 1, 1);
      }
    }

    // 4) wizard
    // Prefer a globally-registered wizard renderer (ex: SDF rig),
    // fallback to the legacy scanline wizard.
    const dw = G.drawWizard || drawWizard;
    dw(G.player.x - camera.x, G.player.y - camera.y);

    // 5) postFX (before UI)
    renderPostFX();

    // 5b) Level-gen debug overlay (rooms / corridors / validated path)
    if (G.UI?.showGenDebug) renderLevelGenDebug(camera.x, camera.y);

    // 6) crosshair/UI
    renderCrosshair();
    renderBrushPreview();
    if (G.renderHUD) G.renderHUD();
    if (G.renderHelp) G.renderHelp();
    if (G.renderGenDebug) G.renderGenDebug();
    if (G.renderMenu) G.renderMenu();

    if (G._booting) {
      if (G.setLoading) G.setLoading('Ready', 1);
      if (G.finishLoading) G.finishLoading();
      G._booting = false;
    }
  }
  G.render = render;
})();
