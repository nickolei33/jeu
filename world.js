'use strict';
(() => {
  const G = (window.G = window.G || {});
  const { WORLD_W: W, WORLD_H: H } = G.CONF;
  const { MAT } = G;

  // When true, generation helpers use raw writes and we rebuild metadata at the end.
  G._bulkGen = false;

  // ------------------------------
  // World buffers
  // ------------------------------
  const N = W * H;
  G.mat = new Uint8Array(N);
  G.life = new Uint16Array(N);
  // Temperature buffers (int16 in °C-ish units)
  G.temp = new Int16Array(N);
  G.temp2 = new Int16Array(N);
  G.stamp = new Uint32Array(N);
  G.frameId = 1;
  // Background decorations (visual-only, rendered behind terrain)
  // 0 = none, else packed RGBA (Uint32)
  G.bgDeco = new Uint32Array(N);

  // Surface masks
  G.grassMask = new Uint8Array(N);

  // Surface profile (used for sky rendering / outdoor ambience)
  G.surfaceY = new Int16Array(W);
  G.surfaceBiome = new Uint8Array(W);
  G.soilThickness = new Uint8Array(W);


  G.idx = (x, y) => (x | 0) + (y | 0) * W;
  G.inb = (x, y) => x >= 0 && x < W && y >= 0 && y < H;

  // ------------------------------
  // Chunk meta (simulation scheduling)
  // ------------------------------
  const CS = (G.CONF.CHUNK_SIZE | 0) || 32;
  const isPow2 = (v) => v > 0 && (v & (v - 1)) === 0;
  G.assert(isPow2(CS), 'CONF.CHUNK_SIZE must be a power-of-two');
  const CSHIFT = (Math.log2(CS) | 0);
  const CW = Math.ceil(W / CS);
  const CH = Math.ceil(H / CS);
  const CN = CW * CH;

  G.CHUNK = { SIZE: CS, SHIFT: CSHIFT, W: CW, H: CH, N: CN };

  // TTL-style activity: chunks decay to 0 when nothing changes.
  G.chunkTTL = new Uint8Array(CN);
  // Always-update count (fire/steam/lava/acid etc.)
  G.chunkAlways = new Int16Array(CN);
  // Region stamp to detect newly-entering chunks
  G.chunkLastInRegion = new Uint32Array(CN);

  G.chunkIndexXY = (x, y) => ((x >> CSHIFT) + (y >> CSHIFT) * CW) | 0;
  G.chunkIndexI = (i) => {
    if (G._W_IS_POW2) {
      const x = i & G._W_MASK;
      const y = i >> G._W_SHIFT;
      return ((x >> CSHIFT) + (y >> CSHIFT) * CW) | 0;
    }
    const y = (i / W) | 0;
    const x = i - y * W;
    return ((x >> CSHIFT) + (y >> CSHIFT) * CW) | 0;
  };

  const ACTIVE_TTL = 5;
  G.markChunkActive = (ci, ttl = ACTIVE_TTL) => {
    if (ci < 0 || ci >= CN) return;
    if (G.chunkTTL[ci] < ttl) G.chunkTTL[ci] = ttl;
  };

  G.safeGet = (x, y, out = MAT.ROCK) => {
    if (!G.inb(x, y)) return out;
    return G.mat[G.idx(x, y)];
  };

  // Set cell with optional flags.
  // flags:
  //  - 1: KEEP_TEMP (do not touch temperature)
  //  - 2: SET_AMBIENT (force temperature to ambient/source)
  G.SET_KEEP_TEMP = 1;
  G.SET_AMBIENT = 2;

  G.setIndex = (i, m, life = 0, flags = 0) => {
    if (i < 0 || i >= N) return;
    const old = G.mat[i];
    if (old === m && (life | 0) === (G.life[i] | 0) && flags === 0) return;

    const ci = G.chunkIndexI(i);
    // chunkAlways bookkeeping
    const ao = G.alwaysUpdate[old] | 0;
    const an = G.alwaysUpdate[m] | 0;
    if (ao !== an) G.chunkAlways[ci] += (an - ao);

    G.mat[i] = m;
    G.life[i] = life;

    // temperature policy
    if ((flags & G.SET_KEEP_TEMP) === 0) {
      if (G.hasTempTarget[m]) {
        G.temp[i] = G.tempTarget[m];
      } else if (flags & G.SET_AMBIENT) {
        // ambientTempAt is defined by temperature.js; fallback to 20°C.
        const xy = G.xyFromIndex(i);
        const amb = (typeof G.ambientTempAt === 'function') ? G.ambientTempAt(xy.x, xy.y) : 20;
        G.temp[i] = amb | 0;
      }
    }

    // schedule chunk
    G.markChunkActive(ci);
  };

  G.setCell = (x, y, m, life = 0, flags = 0) => {
    if (!G.inb(x, y)) return;
    G.setIndex(G.idx(x, y), m, life, flags);
  };

  G.swapCells = (i, j) => {
    const mi = G.mat[i];
    const mj = G.mat[j];

    const li = G.life[i];
    const lj = G.life[j];

    // swap material
    G.mat[i] = mj;
    G.mat[j] = mi;
    G.life[i] = lj;
    G.life[j] = li;

    // swap temperature (material carries its heat)
    const ti = G.temp[i];
    G.temp[i] = G.temp[j];
    G.temp[j] = ti;

    // chunk bookkeeping if crossing chunks
    const ci = G.chunkIndexI(i);
    const cj = G.chunkIndexI(j);
    if (ci !== cj) {
      const a_i = G.alwaysUpdate[mi] | 0;
      const a_j = G.alwaysUpdate[mj] | 0;
      // After swap: chunk ci receives mj, chunk cj receives mi.
      if (a_i !== a_j) {
        G.chunkAlways[ci] += (a_j - a_i);
        G.chunkAlways[cj] += (a_i - a_j);
      }
    }
    G.markChunkActive(ci);
    G.markChunkActive(cj);

    G.stamp[i] = G.frameId;
    G.stamp[j] = G.frameId;
  };

  G.clearWorld = () => {
    G.mat.fill(MAT.EMPTY);
    G.life.fill(0);
    G.temp.fill(20);
    // stamp/frameId can just continue; keeping them avoids full clears each reset
    G.chunkTTL.fill(0);
    G.chunkAlways.fill(0);
    G.chunkLastInRegion.fill(0);

    // visual-only buffers
    if (G.bgDeco) G.bgDeco.fill(0);
    if (G.grassMask) G.grassMask.fill(0);
    if (G.soilThickness) G.soilThickness.fill(0);
    if (G.surfaceY) G.surfaceY.fill(0);
    if (G.surfaceBiome) G.surfaceBiome.fill(0);
  };

  // Recompute chunk metadata (call after bulk generation/reset)
  G.rebuildChunkMeta = () => {
    G.chunkTTL.fill(0);
    G.chunkAlways.fill(0);
    for (let i = 0; i < N; i++) {
      if (G.alwaysUpdate[G.mat[i]]) {
        const ci = G.chunkIndexI(i);
        G.chunkAlways[ci]++;
      }
    }
  };

  // ------------------------------
  // Biomes (2D chunk map)
  // ------------------------------
  G.BIOME = { SNOW: 0, MINES: 1, DESERT: 2, TOXIC: 3 };

  const BIO_CELL = 32;
  const BIO_W = Math.ceil(W / BIO_CELL);
  const BIO_H = Math.ceil(H / BIO_CELL);
  const biomeChunk = new Uint8Array(BIO_W * BIO_H);
  G.biomeChunk = biomeChunk;

  G.biomeAt = (wx, wy) => {
    // Clamp to avoid negative indexing surprises.
    const cx = G.clamp(wx >> 5, 0, BIO_W - 1);
    const cy = G.clamp(wy >> 5, 0, BIO_H - 1);
    return biomeChunk[cx + cy * BIO_W];
  };

  function computeBiomes2D() {
    for (let cy = 0; cy < BIO_H; cy++) {
      for (let cx = 0; cx < BIO_W; cx++) {
        const wx = cx * BIO_CELL + 13;
        const wy = cy * BIO_CELL + 21;
        const n = G.valueNoise2D(wx + 9000, wy + 1234, 520);

        // Base distribution (keeps variety underground)
        let b = G.BIOME.MINES;
        if (n < 0.22) b = G.BIOME.SNOW;
        else if (n < 0.54) b = G.BIOME.MINES;
        else if (n < 0.80) b = G.BIOME.DESERT;
        else b = G.BIOME.TOXIC;

        const depth01 = wy / H;

        // Altitude bias: top part of the world tends to be SNOW
        // (gives the "mountain + neige" look more often, especially near spawn).
        const snowBand = G.clamp((0.36 - depth01) / 0.36, 0, 1); // 0..1 in top 36%
        if (snowBand > 0) {
          const nn = G.valueNoise2D(wx + 3333, wy + 7777, 180);
          // At the very top: mostly snow; fades into mixed biomes.
          if (nn < (0.38 + snowBand * 0.45)) b = G.BIOME.SNOW;
          else if (snowBand > 0.75 && b === G.BIOME.TOXIC) b = G.BIOME.MINES;
        }

        // Guarantee a snowy start region around the spawn (visual identity).
        const spawnX = (W * 0.5) | 0;
        if (depth01 < 0.48 && Math.abs(wx - spawnX) < (W * 0.22)) {
          b = G.BIOME.SNOW;
        }

        // Depth bias: deeper tends to toxic/mines, less desert
        if (depth01 > 0.68 && b === G.BIOME.DESERT) b = G.BIOME.MINES;
        if (depth01 > 0.78) {
          const t = (depth01 - 0.78) / 0.22;
          const nn2 = G.valueNoise2D(wx + 4444, wy + 9999, 240);
          if (nn2 < (0.18 + 0.32 * t)) b = G.BIOME.TOXIC;
        }

        biomeChunk[cx + cy * BIO_W] = b;
      }
    }
  }

  // ------------------------------
  // Generation helpers
  // ------------------------------
  function addBorders() {
    for (let x = 0; x < W; x++) {
      G.setCell(x, 0, MAT.ROCK);
      G.setCell(x, H - 1, MAT.ROCK);
    }
    for (let y = 0; y < H; y++) {
      G.setCell(0, y, MAT.ROCK);
      G.setCell(W - 1, y, MAT.ROCK);
    }
  }
  G.addBorders = addBorders;

  function carveCircle(cx, cy, r) {
    const r2 = r * r;
    const x0 = Math.max(1, (cx - r) | 0);
    const x1 = Math.min(W - 2, (cx + r) | 0);
    const y0 = Math.max(1, (cy - r) | 0);
    const y1 = Math.min(H - 2, (cy + r) | 0);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          const i = G.idx(x, y);
          if (G._bulkGen) {
            G.mat[i] = MAT.EMPTY;
            G.life[i] = 0;
          } else {
            G.setIndex(i, MAT.EMPTY, 0, G.SET_AMBIENT);
          }
        }
      }
    }
  }
  G.carveCircle = carveCircle;

  function carveRect(x0, y0, w, h) {
    const x1 = Math.min(W - 2, x0 + w);
    const y1 = Math.min(H - 2, y0 + h);
    for (let y = Math.max(1, y0); y < y1; y++) {
      for (let x = Math.max(1, x0); x < x1; x++) {
        const i = G.idx(x, y);
        if (G._bulkGen) {
          G.mat[i] = MAT.EMPTY;
          G.life[i] = 0;
        } else {
          G.setIndex(i, MAT.EMPTY, 0, G.SET_AMBIENT);
        }
      }
    }
  }
  G.carveRect = carveRect;

  // Flexible circle fill (used by spells/brush)
  function fillCircle(cx, cy, r, mat, life0 = 0, canReplace) {
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
        const cur = G.mat[i];
        if (!canReplace || canReplace(cur, x, y, i)) {
          if (G._bulkGen) {
            G.mat[i] = mat;
            G.life[i] = life0;
          } else {
            // Placement: default to ambient temperature (unless the material is a heat source)
            G.setIndex(i, mat, life0, G.SET_AMBIENT);
          }
        }
      }
    }
  }
  G.fillCircle = fillCircle;

  // Backwards-compatible helper: only fill empties
  function spawnMaterialCircle(cx, cy, r, m, life0 = 0) {
    fillCircle(cx, cy, r, m, life0, (cur) => cur === MAT.EMPTY);
  }
  G.spawnMaterialCircle = spawnMaterialCircle;

  // ------------------------------
  // World generation (Noita-ish outdoor surface + layered caves)
  // - keeps chunked simulation + destructible cells
  // - adds a surface profile for sky rendering
  // - adds a visual-only background decoration buffer (trees, etc.)
  // ------------------------------
  const tmpGen = new Uint8Array(N);

  function baseSolidAt(x, y, surfY, biome) {
    // Choose a stable solid material for the "terrain" at this location.
    const d = (y - surfY) | 0;
    const depth01 = y / H;

    if (biome === G.BIOME.SNOW) {
      if (d < 5) return MAT.PACKED_SNOW;
      if (d < 18) {
        // Near-surface frost layer alternates ice / rock
        return (G.noise01(x >> 2, y >> 2) < 0.60) ? MAT.ICE : MAT.ROCK;
      }
      // Deeper: transition into darker rock
      if (depth01 > 0.60) {
        const t = (depth01 - 0.60) / 0.40; // 0..1
        const n = G.noise01(x >> 3, y >> 3);
        if (n < 0.16 + 0.24 * t) return MAT.DARK_ROCK;
      }
      // Ice lenses
      if (G.noise01((x + 2000) >> 3, (y + 9000) >> 3) < 0.07) return MAT.ICE;
      return MAT.ROCK;
    }

    if (biome === G.BIOME.DESERT) {
      if (d < 8) return MAT.SANDSTONE;
      // Occasional hard pockets deeper
      if (depth01 > 0.62) {
        const t = (depth01 - 0.62) / 0.38;
        if (G.noise01(x >> 3, y >> 3) < 0.18 + 0.30 * t) return MAT.DARK_ROCK;
      }
      // Rare rock islands
      if (G.noise01((x + 4000) >> 4, (y + 1111) >> 4) < 0.05) return MAT.ROCK;
      return MAT.SANDSTONE;
    }

    if (biome === G.BIOME.TOXIC) {
      if (depth01 > 0.64 && G.noise01(x >> 3, y >> 3) < 0.25) return MAT.DARK_ROCK;
      // Slightly different strata
      if (G.noise01((x + 777) >> 4, (y + 555) >> 4) < 0.04) return MAT.SANDSTONE;
      return MAT.ROCK;
    }

    // MINES default
    if (depth01 > 0.60) {
      const t = (depth01 - 0.60) / 0.40;
      if (G.noise01(x >> 3, y >> 3) < 0.14 + 0.20 * t) return MAT.DARK_ROCK;
    }
    // Rare sandstone bands
    if (G.noise01((x + 999) >> 4, (y + 222) >> 4) < 0.03) return MAT.SANDSTONE;
    return MAT.ROCK;
  }

  function generateSkyDecor(surface, layout) {
    // Visual-only decorations drawn behind the terrain.
    // These are not part of the simulation grid.
    // NOTE: Renderer draws bgDeco for *any* empty cell (sky + caves).
    if (!G.bgDeco) return;
    G.bgDeco.fill(0);

    // Common outlines / inks
    const OUT_DARK = G.packRGBA(8, 10, 16, 255);
    const OUT_SOFT = G.packRGBA(12, 16, 24, 255);

    // Trunks
    const TR_D1 = G.packRGBA(64, 40, 22, 255);
    const TR_D2 = G.packRGBA(88, 60, 34, 255);
    const TR_F1 = G.packRGBA(40, 28, 16, 255);
    const TR_F2 = G.packRGBA(60, 44, 26, 255);

    // Needles (near vs far)
    const LE_N1 = G.packRGBA(22, 56, 30, 255);
    const LE_N2 = G.packRGBA(34, 78, 42, 255);
    const LE_F1 = G.packRGBA(16, 38, 22, 255);
    const LE_F2 = G.packRGBA(26, 56, 32, 255);

    // Snow highlight
    const SN_HI1 = G.packRGBA(232, 246, 255, 255);
    const SN_HI2 = G.packRGBA(208, 230, 252, 255);

    // Desert / toxic / mines background palettes
    const DS = { out: G.packRGBA(50, 36, 24, 255), fill1: G.packRGBA(180, 140, 84, 255), fill2: G.packRGBA(210, 170, 102, 255), hi: G.packRGBA(240, 210, 160, 255) };
    const TX = { out: G.packRGBA(12, 26, 18, 255), fill1: G.packRGBA(54, 120, 70, 255), fill2: G.packRGBA(80, 160, 90, 255), hi: G.packRGBA(180, 230, 170, 255) };
    const MN = { out: G.packRGBA(18, 20, 28, 255), fill1: G.packRGBA(70, 84, 110, 255), fill2: G.packRGBA(90, 110, 140, 255), hi: G.packRGBA(160, 180, 200, 255) };

    // Cave crystal palettes
    const CR_ICE  = { out: G.packRGBA(14, 32, 52, 255), fill1: G.packRGBA(70, 170, 235, 255), fill2: G.packRGBA(120, 210, 255, 255), hi: G.packRGBA(210, 245, 255, 255) };
    const CR_TOX  = { out: G.packRGBA(10, 28, 18, 255), fill1: G.packRGBA(50, 160, 90, 255),  fill2: G.packRGBA(90, 210, 130, 255),  hi: G.packRGBA(190, 250, 210, 255) };
    const CR_DES  = { out: G.packRGBA(48, 30, 14, 255), fill1: G.packRGBA(200, 140, 70, 255), fill2: G.packRGBA(240, 190, 100, 255), hi: G.packRGBA(255, 235, 200, 255) };
    const CR_MIN  = { out: G.packRGBA(18, 18, 30, 255), fill1: G.packRGBA(90, 110, 180, 255), fill2: G.packRGBA(120, 150, 220, 255), hi: G.packRGBA(200, 220, 245, 255) };

    function setDecoAny(x, y, col) {
      if (x <= 1 || x >= W - 2 || y <= 1 || y >= H - 2) return;
      const i = x + y * W;
      if (G.mat[i] !== MAT.EMPTY) return;
      G.bgDeco[i] = col >>> 0;
    }

    function setSkyDeco(x, y, col) {
      // Only in air above the surface.
      if (y >= surface[x]) return;
      setDecoAny(x, y, col);
    }

    function drawPine(cx, groundY, size, farLayer) {
      // A slightly more "hand-drawn" pine (more segments, silhouette jitter, snow clumps).
      const out = farLayer ? OUT_SOFT : OUT_DARK;
      const tr1 = farLayer ? TR_F1 : TR_D1;
      const tr2 = farLayer ? TR_F2 : TR_D2;
      const le1 = farLayer ? LE_F1 : LE_N1;
      const le2 = farLayer ? LE_F2 : LE_N2;

      const totalH = clampI(size | 0, farLayer ? 14 : 18, farLayer ? 58 : 80);
      const trunkH = clampI(((totalH * (farLayer ? 0.28 : 0.32)) | 0) + G.randi(5), 5, 32);
      const topY = (groundY - totalH) | 0;
      const foliageH = Math.max(10, totalH - trunkH);
      const maxW = clampI(((totalH * (farLayer ? 0.30 : 0.36)) | 0) + G.randi(7), farLayer ? 6 : 9, farLayer ? 22 : 32);

      // trunk (outline + 3..4 px core)
      const tw = farLayer ? 3 : 4;
      const tx0 = (cx - ((tw >> 1) | 0)) | 0;
      for (let y = (groundY - trunkH) | 0; y <= groundY; y++) {
        // outline
        for (let x = tx0 - 1; x <= tx0 + tw; x++) setSkyDeco(x, y, out);

        // inner bark
        for (let x = tx0; x < tx0 + tw; x++) {
          const shade = ((G.hash2i(x + 99, y) & 1) ? tr1 : tr2);
          setSkyDeco(x, y, shade);

          // tiny bark chips (near layer only)
          if (!farLayer && ((G.hash2i(x + 17, y) & 63) === 0)) setSkyDeco(x + 1, y, out);
        }
      }

      // small root flare (near layer only)
      if (!farLayer) {
        const ry = groundY | 0;
        setSkyDeco(cx - 2, ry, out);
        setSkyDeco(cx + 2, ry, out);
        setSkyDeco(cx - 1, ry + 1, tr2);
        setSkyDeco(cx + 1, ry + 1, tr1);
        setSkyDeco(cx - 2, ry + 1, out);
        setSkyDeco(cx + 2, ry + 1, out);
      }

      // foliage (more segments + row wobble)
      const segs = farLayer ? 4 : (6 + (G.randi(2) & 1));
      let segTop = topY;
      const tilt = farLayer ? 0 : (((G.hash2i(cx, groundY) >>> 5) & 3) - 1); // -1..1

      for (let s = 0; s < segs; s++) {
        const segH = clampI(((foliageH / segs) | 0) + 6, 7, 22);
        const segMaxW = clampI((4 + (((s + 1) / segs) * maxW)) | 0, 5, maxW);

        for (let yy = segTop; yy < segTop + segH; yy++) {
          const t = (yy - segTop) / Math.max(1, segH - 1);
          const baseW = (2 + (t * segMaxW)) | 0;

          // silhouette wobble: makes trees less "perfect triangle"
          const wob = (((G.hash2i(cx + s * 77, yy) >>> 3) & 3) - 1); // -1..1
          const rowW = clampI(baseW + wob, 2, segMaxW);
          const cxRow = (cx + ((tilt * (s + 1)) >> 2) + (((G.hash2i(yy, cx) >>> 6) & 3) - 1)) | 0;

          const x0 = (cxRow - rowW) | 0;
          const x1 = (cxRow + rowW) | 0;

          // outline
          for (let xx = x0 - 1; xx <= x1 + 1; xx++) setSkyDeco(xx, yy, out);

          for (let xx = x0; xx <= x1; xx++) {
            const dist = Math.abs(xx - cxRow);
            if (dist >= rowW) continue;

            // Shading: slightly darker on the left, lighter on the right + noise
            const side = (xx < cxRow) ? 0 : 1;
            const n = (G.hash2i(xx, yy) & 3);
            let fill = (side ? le2 : le1);
            if (n === 0) fill = le1;
            if (n === 3) fill = le2;
            setSkyDeco(xx, yy, fill);

            // small "needle tips" to break the edge
            if (!farLayer && dist >= rowW - 2 && ((G.hash2i(xx + 9, yy + 7) & 31) === 0)) {
              setSkyDeco(xx + (xx < cxRow ? -1 : 1), yy, out);
            }
          }

          // snow highlights:
          //  - strong on top ridges
          //  - some clumps mid-canopy (reference-like)
          const dy = (yy - segTop) | 0;
          if (dy <= 1) {
            for (let xx = x0; xx <= x1; xx++) {
              if ((G.hash2i(xx, yy + 77) & 3) === 0) {
                setSkyDeco(xx, yy, (G.hash2i(xx, yy) & 1) ? SN_HI1 : SN_HI2);
              }
            }
          } else if (!farLayer && dy <= 4 && (s >= 1) && ((G.hash2i(cxRow, yy + 2222) & 7) === 0)) {
            // a small clump
            const clx = (cxRow + (((G.hash2i(cxRow, yy) >>> 2) & 7) - 3)) | 0;
            setSkyDeco(clx, yy, SN_HI1);
            setSkyDeco(clx + 1, yy, SN_HI2);
            if ((G.hash2i(clx, yy) & 1) === 0) setSkyDeco(clx, yy - 1, SN_HI2);
          }
        }

        // overlap segments for a denser look
        segTop = (segTop + segH - (farLayer ? 3 : 2)) | 0;
      }
    }

    function drawDune(cx, groundY, size) {
      const h = clampI(size | 0, 12, 40);
      const w = clampI(((size * 0.9) | 0) + 8, 18, 64);
      const topY = (groundY - h) | 0;

      for (let yy = 0; yy < h; yy++) {
        const t = yy / Math.max(1, h - 1);
        const curve = Math.sin((t * Math.PI) * 0.8) * 0.6;
        const half = ((w * (0.35 + 0.65 * (1 - t))) + curve * 6) | 0;
        const x0 = (cx - half) | 0;
        const x1 = (cx + half) | 0;
        const y = (topY + yy) | 0;

        for (let x = x0 - 1; x <= x1 + 1; x++) setSkyDeco(x, y, DS.out);
        for (let x = x0; x <= x1; x++) {
          const n = G.hash2i(x, y);
          let col = (t < 0.4) ? DS.fill2 : DS.fill1;
          if ((n & 7) === 0) col = DS.hi;
          setSkyDeco(x, y, col);
        }
      }
    }

    function drawSporeTree(cx, groundY, size) {
      const h = clampI(size | 0, 18, 54);
      const trunkH = clampI((h * 0.45) | 0, 8, 22);
      const topY = (groundY - h) | 0;
      const trunkW = 3;
      const tx0 = (cx - 1) | 0;

      for (let y = (groundY - trunkH) | 0; y <= groundY; y++) {
        for (let x = tx0 - 1; x <= tx0 + trunkW; x++) setSkyDeco(x, y, TX.out);
        for (let x = tx0; x < tx0 + trunkW; x++) {
          const shade = ((G.hash2i(x + 7, y) & 1) ? TX.fill1 : TX.fill2);
          setSkyDeco(x, y, shade);
        }
      }

      const bulbR = clampI((h * 0.35) | 0, 6, 18);
      const bulbY = (topY + bulbR + 2) | 0;
      for (let y = bulbY - bulbR - 1; y <= bulbY + bulbR + 1; y++) {
        for (let x = cx - bulbR - 1; x <= cx + bulbR + 1; x++) {
          const dx = x - cx, dy = y - bulbY;
          const d2 = dx * dx + dy * dy;
          if (d2 > bulbR * bulbR) continue;
          const n = G.hash2i(x, y);
          let col = (n & 2) ? TX.fill1 : TX.fill2;
          if ((n & 31) === 0) col = TX.hi;
          setSkyDeco(x, y, col);
        }
      }

      // Spores dripping
      for (let s = 0; s < 6; s++) {
        const dx = (G.randi(bulbR) - (bulbR >> 1)) | 0;
        const len = 3 + G.randi(6);
        for (let yy = 0; yy < len; yy++) {
          setSkyDeco(cx + dx, bulbY + bulbR + yy, (yy < 2) ? TX.hi : TX.fill2);
        }
      }
    }

    function drawRuinPillar(cx, groundY, size) {
      const h = clampI(size | 0, 16, 54);
      const w = clampI(((size * 0.18) | 0), 3, 8);
      const x0 = (cx - ((w >> 1) | 0)) | 0;
      const topY = (groundY - h) | 0;

      for (let y = topY; y <= groundY; y++) {
        for (let x = x0 - 1; x <= x0 + w; x++) setSkyDeco(x, y, MN.out);
        for (let x = x0; x < x0 + w; x++) {
          const n = G.hash2i(x, y);
          let col = (n & 1) ? MN.fill1 : MN.fill2;
          if ((n & 31) === 0) col = MN.hi;
          if (((n >>> 5) & 7) === 0) col = MN.out;
          setSkyDeco(x, y, col);
        }
      }

      // Cap
      for (let x = x0 - 2; x <= x0 + w + 1; x++) {
        setSkyDeco(x, topY, MN.out);
        if ((x & 1) === 0) setSkyDeco(x, topY - 1, MN.fill2);
      }
    }

    function drawCrystalCluster(cx, cy, pal, scale) {
      const shards = 3 + G.randi(5);
      for (let s = 0; s < shards; s++) {
        const ox = (G.randi(26) - 13) | 0;
        const oy = (G.randi(18) - 9) | 0;
        const h = clampI(((8 + G.randi(18)) * scale) | 0, 8, 46);
        const w = clampI(((2 + G.randi(4)) * scale) | 0, 2, 12);
        const baseX = (cx + ox) | 0;
        const baseY = (cy + oy) | 0;

        // simple diamond / shard
        for (let yy = 0; yy < h; yy++) {
          const t = yy / Math.max(1, h - 1);
          const ww = Math.max(0, (w - ((t * (w + 2)) | 0)) | 0);
          const y = (baseY - yy) | 0;
          const x0 = (baseX - ww) | 0;
          const x1 = (baseX + ww) | 0;
          for (let x = x0 - 1; x <= x1 + 1; x++) setDecoAny(x, y, pal.out);
          for (let x = x0; x <= x1; x++) {
            const fill = ((G.hash2i(x, y) & 1) ? pal.fill1 : pal.fill2);
            setDecoAny(x, y, fill);
            if (x === x0 && (G.hash2i(x + 33, y) & 3) === 0) setDecoAny(x, y, pal.hi);
          }
        }
      }
    }



    // ----------------------
    // 0) Scenic background setpieces (purely visual)
    // ----------------------
    // Goal: push the outdoor mood closer to the ref (icefalls / cliffs / big readable silhouettes)
    // without affecting gameplay or the macro layout.
    {
      const sx = (layout?.spawn?.x ?? ((W * 0.5) | 0)) | 0;

      // Big icefall / cliff on the right side (background-only).
      // Keep away from the spawn plateau to avoid clutter in the first screen.
      const cx = clampI((sx + 620 + (((G.seed >>> 5) & 127) - 64)) | 0, 180, W - 181);
      const sy = surface[cx] | 0;
      const topY = clampI((sy - 210) | 0, 10, Math.max(12, (sy - 70) | 0));
      const height = (260 + (G.hash2i(cx, sx) & 191)) | 0;
      const baseW = (70 + (G.hash2i(cx + 77, sx) & 63)) | 0;

      // icy palette (background)
      const IC_OUT = G.packRGBA(14, 28, 44, 255);
      const IC_D1  = G.packRGBA(44, 104, 168, 255);
      const IC_D2  = G.packRGBA(70, 140, 210, 255);
      const IC_L1  = G.packRGBA(120, 200, 250, 255);
      const IC_L2  = G.packRGBA(170, 236, 255, 255);
      const IC_HI  = G.packRGBA(230, 255, 255, 255);

      for (let yy = 0; yy < height; yy++) {
        const y = (topY + yy) | 0;
        if (y <= 1 || y >= H - 2) continue;

        // width varies with noise + taper
        const t = yy / Math.max(1, height - 1);
        const taper = 1.0 - 0.55 * t;
        const wav = (G.valueNoise1D(cx + yy * 0.9 + 9000, 36) - 0.5) * 18;
        const w = ((baseW * taper) + wav) | 0;
        const half = clampI(w >> 1, 14, 120);

        const x0 = (cx - half) | 0;
        const x1 = (cx + half) | 0;

        for (let x = x0 - 1; x <= x1 + 1; x++) {
          // outline
          if ((x === x0 - 1 || x === x1 + 1) && ((G.hash2i(x, y) & 3) !== 0)) {
            setDecoAny(x, y, IC_OUT);
            continue;
          }
          if (x < x0 || x > x1) continue;

          // internal shading
          const hx = (x - x0) / Math.max(1, x1 - x0);
          const n = G.hash2i(x, y);
          let col = (hx < 0.35) ? IC_D2 : (hx < 0.70 ? IC_L1 : IC_L2);
          if ((n & 7) === 0) col = IC_D1;
          if ((n & 31) === 0) col = IC_HI; // sparkle

          // a few vertical "cracks"
          if (((n >>> 7) & 127) === 0) col = IC_OUT;

          setDecoAny(x, y, col);
        }

        // falling icy shards around the icefall
        if ((G.hash2i(cx, y) & 31) === 0) {
          const px = (cx + (((G.hash2i(y, cx) >>> 10) & 31) - 15)) | 0;
          setDecoAny(px, y + 2, IC_L2);
          setDecoAny(px, y + 3, IC_D2);
        }
      }
    }

    // Biome-specific scenic setpieces (background-only)
    {
      const sx = (layout?.spawn?.x ?? ((W * 0.5) | 0)) | 0;
      const cx = clampI((sx - 520 + (((G.seed >>> 7) & 127) - 64)) | 0, 160, W - 161);
      const sy = surface[cx] | 0;
      const b = (G.surfaceBiome ? (G.surfaceBiome[cx] | 0) : G.biomeAt(cx, sy + 8));

      if (b === G.BIOME.DESERT) {
        const pillarH = 34 + (G.hash2i(cx, sy) & 15);
        const pillarW = 4;
        const gap = 28 + (G.hash2i(cx + 11, sy) & 7);
        const topY = (sy - pillarH) | 0;
        const xL = (cx - gap) | 0;
        const xR = (cx + gap) | 0;

        for (let y = topY; y <= sy; y++) {
          for (let x = xL - 1; x <= xL + pillarW; x++) setSkyDeco(x, y, DS.out);
          for (let x = xR - 1; x <= xR + pillarW; x++) setSkyDeco(x, y, DS.out);
          for (let x = xL; x < xL + pillarW; x++) setSkyDeco(x, y, ((G.hash2i(x, y) & 1) ? DS.fill1 : DS.fill2));
          for (let x = xR; x < xR + pillarW; x++) setSkyDeco(x, y, ((G.hash2i(x, y) & 1) ? DS.fill1 : DS.fill2));
        }

        // Lintel
        for (let x = xL - 2; x <= xR + pillarW + 1; x++) {
          setSkyDeco(x, topY, DS.out);
          if ((x & 1) === 0) setSkyDeco(x, topY - 1, DS.hi);
        }
      } else if (b === G.BIOME.TOXIC) {
        const r0 = 16 + (G.hash2i(cx, sy) & 7);
        const cy = (sy - 40) | 0;
        for (let y = cy - r0; y <= cy + r0; y++) {
          for (let x = cx - r0; x <= cx + r0; x++) {
            const dx = x - cx, dy = y - cy;
            if (dx * dx + dy * dy > r0 * r0) continue;
            const n = G.hash2i(x, y);
            const col = (n & 3) ? TX.fill1 : TX.fill2;
            setSkyDeco(x, y, col);
          }
        }
        // Dripping spores
        for (let k = 0; k < 14; k++) {
          const x0 = (cx + (G.randi(r0) - (r0 >> 1))) | 0;
          const len = 4 + G.randi(10);
          for (let yy = 0; yy < len; yy++) {
            setSkyDeco(x0, cy + r0 + yy, (yy < 2) ? TX.hi : TX.fill2);
          }
        }
      } else if (b === G.BIOME.MINES) {
        const towerH = 52 + (G.hash2i(cx, sy) & 31);
        const towerW = 8;
        const topY = (sy - towerH) | 0;
        const x0 = (cx - (towerW >> 1)) | 0;
        for (let y = topY; y <= sy; y++) {
          for (let x = x0 - 1; x <= x0 + towerW; x++) setSkyDeco(x, y, MN.out);
          for (let x = x0; x < x0 + towerW; x++) {
            const n = G.hash2i(x, y);
            let col = (n & 1) ? MN.fill1 : MN.fill2;
            if (((y - topY) % 9) === 0 && (x - x0) > 1 && (x - x0) < towerW - 2) col = MN.out;
            if ((n & 31) === 0) col = MN.hi;
            setSkyDeco(x, y, col);
          }
        }
      }
    }
    // ----------------------
    // 1) Trees: two depth layers (far = darker/smaller, near = richer)
    // ----------------------
    let x = 16;
    const drawBgTrees = false;
    while (x < W - 16) {
      const hh = surface[x] | 0;
      const b = (G.surfaceBiome ? (G.surfaceBiome[x] | 0) : G.biomeAt(x, hh + 10));

      if (b === G.BIOME.SNOW) {
        const density = G.noise01(x >> 4, (hh + 123) >> 3);
        const far = (G.noise01((x + 555) >> 5, (hh + 222) >> 4) < 0.50);
        const step = far ? (16 + G.randi(18)) : (26 + G.randi(30));

        if (drawBgTrees && density < (far ? 0.62 : 0.52)) {
          const size = far ? (18 + G.randi(12)) : (30 + G.randi(26));
          const gy = (hh - (far ? 3 : 2)) | 0;
          drawPine(x | 0, gy, size, far);
        }
        x += step;
      } else if (b === G.BIOME.DESERT) {
        const density = G.noise01((x + 900) >> 4, (hh + 80) >> 3);
        const step = 20 + G.randi(26);
        if (density < 0.70) {
          const size = 18 + G.randi(18);
          const gy = (hh - 1) | 0;
          drawDune(x | 0, gy, size);
        }
        x += step;
      } else if (b === G.BIOME.TOXIC) {
        const density = G.noise01((x + 300) >> 4, (hh + 50) >> 3);
        const step = 22 + G.randi(28);
        if (density < 0.62) {
          const size = 20 + G.randi(20);
          const gy = (hh - 2) | 0;
          drawSporeTree(x | 0, gy, size);
        }
        x += step;
      } else if (b === G.BIOME.MINES) {
        const density = G.noise01((x + 1200) >> 4, (hh + 60) >> 3);
        const step = 28 + G.randi(38);
        if (density < 0.55) {
          const size = 16 + G.randi(26);
          const gy = (hh - 2) | 0;
          drawRuinPillar(x | 0, gy, size);
        }
        x += step;
      } else {
        x += 32 + G.randi(56);
      }
    }

    // ----------------------
    // 2) Cave background deco: crystals + light icicle silhouettes
    // ----------------------
    const pr = layout?.protectedRects || [];
    const rooms = layout?.rooms || [];

    function pickCrystalPalette(wx, wy) {
      const b = G.biomeAt(wx, wy);
      if (b === G.BIOME.SNOW) return CR_ICE;
      if (b === G.BIOME.TOXIC) return CR_TOX;
      if (b === G.BIOME.DESERT) return CR_DES;
      return CR_MIN;
    }

    // Targeted crystals inside a subset of rooms (including the entrance room)
    if (rooms && rooms.length) {
      for (let i = 0; i < rooms.length; i++) {
        const r = rooms[i];
        if (!r || (r.type !== 'main' && r.type !== 'branch')) continue;
        if (G.rand01() > 0.55) continue;

        const side = (G.rand01() < 0.5) ? -1 : 1;
        const cx = (r.x + side * ((r.w >> 1) - 22 - G.randi(18))) | 0;
        const cy = (r.y + ((r.h >> 1) - 10 - G.randi(24))) | 0;
        if (nearProtected(pr, cx, cy, 12)) {
          // ...but still OK, this is background-only. We'll just dampen spawn clutter.
          // Keep the very start clean.
          if (layout?.entrance && Math.abs(cx - layout.entrance.x) < 180 && Math.abs(cy - layout.entrance.y) < 160) continue;
        }

        if (cx <= 10 || cx >= W - 10 || cy <= 10 || cy >= H - 10) continue;
        if (G.mat[G.idx(cx, cy)] !== MAT.EMPTY) continue;

        const pal = pickCrystalPalette(cx, cy);
        drawCrystalCluster(cx, cy, pal, 1);
      }
    }

    // Big entrance crystals (snow vibe setpiece)
    if (layout?.entranceRoom) {
      const r = layout.entranceRoom;
      const cx = (r.x + (r.w >> 1) - 34) | 0;
      const cy = (r.y + (r.h >> 1) - 18) | 0;
      if (cx > 10 && cx < W - 10 && cy > 10 && cy < H - 10 && G.mat[G.idx(cx, cy)] === MAT.EMPTY) {
        drawCrystalCluster(cx, cy, CR_ICE, 2);
      }

      // A few hanging background icicles in the entrance chamber
      for (let t = 0; t < 18; t++) {
        const x0 = (r.x - (r.w >> 1) + 20 + G.randi(r.w - 40)) | 0;
        const y0 = (r.y - (r.h >> 1) + 18 + G.randi(10)) | 0;
        const len = (5 + G.randi(14)) | 0;
        for (let yy = 0; yy < len; yy++) {
          const y = (y0 + yy) | 0;
          const col = (yy < 2) ? CR_ICE.hi : ((G.hash2i(x0, y) & 1) ? CR_ICE.fill2 : CR_ICE.fill1);
          setDecoAny(x0, y, col);
          if ((G.hash2i(x0, y) & 7) === 0) setDecoAny(x0 - 1, y, CR_ICE.out);
          if ((G.hash2i(x0, y + 11) & 7) === 0) setDecoAny(x0 + 1, y, CR_ICE.out);
        }
      }
    }

    // A few random crystals in deeper voids (for atmosphere)
    {
      const clusters = 40 + G.randi(40);
      for (let c = 0; c < clusters; c++) {
        const cx = (80 + G.randi(W - 160)) | 0;
        const yMin = (surface[cx] + 120) | 0;
        if (yMin >= H - 160) continue;
        const cy = (yMin + G.randi((H - 160) - yMin)) | 0;
        if (layout?.entrance && Math.abs(cx - layout.entrance.x) < 160 && Math.abs(cy - layout.entrance.y) < 140) continue;
        if (G.mat[G.idx(cx, cy)] !== MAT.EMPTY) continue;
        const pal = pickCrystalPalette(cx, cy);
        drawCrystalCluster(cx, cy, pal, (G.rand01() < 0.65) ? 1 : 2);
      }
    }
  }


  // ---------------------------------------------------------
  // World generation v2 (playable macro layout -> micro dressing)
  // ---------------------------------------------------------
  // Goals:
  //  - Safe spawn (flat plateau + no immediate hazards)
  //  - A readable, traversable main path (rooms + corridors blueprint)
  //  - Optional branches, but the main path stays clear
  //  - Micro dressing that never breaks the macro traversal
  //  - Deterministic per seed, with a simple validation + retry

  function mix32(x) {
    // A small 32-bit mixer (deterministic, fast)
    x |= 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x | 0;
  }

  function attemptRngState(baseSeed, attempt) {
    // Keep determinism per seed while allowing deterministic retries.
    // NOTE: G.seed stays constant; we only reset the rand() stream.
    const a = (attempt + 1) | 0;
    return mix32((baseSeed | 0) + Math.imul(a, 0x9e3779b9));
  }

  function randsym() {
    return G.rand01() * 2 - 1;
  }

  function randRange(a, b) {
    return a + (b - a) * G.rand01();
  }

  function clampI(v, lo, hi) {
    return G.clamp(v | 0, lo | 0, hi | 0) | 0;
  }

  function buildSurface(surface, params) {
    const rough = G.clamp(params.surfaceRoughness ?? 0.25, 0, 1);
    // Higher world => we can afford a deeper underground while keeping a nice sky.
    // We still keep the surface fairly high so the outdoor scene reads.
    const base = (H * 0.19) | 0;

    // Macro control points (smooth, readable relief)
    // Bigger segment size -> larger, more readable mountain shapes.
    const seg = 140;
    const nPts = ((W / seg) | 0) + 3;
    const pts = new Int16Array(nPts);

    let y = (base + (randsym() * 34)) | 0;
    for (let i = 0; i < nPts; i++) {
      if (i > 0) {
        // Gentle random walk, with occasional plateaus and rare big "mountain" moves.
        const plateau = (G.rand01() < (0.22 - rough * 0.08));
        y += plateau
          ? ((randsym() * (4 + rough * 8)) | 0)
          : ((randsym() * (18 + rough * 30)) | 0);

        if (G.rand01() < 0.10) {
          y += (randsym() * (70 + rough * 120)) | 0;
        }
      }
      y = clampI(y, 70, H - 220);
      pts[i] = y;
    }

    // Interpolate segments
    for (let x = 0; x < W; x++) {
      const fx = x / seg;
      const i = fx | 0;
      const t = fx - i;
      const u = G.smoothstep(t);
      let hh = (pts[i] * (1 - u) + pts[i + 1] * u) | 0;

      // A tiny micro roughness so it doesn't look 100% synthetic
      if (rough > 0.001) {
        const micro = ((G.valueNoise1D(x + 999, 26) - 0.5) * 10 * rough) | 0;
        hh += micro;
      }
      surface[x] = clampI(hh, 70, H - 160);
    }

    // Clamp slopes (anti-micro-bumps pass)
    const maxStep = (2 + rough * 3) | 0; // 2..5
    for (let x = 1; x < W; x++) {
      const d = surface[x] - surface[x - 1];
      if (d > maxStep) surface[x] = surface[x - 1] + maxStep;
      else if (d < -maxStep) surface[x] = surface[x - 1] - maxStep;
    }
    for (let x = W - 2; x >= 0; x--) {
      const d = surface[x] - surface[x + 1];
      if (d > maxStep) surface[x] = surface[x + 1] + maxStep;
      else if (d < -maxStep) surface[x] = surface[x + 1] - maxStep;
    }

    // Safe spawn plateau
    const spawnX = (W * 0.5) | 0;
    const flatW = (params.spawnFlatWidth ?? 240) | 0;
    const half = (flatW >> 1) | 0;
    const left = Math.max(2, (spawnX - half) | 0);
    const right = Math.min(W - 3, (spawnX + half) | 0);
    const plateauY = surface[spawnX] | 0;

    const orig = new Int16Array(surface);
    for (let x = left; x <= right; x++) surface[x] = plateauY;

    // Blend edges so it's not a cliff
    const ramp = 80;
    for (let x = left - ramp; x < left; x++) {
      if (x < 2 || x >= W - 2) continue;
      const t = (x - (left - ramp)) / ramp;
      const u = G.smoothstep(G.clamp(t, 0, 1));
      surface[x] = ((orig[x] * (1 - u) + plateauY * u) | 0);
    }
    for (let x = right + 1; x <= right + ramp; x++) {
      if (x < 2 || x >= W - 2) continue;
      const t = (x - (right + 1)) / ramp;
      const u = G.smoothstep(G.clamp(t, 0, 1));
      surface[x] = ((plateauY * (1 - u) + orig[x] * u) | 0);
    }

    // Final slope clamp pass after plateau blending
    for (let x = 1; x < W; x++) {
      const d = surface[x] - surface[x - 1];
      if (d > maxStep) surface[x] = surface[x - 1] + maxStep;
      else if (d < -maxStep) surface[x] = surface[x - 1] - maxStep;
    }
    for (let x = W - 2; x >= 0; x--) {
      const d = surface[x] - surface[x + 1];
      if (d > maxStep) surface[x] = surface[x + 1] + maxStep;
      else if (d < -maxStep) surface[x] = surface[x + 1] - maxStep;
    }
  }

  function writeSurfaceArrays(surface) {
    if (G.surfaceY) G.surfaceY.set(surface);
    if (G.surfaceBiome) {
      for (let x = 0; x < W; x++) {
        G.surfaceBiome[x] = G.biomeAt(x, (surface[x] + 12) | 0);
      }
    }
  }

  function fillWorldFromSurface(surface) {
    for (let y = 0; y < H; y++) {
      const depth01 = y / H;
      for (let x = 0; x < W; x++) {
        const i = G.idx(x, y);
        G.life[i] = 0;

        // Sky
        if (y < surface[x]) {
          G.mat[i] = MAT.EMPTY;
          continue;
        }

        // Solid underground
        const b = G.biomeAt(x, y);
        G.mat[i] = baseSolidAt(x, y, surface[x], b);
      }
    }
  }

  function protectRect(list, x0, y0, x1, y1) {
    list.push({
      x0: clampI(x0, 1, W - 2),
      y0: clampI(y0, 1, H - 2),
      x1: clampI(x1, 1, W - 2),
      y1: clampI(y1, 1, H - 2),
    });
  }

  function inProtected(list, x, y) {
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return true;
    }
    return false;
  }

  function nearProtected(list, x, y, pad) {
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (x >= r.x0 - pad && x <= r.x1 + pad && y >= r.y0 - pad && y <= r.y1 + pad) return true;
    }
    return false;
  }

  function carveBox(cx, cy, halfW, halfH) {
    const x0 = (cx - halfW) | 0;
    const y0 = (cy - halfH) | 0;
    carveRect(x0, y0, (halfW * 2) | 0, (halfH * 2) | 0);
  }

  function carveTube(points, halfW, halfH) {
    for (let p = 0; p < points.length - 1; p++) {
      const a = points[p];
      const b = points[p + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      const step = Math.max(3, (halfW * 0.75) | 0);
      const steps = Math.max(1, (len / step) | 0);

      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = (a.x + dx * t) | 0;
        const y = (a.y + dy * t) | 0;
        carveBox(x, y, halfW, halfH);
      }
    }
  }

  function carveRoom(room) {
    const x0 = (room.x - (room.w >> 1)) | 0;
    const y0 = (room.y - (room.h >> 1)) | 0;
    carveRect(x0, y0, room.w | 0, room.h | 0);

    // Rounded-ish corners (small circles) for nicer silhouettes
    const rr = Math.min(14, (room.w >> 3) | 0, (room.h >> 3) | 0);
    if (rr >= 4) {
      carveCircle((x0 + rr) | 0, (y0 + rr) | 0, rr);
      carveCircle((x0 + room.w - rr) | 0, (y0 + rr) | 0, rr);
      carveCircle((x0 + rr) | 0, (y0 + room.h - rr) | 0, rr);
      carveCircle((x0 + room.w - rr) | 0, (y0 + room.h - rr) | 0, rr);
    }
  }

  function carveMacroLayout(surface, params) {
    const rooms = [];
    const corridors = [];
    const protectedRects = [];

    const spawnX = (W * 0.5) | 0;
    const spawnSurfY = surface[spawnX] | 0;

    const corridorWidth = (params.corridorWidth ?? 22) | 0;
    const halfW = Math.max(10, (corridorWidth >> 1) | 0);
    const halfH = Math.max(18, (halfW * 2) | 0); // keep vertical clearance generous for the 5loc character

    // Main rooms distributed along X
    // Bigger world => more rooms, more rhythm.
    const roomCount = clampI(params.roomCount ?? 12, 7, 16);
    const levelLength = G.clamp(params.levelLength ?? 0.95, 0.60, 0.985);
    const margin = Math.max(110, ((W * (1 - levelLength)) * 0.5) | 0);
    const xMin = margin;
    const xMax = (W - 1 - margin) | 0;
    const baseDx = (xMax - xMin) / (roomCount - 1);

    const xs = new Int16Array(roomCount);
    for (let i = 0; i < roomCount; i++) {
      let x = (xMin + baseDx * i + randsym() * baseDx * 0.25) | 0;
      x = clampI(x, 40, W - 41);
      xs[i] = x;
    }
    // Sort
    xs.sort?.();
    // (Safari/older engines may not have typedarray.sort stable, but OK)

    // If typedarray.sort() isn't available, fall back (rare)
    if (!xs.sort) {
      const tmp = Array.from(xs);
      tmp.sort((a, b) => a - b);
      for (let i = 0; i < tmp.length; i++) xs[i] = tmp[i];
    }

    // Enforce minimum spacing
    const minSpacing = Math.max(140, ((W / roomCount) * 0.55) | 0);
    for (let i = 1; i < roomCount; i++) {
      if (xs[i] < xs[i - 1] + minSpacing) xs[i] = (xs[i - 1] + minSpacing) | 0;
    }

    // Depth progression:
    // We want the main path to feel like it goes "deeper" over time (more like real level design)
    // while still staying readable and not turning into a vertical maze.
    const verticality = G.clamp(params.verticality ?? 0.55, 0, 1);
    const startBaseY = Math.max((H * 0.32) | 0, (spawnSurfY + 140) | 0);
    const endBaseY = clampI(((startBaseY + ((H * (0.48 + 0.20 * verticality)) | 0)) | 0), startBaseY + 220, H - 260);
    let y = startBaseY | 0;
    const yJitter = (14 + verticality * 96) | 0;
    const maxRoomY = (H - 260) | 0;

    for (let i = 0; i < roomCount; i++) {
      const x = xs[i] | 0;
      const u = roomCount <= 1 ? 0 : (i / (roomCount - 1));
      const target = (startBaseY * (1 - u) + endBaseY * u) | 0;
      // Smoothly chase the depth target, then apply jitter.
      y = ((y * 0.45 + target * 0.55) | 0) + ((randsym() * yJitter) | 0);

      const minRoomY = (surface[x] + 110) | 0;
      y = clampI(y, minRoomY, maxRoomY);

      let w = (180 + (G.randi(140) | 0)) | 0; // 180..319
      let h = (96 + (G.randi(80) | 0)) | 0;   // 96..175

      // Bigger breathing rooms every ~3 nodes
      if ((i % 3) === 0) {
        w += 60;
        h += 22;
      }

      // Ensure corridor clearance fits
      h = Math.max(h, (halfH * 2 + 54) | 0);
      w = Math.max(w, (halfW * 2 + 120) | 0);

      rooms.push({ x, y, w, h, type: 'main' });
    }

    // Determine cave entrance near the spawn plateau.
    // We prefer placing it just OUTSIDE the flat spawn area (more scenic and avoids
    // hollowing the plateau itself), while still being trivially reachable.
    const flatW = (params.spawnFlatWidth ?? 320) | 0;
    const plateauHalf = (flatW >> 1) | 0;
    const off = ((params.spawnEntranceOffset ?? 140) | 0);
    let entranceX = (spawnX + off) | 0;
    if (off >= 0) entranceX = (spawnX + plateauHalf + Math.max(60, off)) | 0;
    else entranceX = (spawnX - plateauHalf - Math.max(60, -off)) | 0;
    entranceX = clampI(entranceX, 60, W - 61);
    const entranceSurfY = surface[entranceX] | 0;

    // Pick the nearest main room to connect the entrance
    let startRoomIndex = 0;
    let bestDx = 1e9;
    for (let i = 0; i < rooms.length; i++) {
      const d = Math.abs((rooms[i].x | 0) - entranceX);
      if (d < bestDx) {
        bestDx = d;
        startRoomIndex = i;
      }
    }

    // Carve rooms first
    for (const r of rooms) {
      carveRoom(r);
      protectRect(
        protectedRects,
        r.x - (r.w >> 1) - 14,
        r.y - (r.h >> 1) - 14,
        r.x + (r.w >> 1) + 14,
        r.y + (r.h >> 1) + 14,
      );
    }

    // Helper: corridor anchor inside a room, close to its floor (flat/readable)
    const anchorInRoom = (r) => {
      const floor = (r.y + (r.h >> 1) - 6) | 0;
      return { x: r.x | 0, y: (floor - halfH) | 0 };
    };

    // Main chain (rooms[i] -> rooms[i+1])
    for (let i = 0; i < rooms.length - 1; i++) {
      const a = rooms[i];
      const b = rooms[i + 1];
      const p0 = anchorInRoom(a);
      const p2 = anchorInRoom(b);
      const mx = ((p0.x + p2.x) * 0.5) | 0;
      let my = ((p0.y + p2.y) * 0.5 + randsym() * verticality * 40) | 0;
      my = Math.max(my, (surface[mx] + 60) | 0);
      const pts = [p0, { x: mx, y: my }, p2];

      carveTube(pts, halfW, halfH);
      corridors.push({ from: i, to: i + 1, points: pts, type: 'main' });

      // Protect the corridor volume
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const p of pts) {
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
      }
      protectRect(protectedRects, x0 - halfW - 18, y0 - halfH - 18, x1 + halfW + 18, y1 + halfH + 18);
    }

    // Entrance mouth + small antechamber
    // This makes the start read like a "designed" setpiece (clear cave mouth + breathing space)
    // and gives us room for pretty ice/crystal background deco.
    const mouthW = Math.max(72, (halfW * 2 + 64) | 0);
    const mouthH = 70;
    carveRect((entranceX - (mouthW >> 1)) | 0, (entranceSurfY - 40) | 0, mouthW, mouthH);

    // Antechamber under the mouth (kept protected from micro dressing)
    const entranceRoom = {
      x: entranceX | 0,
      y: (entranceSurfY + 94) | 0,
      w: (240 + G.randi(60)) | 0,
      h: (150 + G.randi(50)) | 0,
      type: 'entrance',
    };
    carveRoom(entranceRoom);
    protectRect(
      protectedRects,
      entranceRoom.x - (entranceRoom.w >> 1) - 18,
      entranceRoom.y - (entranceRoom.h >> 1) - 18,
      entranceRoom.x + (entranceRoom.w >> 1) + 18,
      entranceRoom.y + (entranceRoom.h >> 1) + 18,
    );

    const entry = { x: entranceX | 0, y: (entranceSurfY + 22) | 0 };

    const startRoom = rooms[startRoomIndex];
    const startAnchor = anchorInRoom(startRoom);
    const emx = ((entry.x + startAnchor.x) * 0.5) | 0;
    let emy = ((entry.y + startAnchor.y) * 0.5 + 10) | 0;
    emy = Math.max(emy, (surface[emx] + 40) | 0);
    const ePts = [entry, { x: emx, y: emy }, startAnchor];
    carveTube(ePts, halfW, halfH);
    corridors.push({ from: 'entrance', to: startRoomIndex, points: ePts, type: 'entrance' });
    protectRect(protectedRects, entry.x - halfW - 24, entry.y - halfH - 24, startAnchor.x + halfW + 24, startAnchor.y + halfH + 24);

    // Optional branch rooms (kept outside the protected main path, but connected)
    const branchCount = clampI(params.branchCount ?? 3, 0, 4);
    for (let b = 0; b < branchCount; b++) {
      // pick a non-endpoint main room
      // Use only main rooms so we don't branch off entrance/cosmetic nodes.
      const mainRooms = rooms.filter(r => r.type === 'main');
      const mainBase = mainRooms[clampI(1 + G.randi(Math.max(1, mainRooms.length - 2)), 1, mainRooms.length - 2)];
      const baseIndex = rooms.indexOf(mainBase);
      const base = mainBase;

      const side = G.rand01() < 0.5 ? -1 : 1;
      const up = G.rand01() < 0.5 ? -1 : 1;

      let bx = (base.x + side * (180 + G.randi(220))) | 0;
      bx = clampI(bx, 60, W - 61);

      let by = (base.y + up * (110 + G.randi(180))) | 0;
      by = Math.max(by, (surface[bx] + 130) | 0);
      by = clampI(by, surface[bx] + 130, H - 260);

      const br = {
        x: bx,
        y: by,
        w: (150 + G.randi(120)) | 0,
        h: Math.max(92 + G.randi(70), (halfH * 2 + 54) | 0),
        type: 'branch',
      };

      const brIndex = rooms.length;
      rooms.push(br);
      carveRoom(br);
      protectRect(protectedRects, br.x - (br.w >> 1) - 14, br.y - (br.h >> 1) - 14, br.x + (br.w >> 1) + 14, br.y + (br.h >> 1) + 14);

      const p0 = anchorInRoom(base);
      const p2 = anchorInRoom(br);
      const mx = ((p0.x + p2.x) * 0.5) | 0;
      let my = ((p0.y + p2.y) * 0.5 + randsym() * 24) | 0;
      my = Math.max(my, (surface[mx] + 70) | 0);
      const pts = [p0, { x: mx, y: my }, p2];
      carveTube(pts, halfW, halfH);
      corridors.push({ from: baseIndex, to: brIndex, points: pts, type: 'branch' });
      protectRect(protectedRects, Math.min(p0.x, p2.x) - halfW - 18, Math.min(p0.y, p2.y) - halfH - 18, Math.max(p0.x, p2.x) + halfW + 18, Math.max(p0.y, p2.y) + halfH + 18);
    }

    const goalRoom = rooms.filter(r => r.type === 'main').slice(-1)[0];

    return {
      seed: G.seed | 0,
      params,
      spawn: { x: spawnX, y: (spawnSurfY - 10) | 0 },
      entrance: entry,
      entranceRoom,
      goal: { x: goalRoom.x | 0, y: goalRoom.y | 0 },
      rooms,
      corridors,
      protectedRects,
      halfW,
      halfH,
    };
  }

  function decorateWorld(surface, layout, params) {
    const protectedRects = layout.protectedRects;
    const spawnX = (W * 0.5) | 0;
    const flatW = (params.spawnFlatWidth ?? 320) | 0;
    const plateauHalf = (flatW >> 1) | 0;
    const keepSpawnL = (spawnX - plateauHalf - 6) | 0;
    const keepSpawnR = (spawnX + plateauHalf + 6) | 0;


    // ---------------------------------------------
    // A0) Blueprint macro setpieces (composition)
    // ---------------------------------------------
    // 1) Cinematic cave mouth (arch + breathing room)
    // 2) Mega snow cornice (big overhang)
    // 3) Natural bridge over an open chasm
    //
    // Deterministic by seed, and kept away from protected
    // rooms/corridors except for the entrance mouth which
    // only CARVES (never fills) to keep the path safe.
    {
      const snowCorniceRate = +(params.snowCorniceRate ?? 0.60);

      // --- 1) Cave mouth (carve only, readable silhouette)
      if (layout && layout.entrance) {
        const ex = layout.entrance.x | 0;
        const sy = surface[ex] | 0;
        // keep some distance from the spawn plateau edge (just in case)
        if (Math.abs(ex - spawnX) > (plateauHalf + 40)) {
          const mouthW = 170 + G.randi(34);
          const mouthH = 110 + G.randi(34);
          const x0 = clampI((ex - (mouthW >> 1)) | 0, 40, W - 41);
          const y0 = clampI((sy + 14) | 0, 8, H - 140);
          carveRect(x0, y0, mouthW, mouthH);
          // rounded top arch
          carveCircle(ex, y0, (mouthW >> 1) | 0);
          // widen the mouth a bit lower (more cinematic)
          carveRect((ex - 34) | 0, (y0 + 44) | 0, 68, 64);
        }
      }

      // Helper: find a snow-biome surface location far from spawn
      function pickSnowSurfaceX(minDist) {
        const tries = 18;
        for (let t = 0; t < tries; t++) {
          const x = (80 + G.randi(W - 160)) | 0;
          if (Math.abs(x - spawnX) < minDist) continue;
          if (G.surfaceBiome && G.surfaceBiome[x] !== G.BIOME.SNOW) continue;
          return x;
        }
        // fallback: any x
        return (80 + G.randi(W - 160)) | 0;
      }

      // --- 2) Mega cornice
      if (snowCorniceRate > 0.05) {
        const cx = pickSnowSurfaceX((flatW + 520) | 0);
        const w = (620 + G.randi(520)) | 0;
        const x0 = clampI((cx - (w >> 1)) | 0, 60, W - 61);
        const x1 = clampI((cx + (w >> 1)) | 0, 60, W - 61);
        const roof = clampI((14 + (snowCorniceRate * 10)) | 0, 12, 24);
        const depth = (110 + G.randi(120)) | 0;
        const cy = (surface[cx] + roof + 40) | 0;

        if (!nearProtected(protectedRects, cx, cy, (w >> 1) + 140)) {
          for (let x = x0; x <= x1; x++) {
            const sY = surface[x] | 0;
            // Gentle scallop + a few bigger pockets (not uniform noise).
            const n1 = (G.valueNoise1D(x + 17001, 120) - 0.5);
            const n2 = (G.valueNoise1D(x + 9999, 44) - 0.5);
            const yStart = (sY + roof + ((n1 * 8 + n2 * 4) | 0)) | 0;
            const d = (depth + ((n1 * 26 + n2 * 18) | 0)) | 0;
            if (yStart < 2 || yStart >= H - 2) continue;
            // carve a thin column; the overlap makes a smooth cavity
            carveRect(x, yStart, 1, d);
          }
        }
      }

      // --- 3) Natural bridge over an open chasm
      {
        const bx = pickSnowSurfaceX((flatW + 620) | 0);
        const sY = surface[bx] | 0;
        const chW = 220 + G.randi(120);
        const chD = 220 + G.randi(160);
        const x0 = clampI((bx - (chW >> 1)) | 0, 60, W - 61);
        const x1 = clampI((bx + (chW >> 1)) | 0, 60, W - 61);
        const y0 = clampI((sY + 8) | 0, 6, H - 6);
        const y1 = clampI((sY + chD) | 0, 6, H - 6);
        const midY = clampI((sY + ((chD * 0.52) | 0)) | 0, y0 + 20, y1 - 40);

        const okZone = !nearProtected(protectedRects, bx, midY, (chW >> 1) + 160) && (Math.abs(bx - spawnX) > (flatW + 420));
        if (okZone) {
          // carve the chasm (open to sky by definition)
          carveRect(x0, y0, (x1 - x0) | 0, (y1 - y0) | 0);

          // build the bridge (rock core + packed snow cap)
          const thick = 10 + G.randi(8);
          const cap = 3 + (snowCorniceRate > 0.55 ? 1 : 0);
          for (let y = midY; y < midY + thick; y++) {
            if (y <= 2 || y >= H - 2) continue;
            for (let x = x0 + 8; x <= x1 - 8; x++) {
              if (inProtected(protectedRects, x, y)) continue;
              const i = G.idx(x, y);
              // only fill where we carved air
              if (G.mat[i] !== MAT.EMPTY) continue;
              const core = (y < midY + cap) ? MAT.PACKED_SNOW : ((y < midY + thick - 2) ? MAT.ROCK : MAT.DARK_ROCK);
              G.mat[i] = core;
              G.life[i] = 0;
            }
          }

          // a few support "legs" to make it read as natural
          const legs = 2 + G.randi(2);
          for (let l = 0; l < legs; l++) {
            const lx = (x0 + 26 + G.randi(Math.max(1, (x1 - x0 - 52)))) | 0;
            const legH = 26 + G.randi(56);
            for (let y = midY + thick; y < midY + thick + legH; y++) {
              if (y >= H - 2) break;
              const w2 = 3 + ((G.valueNoise1D(lx + y * 1.2 + 20000, 28) * 6) | 0);
              for (let x = lx - w2; x <= lx + w2; x++) {
                if (x <= 1 || x >= W - 2) continue;
                if (inProtected(protectedRects, x, y)) continue;
                const i = G.idx(x, y);
                if (G.mat[i] !== MAT.EMPTY) continue;
                G.mat[i] = MAT.DARK_ROCK;
                G.life[i] = 0;
              }
            }
          }
        }
      }
    }

    // 0) Surface "shelves" / undercuts (snow overhangs)
    // Adds that platformer-like silhouette without breaking the macro path.
    // Done before layering so the roof gets the proper snow/packed dressing.
    {
      const undercuts = 5 + G.randi(4); // 5..8
      const spawnSafe = (flatW + 380) | 0;
      for (let u = 0; u < undercuts; u++) {
        const cx = (140 + G.randi(W - 280)) | 0;
        if (Math.abs(cx - spawnX) < spawnSafe) continue;
        if (G.surfaceBiome && G.surfaceBiome[cx] !== G.BIOME.SNOW) continue;

        const w = (260 + G.randi(520)) | 0;
        const x0 = clampI((cx - (w >> 1)) | 0, 40, W - 41);
        const x1 = clampI((cx + (w >> 1)) | 0, 40, W - 41);

        const roof = (10 + G.randi(9)) | 0;
        const depth = (48 + G.randi(86)) | 0;
        const cy = (surface[cx] + roof + (depth >> 1)) | 0;
        if (nearProtected(protectedRects, cx, cy, (w >> 1) + 120)) continue;

        for (let x = x0; x <= x1; x++) {
          const sY = surface[x] | 0;
          const wav = (G.valueNoise1D(x + 8123, 90) - 0.5);
          const yStart = (sY + roof + ((wav * 6) | 0)) | 0;
          const d = (depth + ((wav * 22) | 0)) | 0;
          if (yStart < 1 || yStart >= H - 2) continue;
          carveRect((x - 1) | 0, yStart, 3, d);
        }
      }
    }

    // A) Surface layering (macro-friendly):
    // - Snow biomes get a stable PACKED_SNOW base + a thin SNOW powder cap
    // - Desert gets a thicker SAND cap
    // - Other biomes get a dirt cap
    // Always avoid touching the protected layout volumes.
    for (let x = 1; x < W - 1; x++) {
      const y0 = surface[x] | 0;
      const b = (G.surfaceBiome ? (G.surfaceBiome[x] | 0) : G.biomeAt(x, (y0 + 10) | 0));
      const protectSpawn = (x >= keepSpawnL && x <= keepSpawnR);

      if (b === G.BIOME.SNOW) {
        let powder = 2 + (G.valueNoise1D(x + 1357, 48) > 0.62 ? 1 : 0);
        let packed = 7 + (((G.valueNoise1D(x + 2468, 90) - 0.5) * 6) | 0);
        packed = clampI(packed, 5, 12);

        if (protectSpawn) {
          // Stable spawn plateau: no loose powder at the very top.
          powder = 0;
          packed = Math.max(packed, 12);
        }

        const total = (powder + packed) | 0;
        for (let k = 0; k < total; k++) {
          const y = (y0 + k) | 0;
          if (y <= 0 || y >= H - 1) break;
          if (inProtected(protectedRects, x, y)) continue;

          const i = G.idx(x, y);
          if (G.mat[i] === MAT.EMPTY) continue;
          G.mat[i] = (k < powder) ? MAT.SNOW : MAT.PACKED_SNOW;
          G.life[i] = 0;
        }

        // Occasional ice lens just below the packed layer (adds variety + "ice caves" vibe)
        if (!protectSpawn && G.valueNoise1D(x + 9991, 120) > 0.78) {
          const iceT = 1 + ((G.valueNoise1D(x + 5555, 60) * 2) | 0);
          for (let k = 0; k < iceT; k++) {
            const y = (y0 + total + k) | 0;
            if (y <= 0 || y >= H - 1) break;
            if (inProtected(protectedRects, x, y)) continue;
            const i = G.idx(x, y);
            if (G.mat[i] === MAT.EMPTY) continue;
            G.mat[i] = MAT.ICE;
            G.life[i] = 0;
          }
        }
      } else if (b === G.BIOME.DESERT) {
        const sandT = 5 + (G.valueNoise1D(x + 2020, 70) > 0.55 ? 2 : 0);
        for (let k = 0; k < sandT; k++) {
          const y = (y0 + k) | 0;
          if (y <= 0 || y >= H - 1) break;
          if (inProtected(protectedRects, x, y)) continue;
          const i = G.idx(x, y);
          if (G.mat[i] === MAT.EMPTY) continue;
          G.mat[i] = MAT.SAND;
          G.life[i] = 0;
        }
      } else {
        const dirtT = 3 + (G.valueNoise1D(x + 7070, 50) > 0.60 ? 1 : 0);
        for (let k = 0; k < dirtT; k++) {
          const y = (y0 + k) | 0;
          if (y <= 0 || y >= H - 1) break;
          if (inProtected(protectedRects, x, y)) continue;
          const i = G.idx(x, y);
          if (G.mat[i] === MAT.EMPTY) continue;
          G.mat[i] = MAT.DIRT;
          G.life[i] = 0;
        }
      }
    }



    // A2) Surface silhouette polishing: edge rounding / de-blocking
    // Purpose: with higher resolution we want less "stair-step" outlines and more organic shapes,
    // closer to handcrafted pixel-art caves/snow shelves.
    // Constraints: ONLY near the surface, ONLY stable solids, NEVER in spawn-safe zone or protected volumes.
    {
      const maxDepth = 240; // how deep from the surface we run the polish
      const passes = 2;

      // quick whitelist (stable materials only)
      const allow = new Uint8Array(256);
      allow[MAT.ROCK] = 1;
      allow[MAT.DARK_ROCK] = 1;
      allow[MAT.SANDSTONE] = 1;
      allow[MAT.PACKED_SNOW] = 1;
      allow[MAT.ICE] = 1;

      for (let pass = 0; pass < passes; pass++) {
        for (let x = 2; x < W - 2; x++) {
          // keep the immediate spawn plateau crisp and safe
          if (x >= (keepSpawnL - 16) && x <= (keepSpawnR + 16)) continue;

          const yMax = clampI((surface[x] + maxDepth) | 0, 2, H - 3);
          for (let y = 2; y <= yMax; y++) {
            if (inProtected(protectedRects, x, y)) continue;

            const i = G.idx(x, y);
            const m = G.mat[i];
            if (!allow[m]) continue;

            // We only want to chip away *visible* contour voxels.
            const up = G.mat[i - W];
            const dn = G.mat[i + W];
            const lf = G.mat[i - 1];
            const rt = G.mat[i + 1];

            const upE = (up === MAT.EMPTY);
            const dnE = (dn === MAT.EMPTY);
            const lfE = (lf === MAT.EMPTY);
            const rtE = (rt === MAT.EMPTY);

            // Convex corners / exposed edges
            const convexTopL = upE && lfE;
            const convexTopR = upE && rtE;
            const convexBotL = dnE && lfE;
            const convexBotR = dnE && rtE;

            if (!(convexTopL || convexTopR || convexBotL || convexBotR)) continue;

            // Deterministic probability (avoid Math.random so seed stays stable)
            const h = G.hash2i(x + pass * 1337, y + pass * 7777) & 255;

            // Snow/ice can be rounded a bit more than rock.
            let thr = 18;
            if (m === MAT.PACKED_SNOW) thr = 32;
            else if (m === MAT.ICE) thr = 26;

            // Don't over-chip: keep some chunks for readable silhouettes.
            if (h >= thr) continue;

            // Avoid creating micro-holes on the *top walkable surface* itself:
            // if up is empty but both sides are solid, it's a flat floor tile.
            if (upE && !lfE && !rtE) continue;

            // Carve this pixel
            G.mat[i] = MAT.EMPTY;
            G.life[i] = 0;
          }
        }
      }
    }

    // A3) Physical surface trees (simulated / cuttable)
    {
      const spawnSafe = (flatW + 260) | 0;

      function findGroundYAt(x) {
        let y = surface[x] | 0;
        if (y < 2 || y >= H - 2) return -1;
        const i0 = G.idx(x, y);
        if (!G.blocksPlayer(G.mat[i0])) {
          for (let yy = 2; yy < H - 2; yy++) {
            const i = G.idx(x, yy);
            if (G.blocksPlayer(G.mat[i])) return yy;
          }
          return -1;
        }
        return y;
      }

      const LEAF_ANCHOR = 6;

      function setLeavesAir(x, y) {
        if (x <= 1 || x >= W - 2 || y <= 1 || y >= H - 2) return;
        const i = G.idx(x, y);
        if (G.mat[i] !== MAT.EMPTY) return;
        G.mat[i] = MAT.LEAVES;
        G.life[i] = LEAF_ANCHOR;
      }

      function setWoodSolid(x, y) {
        if (x <= 1 || x >= W - 2 || y <= 1 || y >= H - 2) return;
        const i = G.idx(x, y);
        G.mat[i] = MAT.WOOD;
        G.life[i] = 0;
      }

      function canPlaceColumn(cx, topY, botY, halfW) {
        if (topY < 2) return false;
        for (let y = topY; y <= botY; y++) {
          for (let x = cx - halfW; x <= cx + halfW; x++) {
            if (x <= 1 || x >= W - 2) return false;
            if (y >= surface[x] && inProtected(protectedRects, x, y)) return false;
            const i = G.idx(x, y);
            if (G.mat[i] !== MAT.EMPTY) return false;
          }
        }
        return true;
      }

      function placePine(cx, groundY, totalH, trunkW) {
        const trunkH = clampI(((totalH * 0.32) | 0) + G.randi(8), 12, totalH - 16);
        const canopyH = Math.max(12, totalH - trunkH);
        const topY = (groundY - totalH) | 0;
        const maxW = clampI(((totalH * 0.35) | 0) + G.randi(6), 8, 26);

        // trunk (solid)
        const tw = clampI(trunkW | 0, 2, 5);
        const tx0 = (cx - ((tw >> 1) | 0)) | 0;
        for (let y = (groundY - trunkH) | 0; y <= (groundY + 1) | 0; y++) {
          for (let x = tx0; x < tx0 + tw; x++) setWoodSolid(x, y);
        }

        // root flare / anchors
        for (let rx = -2; rx <= 2; rx++) {
          setWoodSolid(cx + rx, groundY + 1);
          if ((rx & 1) === 0) setWoodSolid(cx + rx, groundY + 2);
        }

        // canopy (air)
        for (let y = topY; y < topY + canopyH; y++) {
          const t = (y - topY) / Math.max(1, canopyH - 1);
          let w = (2 + (t * maxW)) | 0;
          const wob = (((G.hash2i(cx + 13, y) >>> 3) & 3) - 1); // -1..1
          w = clampI(w + wob, 2, maxW);
          for (let x = cx - w; x <= cx + w; x++) {
            if ((G.hash2i(x, y) & 7) === 0) continue;
            setLeavesAir(x, y);
          }
        }

        // branch tufts
        for (let k = 0; k < 6; k++) {
          const by = (topY + ((k + 2) * (canopyH / 8)) | 0) + G.randi(3);
          const dir = (G.hash2i(cx + k * 19, by) & 1) ? 1 : -1;
          const len = 6 + G.randi(6);
          for (let t = 2; t < len; t++) {
            setLeavesAir(cx + dir * t, by);
            if ((t & 1) === 0) setLeavesAir(cx + dir * t, by + 1);
          }
        }
      }

      function placeOak(cx, groundY, totalH, trunkW) {
        const trunkH = clampI(((totalH * 0.45) | 0) + G.randi(6), 16, totalH - 10);
        const topY = (groundY - totalH) | 0;
        const canopyR = clampI(((totalH * 0.28) | 0) + G.randi(4), 10, 22);
        const canopyY = (groundY - trunkH - (canopyR >> 1)) | 0;

        const tw = clampI(trunkW | 0, 3, 6);
        const tx0 = (cx - ((tw >> 1) | 0)) | 0;
        for (let y = (groundY - trunkH) | 0; y <= (groundY + 1) | 0; y++) {
          for (let x = tx0; x < tx0 + tw; x++) setWoodSolid(x, y);
        }

        for (let y = canopyY - canopyR; y <= canopyY + canopyR; y++) {
          const dy = y - canopyY;
          const ry = canopyR;
          const t = 1 - (dy * dy) / Math.max(1, ry * ry);
          if (t <= 0) continue;
          const w = (canopyR * Math.sqrt(t)) | 0;
          for (let x = cx - w; x <= cx + w; x++) {
            if ((G.hash2i(x + 7, y) & 9) === 0) continue;
            setLeavesAir(x, y);
          }
        }

        // Secondary canopy blobs
        for (let b = 0; b < 2; b++) {
          const ox = (G.randi(10) - 5) | 0;
          const oy = (G.randi(10) - 5) | 0;
          const r = clampI((canopyR * 0.55) | 0, 6, 16);
          for (let y = canopyY + oy - r; y <= canopyY + oy + r; y++) {
            for (let x = cx + ox - r; x <= cx + ox + r; x++) {
              const dx = x - (cx + ox), dy = y - (canopyY + oy);
              if (dx * dx + dy * dy > r * r) continue;
              if ((G.hash2i(x + 11, y) & 7) === 0) continue;
              setLeavesAir(x, y);
            }
          }
        }
      }

      function placeDead(cx, groundY, totalH, trunkW) {
        const trunkH = clampI(((totalH * 0.65) | 0) + G.randi(8), 20, totalH);
        const tw = clampI(trunkW | 0, 2, 4);
        const tx0 = (cx - ((tw >> 1) | 0)) | 0;
        for (let y = (groundY - trunkH) | 0; y <= (groundY + 1) | 0; y++) {
          for (let x = tx0; x < tx0 + tw; x++) setWoodSolid(x, y);
          if ((y % 6) === 0) {
            const dir = ((G.hash2i(cx, y) & 1) ? 1 : -1);
            const len = 6 + (G.hash2i(cx + 11, y) & 3);
            for (let t = 2; t < len; t++) setWoodAir(cx + dir * t, y);
          }
        }
      }

      let placed = 0;
      let x = 18;
      while (x < W - 18) {
        if (Math.abs(x - spawnX) < spawnSafe) { x += 28; continue; }

        const groundY = findGroundYAt(x);
        if (groundY < 8 || groundY >= H - 6) { x += 20; continue; }
        // Protected volumes are underground; trees are above surface.

        const b = (G.surfaceBiome ? (G.surfaceBiome[x] | 0) : G.biomeAt(x, (groundY + 10) | 0));
        const n = G.noise01(x >> 4, groundY >> 3);

        let density = 0.56;
        if (b === G.BIOME.SNOW) density = 0.46;
        else if (b === G.BIOME.MINES) density = 0.54;
        else if (b === G.BIOME.TOXIC) density = 0.55;
        else if (b === G.BIOME.DESERT) density = 0.66;

        if (n > density) { x += 24 + G.randi(24); continue; }

        // Flatness check (avoid steep slopes)
        if (Math.abs((surface[x - 4] | 0) - groundY) > 5 || Math.abs((surface[x + 4] | 0) - groundY) > 5) {
          x += 20; continue;
        }

        const r = G.rand01();
        let totalH = 80 + G.randi(70);
        if (b === G.BIOME.SNOW) totalH = 95 + G.randi(80);
        else if (b === G.BIOME.DESERT) totalH = 60 + G.randi(50);
        else if (b === G.BIOME.TOXIC) totalH = 85 + G.randi(70);
        let trunkW = clampI(((totalH * 0.06) | 0), 3, 7);

        const topY = (groundY - totalH) | 0;
        if (topY < 4) { x += 24; continue; }

        const halfW = clampI(((totalH * 0.24) | 0), 8, 26);
        if (!canPlaceColumn(x, topY, groundY - 2, halfW)) { x += 22; continue; }

        if (b === G.BIOME.DESERT) {
          placeDead(x, groundY, totalH, trunkW);
        } else if (b === G.BIOME.SNOW) {
          placePine(x, groundY, totalH, trunkW);
        } else if (b === G.BIOME.TOXIC) {
          if (r < 0.5) placeOak(x, groundY, totalH, trunkW);
          else placePine(x, groundY, totalH, trunkW);
        } else {
          if (r < 0.6) placeOak(x, groundY, totalH, trunkW);
          else placePine(x, groundY, totalH, trunkW);
        }
        placed++;

        x += 34 + G.randi(48);
      }

      // Fallback: ensure some trees exist (visible + physical)
      if (placed < 2) {
        const base = (spawnX + spawnSafe + 140) | 0;
        for (let k = 0; k < 3; k++) {
          const tx = clampI((base + k * 160) | 0, 40, W - 41);
          if (Math.abs(tx - spawnX) < spawnSafe) continue;
          const gy = findGroundYAt(tx);
          if (gy < 8 || gy >= H - 6) continue;
          placePine(tx, gy, 100 + G.randi(40), 4);
        }
      }
    }

    // B) Decorative pockets outside the playable volume
    // Bigger world => more small voids + a few large caverns for scale.
    const decoCaves = (90 + G.randi(70)) | 0; // 90..159
    for (let c = 0; c < decoCaves; c++) {
      const cx = (40 + G.randi(W - 80)) | 0;
      const minY = (surface[cx] + 110) | 0;
      const cy = (minY + G.randi(Math.max(1, (H - 80) - minY))) | 0;
      if (Math.abs(cx - spawnX) < 220 && cy < (surface[cx] + 240)) continue;
      const r = (6 + G.randi(10)) | 0;
      if (nearProtected(protectedRects, cx, cy, (r + 16) | 0)) continue;
      carveCircle(cx, cy, r);
    }

    // B2) Large caverns (deep) — creates a "deeper" world feel.
    {
      const bigCaves = 6 + G.randi(4); // 6..9
      for (let c = 0; c < bigCaves; c++) {
        const cx = (120 + G.randi(W - 240)) | 0;
        const cy = ((H * 0.68) | 0) + G.randi((H * 0.24) | 0);
        if (Math.abs(cx - spawnX) < 340) continue;
        const r = (70 + G.randi(90)) | 0; // 70..159
        if (nearProtected(protectedRects, cx, cy, (r + 70) | 0)) continue;
        carveCircle(cx, cy, r);
        // Carve a small offset to break perfect circles
        if (G.rand01() < 0.85) carveCircle((cx + (randsym() * (r * 0.35))) | 0, (cy + (randsym() * (r * 0.25))) | 0, (r * 0.85) | 0);
      }
    }

    // C) Liquids pockets (rare) — never near spawn or in protected volumes
    const hazardRate = G.clamp(params.hazardRate ?? 0.20, 0, 1);
    const poolCount = (4 + ((hazardRate * 16) | 0)) | 0;
    for (let p = 0; p < poolCount; p++) {
      const cx = (60 + G.randi(W - 120)) | 0;
      const cy = ((H * 0.62) | 0) + G.randi((H * 0.30) | 0);
      if (Math.abs(cx - spawnX) < 260) continue;
      // Carve a cavity then fill with liquid
      const r = (10 + G.randi(18)) | 0;
      if (nearProtected(protectedRects, cx, cy, (r + 22) | 0)) continue;
      carveCircle(cx, cy, (r + 3) | 0);

      const b = G.biomeAt(cx, cy);
      let m = MAT.WATER;
      if (b === G.BIOME.TOXIC && G.rand01() < 0.55) m = MAT.ACID;
      else if (cy > (H * 0.78) && G.rand01() < 0.25) m = MAT.LAVA;
      else if (G.rand01() < 0.12) m = MAT.OIL;

      if (m === MAT.LAVA) spawnMaterialCircle(cx, cy, r, MAT.LAVA, (220 + G.randi(200)) | 0);
      else spawnMaterialCircle(cx, cy, r, m);
    }

    // D) Mines structures (simple wooden platforms) — only in MINES biome & not in protected volume
    const mines = 18;
    for (let m = 0; m < mines; m++) {
      const cx = (120 + G.randi(W - 240)) | 0;
      const cy = (150 + G.randi(H - 300)) | 0;
      if (G.biomeAt(cx, cy) !== G.BIOME.MINES) continue;
      if (nearProtected(protectedRects, cx, cy, 120)) continue;

      // Small flat room
      const rw = 160;
      const rh = 70;
      carveRect(cx - (rw >> 1), cy - (rh >> 1), rw, rh);

      // Wood floor strip
      for (let x = cx - (rw >> 1) + 8; x <= cx + (rw >> 1) - 8; x++) {
        const y = (cy + (rh >> 1) - 6) | 0;
        if (!G.inb(x, y)) continue;
        const i = G.idx(x, y);
        if (G.mat[i] === MAT.EMPTY) {
          G.mat[i] = MAT.WOOD;
          G.life[i] = 0;
        }
      }

      // Optional small torch
      if (G.rand01() < 0.20) {
        const fx = (cx + G.randi(20) - 10) | 0;
        const fy = (cy - (rh >> 1) + 8) | 0;
        if (G.inb(fx, fy) && G.mat[G.idx(fx, fy)] === MAT.EMPTY) {
          const ii = G.idx(fx, fy);
          G.mat[ii] = MAT.FIRE;
          G.life[ii] = (18 + G.randi(40)) | 0;
        }
      }
    }

    // E) Ice stalactites/stalagmites in snow caves (visual + silhouette)
    // Keep away from the protected main path volumes.
    {
      const rate = +(params.icicleRate ?? 0.70);
      const samples = (5200 + (rate * 8200)) | 0;
      const spawnSafe = (flatW + 420) | 0;
      for (let s = 0; s < samples; s++) {
        const x = (30 + G.randi(W - 60)) | 0;
        if (Math.abs(x - spawnX) < spawnSafe) continue;

        if (G.rand01() > rate) continue;

        // Bias towards near-surface + mid-depth caves (where the look matters most)
        const yMin = (surface[x] + 70) | 0;
        if (yMin >= H - 80) continue;
        const y = (yMin + G.randi(Math.max(1, (H - 80) - yMin))) | 0;

        if (nearProtected(protectedRects, x, y, 80)) continue;
        if (G.biomeAt(x, y) !== G.BIOME.SNOW) continue;

        const i = G.idx(x, y);
        const m = G.mat[i];
        if (!G.isTerrain(m)) continue;

        // Ceiling icicle: solid cell with air below.
        const below = G.mat[i + W];
        if (below === MAT.EMPTY) {
          const len = (4 + G.randi(18)) | 0;
          const wid = (1 + (G.randi(3) & 1)) | 0; // 1 or 2
          const matIc = (G.rand01() < (0.55 + rate * 0.25)) ? MAT.ICE : MAT.PACKED_SNOW;
          for (let yy = 1; yy <= len; yy++) {
            const ww = Math.max(0, wid - ((yy / 6) | 0));
            for (let xx = -ww; xx <= ww; xx++) {
              const xx2 = (x + xx) | 0;
              const yy2 = (y + yy) | 0;
              if (xx2 < 2 || xx2 >= W - 2 || yy2 < 2 || yy2 >= H - 2) continue;
              if (nearProtected(protectedRects, xx2, yy2, 22)) continue;
              const ii = G.idx(xx2, yy2);
              if (G.mat[ii] !== MAT.EMPTY) continue;
              G.mat[ii] = matIc;
              G.life[ii] = 0;
            }
          }
        }
      }
    }
  }

  function validateLayout(layout, attemptIndex) {
    // Simple but robust: clearance flood-fill on a coarse grid (4x4)
    // from the entrance to the goal.

    // Spawn safety check (ground exists under the spawn plateau)
    const spawnX = (W * 0.5) | 0;
    let groundY = -1;
    for (let y = 10; y < H - 20; y++) {
      const m = G.mat[G.idx(spawnX, y)];
      if (G.blocksPlayer(m)) {
        groundY = y | 0;
        break;
      }
    }
    if (groundY < 0) {
      return { ok: false, reason: 'no spawn ground', tries: (attemptIndex + 1) | 0, pathLen: 0 };
    }

    // Clearance test for the player's body centered at (x,y)
    const halfW = 4;
    const halfH = 10;
    const SAMPLES = [
      [-halfW, -halfH], [halfW, -halfH],
      [-halfW, 0], [halfW, 0],
      [-halfW, halfH], [halfW, halfH],
      [0, -halfH], [0, halfH],
    ];

    function clearanceOK(x, y) {
      for (let i = 0; i < SAMPLES.length; i++) {
        const sx = (x + SAMPLES[i][0]) | 0;
        const sy = (y + SAMPLES[i][1]) | 0;
        if (sx < 1 || sx >= W - 1 || sy < 1 || sy >= H - 1) return false;
        if (G.blocksPlayer(G.mat[G.idx(sx, sy)])) return false;
      }
      return true;
    }

    const ds = 4;
    const gridW = (W / ds) | 0;
    const gridH = (H / ds) | 0;
    const gridN = (gridW * gridH) | 0;

    const free = new Uint8Array(gridN);
    for (let gy = 0; gy < gridH; gy++) {
      const wy = (gy * ds + (ds >> 1)) | 0;
      for (let gx = 0; gx < gridW; gx++) {
        const wx = (gx * ds + (ds >> 1)) | 0;
        free[gx + gy * gridW] = clearanceOK(wx, wy) ? 1 : 0;
      }
    }

    const toId = (pt) => {
      const gx = clampI((pt.x / ds) | 0, 0, gridW - 1);
      const gy = clampI((pt.y / ds) | 0, 0, gridH - 1);
      return (gx + gy * gridW) | 0;
    };

    function nearestFree(id) {
      if (free[id]) return id;
      const sx = id % gridW;
      const sy = (id / gridW) | 0;
      const maxR = 8;
      for (let r = 1; r <= maxR; r++) {
        for (let oy = -r; oy <= r; oy++) {
          for (let ox = -r; ox <= r; ox++) {
            if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
            const x = sx + ox;
            const y = sy + oy;
            if (x < 0 || x >= gridW || y < 0 || y >= gridH) continue;
            const nid = (x + y * gridW) | 0;
            if (free[nid]) return nid;
          }
        }
      }
      return -1;
    }

    let start = nearestFree(toId(layout.entrance));
    let goal = nearestFree(toId(layout.goal));

    if (start < 0 || goal < 0) {
      return { ok: false, reason: 'start/goal blocked', tries: (attemptIndex + 1) | 0, pathLen: 0, ds, gridW, gridH };
    }

    const parent = new Int32Array(gridN);
    parent.fill(-1);
    const q = new Int32Array(gridN);
    let qh = 0, qt = 0;

    parent[start] = start;
    q[qt++] = start;

    const NEI = [1, -1, gridW, -gridW];
    let found = false;

    while (qh < qt) {
      const cur = q[qh++];
      if (cur === goal) {
        found = true;
        break;
      }

      const cx = cur % gridW;
      const cy = (cur / gridW) | 0;

      // 4-neighbor BFS
      for (let k = 0; k < 4; k++) {
        let nxt = (cur + NEI[k]) | 0;

        // horizontal wrap guards
        if (k === 0 && cx === gridW - 1) continue;
        if (k === 1 && cx === 0) continue;
        if (k === 2 && cy === gridH - 1) continue;
        if (k === 3 && cy === 0) continue;

        if (!free[nxt]) continue;
        if (parent[nxt] !== -1) continue;

        parent[nxt] = cur;
        q[qt++] = nxt;
      }
    }

    if (!found) {
      return { ok: false, reason: 'no path', tries: (attemptIndex + 1) | 0, pathLen: 0, ds, gridW, gridH };
    }

    // Reconstruct path for debug
    const path = [];
    let cur = goal;
    let guard = 0;
    while (cur !== start && guard++ < gridN) {
      path.push(cur);
      cur = parent[cur];
      if (cur < 0) break;
    }
    path.push(start);
    path.reverse();

    return {
      ok: true,
      reason: 'ok',
      tries: (attemptIndex + 1) | 0,
      pathLen: path.length | 0,
      ds,
      gridW,
      gridH,
      path,
    };
  }

  // =========================================================
  // World generation v2 (density + CA + biomes)
  // =========================================================
  const GEN2 = () => (G.CONF && G.CONF.LEVEL_GEN2) || {};

  const GEN2_PARAM_DEFS = {
    surfaceBase: { min: 0.10, max: 0.35, step: 0.02 },
    surfaceAmp: { min: 0.10, max: 0.35, step: 0.02 },
    surfaceScale: { min: 140, max: 360, step: 20 },
    surfaceWarpScale: { min: 240, max: 760, step: 40 },
    surfaceWarpAmp: { min: 10, max: 90, step: 6 },

    densityScale: { min: 50, max: 140, step: 8 },
    densityAmp: { min: 0.30, max: 0.85, step: 0.05 },
    ridgeAmp: { min: 0.15, max: 0.75, step: 0.05 },
    warpScale: { min: 70, max: 220, step: 10 },
    warpAmp: { min: 10, max: 70, step: 4 },

    caveFill: { min: 0.40, max: 0.68, step: 0.02 },
    caveIter: { min: 2, max: 6, step: 1 },
    caveScale: { min: 2, max: 3, step: 1 },
    caveMinDepth: { min: 14, max: 50, step: 4 },

    erosionPasses: { min: 1, max: 4, step: 1 },
    slumpRate: { min: 0.02, max: 0.20, step: 0.02 },

    oreRate: { min: 0.08, max: 0.30, step: 0.02 },
    oreScale: { min: 28, max: 80, step: 4 },
    pocketRate: { min: 0.04, max: 0.18, step: 0.02 },
    pocketScale: { min: 40, max: 120, step: 6 },

    tunnelCount: { min: 2, max: 8, step: 1 },
  };

  G.genDebugModeCount = 8;

  function cloneParams(p) {
    return JSON.parse(JSON.stringify(p));
  }

  function applyGen2Preset(index) {
    const gen = GEN2();
    const presets = gen.presets || [];
    if (!presets.length) return null;
    const idx = ((index | 0) % presets.length + presets.length) % presets.length;
    const preset = presets[idx];
    G.genPresetIndex = idx;
    G.genPresetName = preset.name || `Preset${idx}`;
    G.genParams = cloneParams(preset.params || {});
    return G.genParams;
  }

  function ensureGen2Params() {
    if (!G.genParams) {
      const gen = GEN2();
      applyGen2Preset(gen.presetIndex | 0);
    }
    return G.genParams || {};
  }

  G.genNextPreset = () => {
    const gen = GEN2();
    const presets = gen.presets || [];
    if (!presets.length) return;
    const next = ((G.genPresetIndex | 0) + 1) % presets.length;
    applyGen2Preset(next);
    if (G.resetWorldWithSeed) G.resetWorldWithSeed(G.seed | 0);
  };

  G.genMutateParam = () => {
    const p = ensureGen2Params();
    const keys = Object.keys(GEN2_PARAM_DEFS);
    if (!keys.length) return;
    const key = keys[G.randi(keys.length)];
    const def = GEN2_PARAM_DEFS[key];
    let v = +p[key];
    if (!Number.isFinite(v)) v = def.min + (def.max - def.min) * 0.5;
    const dir = (G.rand01() < 0.5) ? -1 : 1;
    v += dir * def.step;
    if (def.min !== undefined) v = Math.max(def.min, v);
    if (def.max !== undefined) v = Math.min(def.max, v);
    p[key] = v;
    G.genLastMutate = `${key}=${v.toFixed(2)}`;
    if (G.resetWorldWithSeed) G.resetWorldWithSeed(G.seed | 0);
  };

  G.genRegen = () => {
    if (G.resetWorldWithSeed) G.resetWorldWithSeed(G.seed | 0);
  };

  G.genCycleDebugMode = () => {
    G.genDebug = G.genDebug || {};
    const modes = G.genDebugModeCount || 7;
    G.genDebug.mode = ((G.genDebug.mode | 0) + 1) % modes;
  };

  function ridge01(n) {
    return 1 - Math.abs(n * 2 - 1);
  }

  function fbm2(x, y, scale, oct = 4) {
    let amp = 0.55;
    let sum = 0;
    let norm = 0;
    let sc = scale;
    for (let o = 0; o < oct; o++) {
      sum += amp * G.valueNoise2D(x + o * 997, y + o * 1319, sc);
      norm += amp;
      amp *= 0.5;
      sc *= 0.5;
    }
    return norm > 0 ? (sum / norm) : 0.5;
  }

  function fbm1(x, scale, oct = 4) {
    let amp = 0.55;
    let sum = 0;
    let norm = 0;
    let sc = scale;
    for (let o = 0; o < oct; o++) {
      sum += amp * G.valueNoise1D(x + o * 733, sc);
      norm += amp;
      amp *= 0.5;
      sc *= 0.5;
    }
    return norm > 0 ? (sum / norm) : 0.5;
  }

  function buildBiomeMap(p) {
    const bw = 96;
    const bh = 48;
    const map = new Uint8Array(bw * bh);

    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const wx = (x / bw) * W;
        const wy = (y / bh) * H;

        const t0 = fbm2(wx + 2000, wy + 7000, 240, 3);
        const h0 = fbm2(wx + 9000, wy + 1100, 240, 3);

        let temp = t0;
        let humid = h0;

        // Temperature bias: higher altitude -> colder
        const alt = 1 - (wy / H);
        temp = temp * 0.75 + alt * 0.25;

        let biome = G.BIOME.MINES;
        if (temp < 0.36) biome = G.BIOME.SNOW;
        else if (temp > 0.70 && humid < 0.42) biome = G.BIOME.DESERT;
        else if (humid > 0.64) biome = G.BIOME.TOXIC;

        map[x + y * bw] = biome;
      }
    }

    G.biomeMapW = bw;
    G.biomeMapH = bh;
    G.biomeMap = map;
    G.biomeAt = (x, y) => {
      const bx = clampI(((x / W) * bw) | 0, 0, bw - 1);
      const by = clampI(((y / H) * bh) | 0, 0, bh - 1);
      return map[bx + by * bw] | 0;
    };
    G.getActiveBiome = () => {
      const px = (G.player?.x ?? (W * 0.5)) | 0;
      const py = (G.player?.y ?? (H * 0.2)) | 0;
      return G.biomeAt(px, py) | 0;
    };
  }

  function buildHeightmap(p) {
    const base = (H * p.surfaceBase);
    const surface = new Int16Array(W);
    surface.fill(base | 0);

    // Macro features (hills, valleys, ridges, plateaus, cliffs, talus)
    const featureCount = clampI(p.featureCount | 0, 8, 40);
    const ampMin = p.featureAmpMin ?? 20;
    const ampMax = p.featureAmpMax ?? 140;
    const wMin = p.featureWidthMin ?? 80;
    const wMax = p.featureWidthMax ?? 600;

    const wCliff = p.featureCliffChance ?? 0.10;
    const wPlateau = p.featurePlateauChance ?? 0.18;
    const wValley = p.featureValleyChance ?? 0.18;
    const wRidge = p.featureRidgeChance ?? 0.18;

    function bump(t) {
      if (t <= 0) return 0;
      return t * t * (3 - 2 * t);
    }

    for (let i = 0; i < featureCount; i++) {
      const x0 = (G.rand01() * (W - 1)) | 0;
      const w = clampI((wMin + G.rand01() * (wMax - wMin)) | 0, 20, W - 1);
      const a = (ampMin + G.rand01() * (ampMax - ampMin));

      const r = G.rand01();
      let type = 'hill';
      const t1 = wCliff;
      const t2 = t1 + wPlateau;
      const t3 = t2 + wValley;
      const t4 = t3 + wRidge;
      if (r < t1) type = 'cliff';
      else if (r < t2) type = 'plateau';
      else if (r < t3) type = 'valley';
      else if (r < t4) type = 'ridge';

      const xL = Math.max(1, x0 - w);
      const xR = Math.min(W - 2, x0 + w);
      for (let x = xL; x <= xR; x++) {
        const t = (x - x0) / Math.max(1, w);
        const at = Math.abs(t);
        let f = 0;

        if (type === 'hill') {
          f = bump(1 - at);
          surface[x] += (a * f) | 0;
        } else if (type === 'valley') {
          f = bump(1 - at);
          surface[x] -= (a * f) | 0;
        } else if (type === 'ridge') {
          f = Math.pow(bump(1 - at), 0.6);
          surface[x] += (a * f) | 0;
        } else if (type === 'plateau') {
          const p0 = 0.35;
          if (at < p0) f = 1;
          else f = bump(1 - (at - p0) / Math.max(1e-6, (1 - p0)));
          surface[x] += (a * f) | 0;
        } else if (type === 'cliff') {
          const stepW = Math.max(8, (w * 0.12) | 0);
          const d = x - x0;
          if (Math.abs(d) <= stepW) {
            f = bump(1 - Math.abs(d) / stepW);
            surface[x] += (a * f) | 0;
          } else if (d > 0) {
            surface[x] += (a * 0.9) | 0;
          }
        } else {
          // talus (long slope)
          f = (t + 1) * 0.5;
          surface[x] += (a * (f - 0.5)) | 0;
        }
      }
    }

    // Multi-scale noise + warp
    for (let x = 0; x < W; x++) {
      const warp = (G.valueNoise1D(x + 9000, p.surfaceWarpScale) - 0.5) * p.surfaceWarpAmp;
      const n = fbm1(x + warp, p.surfaceScale, 4);
      const amp = (H * p.surfaceAmp);
      let h = surface[x] + ((n - 0.5) * amp) + warp * 0.2;
      h = clampI(h | 0, 16, H - 32);
      surface[x] = h;
    }
    return surface;
  }

  function applySpawnPlateau(surface, flatW) {
    const spawnX = (W * 0.5) | 0;
    const half = (flatW >> 1) | 0;
    const left = Math.max(2, (spawnX - half) | 0);
    const right = Math.min(W - 3, (spawnX + half) | 0);
    const plateauY = surface[spawnX] | 0;

    const orig = new Int16Array(surface);
    for (let x = left; x <= right; x++) surface[x] = plateauY;

    const maxStep = 6;
    const ramp = 80;
    for (let x = left - ramp; x < left; x++) {
      if (x < 2 || x >= W - 2) continue;
      const t = (x - (left - ramp)) / ramp;
      const u = G.smoothstep(G.clamp(t, 0, 1));
      surface[x] = ((orig[x] * (1 - u) + plateauY * u) | 0);
    }
    for (let x = right + 1; x <= right + ramp; x++) {
      if (x < 2 || x >= W - 2) continue;
      const t = (x - (right + 1)) / ramp;
      const u = G.smoothstep(G.clamp(t, 0, 1));
      surface[x] = ((plateauY * (1 - u) + orig[x] * u) | 0);
    }

    for (let x = 1; x < W; x++) {
      const d = surface[x] - surface[x - 1];
      if (d > maxStep) surface[x] = surface[x - 1] + maxStep;
      else if (d < -maxStep) surface[x] = surface[x - 1] - maxStep;
    }
    for (let x = W - 2; x >= 0; x--) {
      const d = surface[x] - surface[x + 1];
      if (d > maxStep) surface[x] = surface[x + 1] + maxStep;
      else if (d < -maxStep) surface[x] = surface[x + 1] - maxStep;
    }
  }

  function densityAt(x, y, surfaceY, p) {
    const wx = x;
    const wy = y;

    const warpX = (G.valueNoise2D(wx + 1111, wy + 2222, p.warpScale) - 0.5) * p.warpAmp;
    const warpY = (G.valueNoise2D(wx + 3333, wy + 4444, p.warpScale) - 0.5) * p.warpAmp;

    const n = fbm2(wx + warpX, wy + warpY, p.densityScale, 4) - 0.5;
    const r = ridge01(G.valueNoise2D(wx + warpX + 5555, wy + warpY + 6666, p.densityScale * 0.7)) - 0.5;

    const depth = (y - surfaceY) / Math.max(1, p.densityScale);
    return depth + n * p.densityAmp + r * p.ridgeAmp;
  }

  function genCavesCA(surface, p) {
    const ds = p.caveScale | 0;
    const cw = (W / ds) | 0;
    const ch = (H / ds) | 0;
    const cave = new Uint8Array(cw * ch);

    for (let y = 1; y < ch - 1; y++) {
      for (let x = 1; x < cw - 1; x++) {
        const wx = x * ds;
        const wy = y * ds;
        const surfY = surface[clampI(wx, 0, W - 1)] | 0;
        if (wy < (surfY + p.caveMinDepth)) {
          cave[x + y * cw] = 1;
          continue;
        }
        const n = G.valueNoise2D(wx + 7777, wy + 8888, 32);
        cave[x + y * cw] = (n < p.caveFill) ? 1 : 0;
      }
    }

    const iter = clampI(p.caveIter | 0, 1, 8);
    const tmp = new Uint8Array(cave.length);
    for (let it = 0; it < iter; it++) {
      for (let y = 1; y < ch - 1; y++) {
        for (let x = 1; x < cw - 1; x++) {
          const i = x + y * cw;
          let c = 0;
          c += cave[i - cw - 1]; c += cave[i - cw]; c += cave[i - cw + 1];
          c += cave[i - 1]; c += cave[i + 1];
          c += cave[i + cw - 1]; c += cave[i + cw]; c += cave[i + cw + 1];
          tmp[i] = (c >= 5) ? 1 : 0;
        }
      }
      cave.set(tmp);
    }

    // Keep largest open region
    const visited = new Uint8Array(cave.length);
    let bestCount = -1;
    let bestSeed = -1;
    const q = new Int32Array(cave.length);

    for (let y = 1; y < ch - 1; y++) {
      for (let x = 1; x < cw - 1; x++) {
        const i = x + y * cw;
        if (visited[i] || cave[i] !== 0) continue;
        let qh = 0, qt = 0, count = 0;
        visited[i] = 1;
        q[qt++] = i;
        while (qh < qt) {
          const cur = q[qh++];
          count++;
          const cx = cur % cw;
          const cy = (cur / cw) | 0;
          const nei = [cur - 1, cur + 1, cur - cw, cur + cw];
          for (let k = 0; k < 4; k++) {
            const ni = nei[k];
            const nx = ni % cw;
            const ny = (ni / cw) | 0;
            if (nx <= 0 || nx >= cw - 1 || ny <= 0 || ny >= ch - 1) continue;
            if (visited[ni] || cave[ni] !== 0) continue;
            visited[ni] = 1;
            q[qt++] = ni;
          }
        }
        if (count > bestCount) { bestCount = count; bestSeed = i; }
      }
    }

    if (bestSeed >= 0) {
      const keep = new Uint8Array(cave.length);
      const q2 = new Int32Array(cave.length);
      let qh = 0, qt = 0;
      keep[bestSeed] = 1;
      q2[qt++] = bestSeed;
      while (qh < qt) {
        const cur = q2[qh++];
        const cx = cur % cw;
        const cy = (cur / cw) | 0;
        const nei = [cur - 1, cur + 1, cur - cw, cur + cw];
        for (let k = 0; k < 4; k++) {
          const ni = nei[k];
          const nx = ni % cw;
          const ny = (ni / cw) | 0;
          if (nx <= 0 || nx >= cw - 1 || ny <= 0 || ny >= ch - 1) continue;
          if (keep[ni]) continue;
          if (cave[ni] !== 0) continue;
          keep[ni] = 1;
          q2[qt++] = ni;
        }
      }
      for (let i = 0; i < cave.length; i++) {
        if (cave[i] === 0 && !keep[i]) cave[i] = 1;
      }
    }

    let openCount = 0;
    for (let i = 0; i < cave.length; i++) if (cave[i] === 0) openCount++;
    const openRatio = openCount / Math.max(1, cave.length);
    return { cave, cw, ch, ds, openRatio };
  }

  function carveFromCaves(caveData) {
    const { cave, cw, ch, ds } = caveData;
    for (let y = 1; y < ch - 1; y++) {
      for (let x = 1; x < cw - 1; x++) {
        if (cave[x + y * cw] !== 0) continue;
        const wx = x * ds;
        const wy = y * ds;
        for (let yy = 0; yy < ds; yy++) {
          for (let xx = 0; xx < ds; xx++) {
            const gx = wx + xx;
            const gy = wy + yy;
            if (gx <= 1 || gx >= W - 1 || gy <= 1 || gy >= H - 1) continue;
            const i = G.idx(gx, gy);
            G.mat[i] = MAT.EMPTY;
            G.life[i] = 0;
          }
        }
      }
    }
  }

  function carveWorm(ax, ay, bx, by, r) {
    let x = ax, y = ay;
    const maxSteps = 2000;
    for (let s = 0; s < maxSteps; s++) {
      const dx = bx - x;
      const dy = by - y;
      const d = Math.hypot(dx, dy);
      if (d < r + 2) break;
      const nx = dx / Math.max(1e-6, d);
      const ny = dy / Math.max(1e-6, d);
      const jx = (G.rand01() - 0.5) * 1.2;
      const jy = (G.rand01() - 0.5) * 1.2;
      x += (nx + jx) * 2.4;
      y += (ny + jy) * 2.4;
      carveCircle(x | 0, y | 0, r);
    }
  }

  function applyErosion(surface, p) {
    const passes = clampI(p.erosionPasses | 0, 1, 5);
    const slump = +(p.slumpRate || 0.08);

    for (let pass = 0; pass < passes; pass++) {
      for (let x = 2; x < W - 2; x++) {
        const yMax = clampI((surface[x] + 220) | 0, 2, H - 3);
        for (let y = 2; y <= yMax; y++) {
          const i = G.idx(x, y);
          const m = G.mat[i];
          if (!G.isTerrain(m)) continue;
          const below = G.mat[i + W];
          if (below !== MAT.EMPTY) continue;
          if (G.rand01() > slump) continue;
          G.swapCells(i, i + W);
        }
      }
    }
  }

  function applyStrata(surface, p) {
    if (G.grassMask) G.grassMask.fill(0);
    for (let x = 1; x < W - 1; x++) {
      const y0 = surface[x] | 0;
      const biome = G.surfaceBiome ? (G.surfaceBiome[x] | 0) : G.biomeAt(x, y0);

      const slope = Math.abs((surface[x + 1] | 0) - (surface[x - 1] | 0));
      const curvature = ((surface[x - 1] | 0) + (surface[x + 1] | 0) - 2 * y0);

      let topMat = MAT.DIRT;
      let topDepth = 3;
      if (biome === G.BIOME.SNOW) { topMat = MAT.SNOW; topDepth = 3; }
      if (biome === G.BIOME.DESERT) { topMat = MAT.SAND; topDepth = 4; }
      if (biome === G.BIOME.TOXIC) { topMat = MAT.DIRT; topDepth = 3; }

      // Soil thickness modulation
      let soil = topDepth + clampI((curvature * 0.45) | 0, -2, 4);
      soil = clampI(soil, 2, 10);
      if (biome === G.BIOME.DESERT) soil = clampI(soil - 1, 2, 8);
      topDepth = soil;
      if (G.soilThickness) G.soilThickness[x] = topDepth;

      for (let k = 0; k < topDepth; k++) {
        const y = (y0 + k) | 0;
        if (y <= 1 || y >= H - 1) break;
        const i = G.idx(x, y);
        if (G.mat[i] === MAT.EMPTY) continue;
        G.mat[i] = topMat;
        G.life[i] = 0;

        // Grass mask: only on gentle slopes and exposed top layer
        if (k === 0 && topMat === MAT.DIRT && slope < 6) {
          if (G.grassMask) G.grassMask[i] = 1;
        }
      }
    }

    // Base rock + ore pockets
    for (let y = 2; y < H - 2; y++) {
      for (let x = 2; x < W - 2; x++) {
        const i = G.idx(x, y);
        if (G.mat[i] === MAT.EMPTY) continue;
        const biome = G.biomeAt(x, y);
        let base = MAT.ROCK;
        if (biome === G.BIOME.DESERT) base = MAT.SANDSTONE;
        if (biome === G.BIOME.TOXIC) base = MAT.ROCK;

        const depth = y - (G.surfaceY ? (G.surfaceY[x] | 0) : 0);
        if (depth > 220 && G.valueNoise2D(x + 111, y + 333, p.oreScale) < p.oreRate) base = MAT.DARK_ROCK;
        if (depth > 120 && G.valueNoise2D(x + 777, y + 999, p.pocketScale) < p.pocketRate) base = MAT.SANDSTONE;

        G.mat[i] = base;
        G.life[i] = 0;
      }
    }

    // Liquid pockets (rare)
    const pockets = 16 + G.randi(10);
    for (let n = 0; n < pockets; n++) {
      const cx = 80 + G.randi(W - 160);
      const cy = 120 + G.randi(H - 200);
      const depth = cy - (G.surfaceY ? (G.surfaceY[cx] | 0) : 0);
      if (depth < 80) continue;
      const biome = G.biomeAt(cx, cy);
      const r = 8 + G.randi(18);
      carveCircle(cx, cy, r);
      let mat = MAT.WATER;
      if (depth > 420) mat = MAT.LAVA;
      if (biome === G.BIOME.TOXIC) mat = MAT.ACID;
      G.fillCircle(cx, cy, r - 1, mat, 0, (cur) => (cur === MAT.EMPTY || G.isGas(cur)));
    }
  }

  function generateWorldV2() {
    const p = ensureGen2Params();
    if (G.setLoading) G.setLoading('Generating terrain...', 0.25);

    // clear world
    G.clearWorld();

    // biomes
    buildBiomeMap(p);

    // heightmap
    const surface = buildHeightmap(p);
    const flatW = (G.CONF?.LEVEL_GEN?.spawnFlatWidth ?? 320) | 0;
    applySpawnPlateau(surface, flatW);

    // density field -> fill
    for (let x = 1; x < W - 1; x++) {
      const sy = surface[x] | 0;
      for (let y = 1; y < H - 1; y++) {
        const d = densityAt(x, y, sy, p);
        if (y < sy - 2) {
          G.mat[G.idx(x, y)] = MAT.EMPTY;
          continue;
        }
        G.mat[G.idx(x, y)] = (d > 0) ? MAT.ROCK : MAT.EMPTY;
      }
    }

    // Optional caves (disabled by default)
    let caveData = null;
    if (p.enableCaves) {
      caveData = genCavesCA(surface, p);
      if (caveData.openRatio < 0.22) {
        const extra = 10 + G.randi(8);
        for (let k = 0; k < extra; k++) {
          const cx = 60 + G.randi(W - 120);
          const cy = (surface[cx] + 140 + G.randi(260)) | 0;
          carveCircle(cx, cy, 8 + G.randi(14));
        }
      } else if (caveData.openRatio > 0.64) {
        const fill = 1600 + G.randi(600);
        for (let k = 0; k < fill; k++) {
          const cx = 40 + G.randi(W - 80);
          const cy = 120 + G.randi(H - 200);
          const i = G.idx(cx, cy);
          if (G.mat[i] === MAT.EMPTY && (cy > (surface[cx] + 40))) {
            G.mat[i] = MAT.ROCK;
            G.life[i] = 0;
          }
        }
      }
      carveFromCaves(caveData);
    }

    // Spawn clearance (surface only, no caves)
    const spawnX = (W * 0.5) | 0;
    const spawnY = Math.max(8, (surface[spawnX] - 8) | 0);
    carveCircle(spawnX, spawnY, 8);

    // erosion
    applyErosion(surface, p);

    // strata + pockets
    writeSurfaceArrays(surface);
    applyStrata(surface, p);

    // borders
    addBorders();

    // debug maps
    const DBG_DS = 4;
    const mapW = (W / DBG_DS) | 0;
    const mapH = (H / DBG_DS) | 0;
    const densityMap = new Uint8Array(mapW * mapH);
    const solidMap = new Uint8Array(mapW * mapH);
    const biomeMap = new Uint8Array(mapW * mapH);
    const heightMap = new Uint16Array(mapW);
    const slopeMap = new Uint8Array(mapW * mapH);
    const soilMap = new Uint8Array(mapW * mapH);
    const grassMap = new Uint8Array(mapW * mapH);

    for (let y = 0; y < mapH; y++) {
      for (let x = 0; x < mapW; x++) {
        const wx = x * DBG_DS;
        const wy = y * DBG_DS;
        const sy = surface[clampI(wx, 0, W - 1)] | 0;
        const d = densityAt(wx, wy, sy, p);
        const v = clampI(((d + 1) * 0.5 * 255) | 0, 0, 255);
        const idx = x + y * mapW;
        densityMap[idx] = v;
        solidMap[idx] = (G.mat[G.idx(wx, wy)] !== MAT.EMPTY) ? 255 : 0;
        biomeMap[idx] = G.biomeAt(wx, wy);
        const s = Math.abs((surface[clampI(wx + 1, 0, W - 1)] | 0) - (surface[clampI(wx - 1, 0, W - 1)] | 0));
        slopeMap[idx] = clampI((s * 10) | 0, 0, 255);
        const soil = G.soilThickness ? (G.soilThickness[clampI(wx, 0, W - 1)] | 0) : 0;
        soilMap[idx] = clampI(soil * 18, 0, 255);
        grassMap[idx] = (G.grassMask && G.grassMask[G.idx(wx, wy)]) ? 255 : 0;
      }
    }
    for (let x = 0; x < mapW; x++) {
      const wx = x * DBG_DS;
      const h = surface[clampI(wx, 0, W - 1)] | 0;
      heightMap[x] = clampI(((h / H) * mapH) | 0, 0, mapH - 1);
    }

    G.genDebug = {
      mapW,
      mapH,
      density: densityMap,
      solid: solidMap,
      biome: biomeMap,
      height: heightMap,
      slope: slopeMap,
      soil: soilMap,
      grass: grassMap,
      seed: G.seed | 0,
      presetName: G.genPresetName,
      params: [
        `SURF ${p.surfaceBase.toFixed(2)} A${p.surfaceAmp.toFixed(2)}`,
        `DENS ${p.densityAmp.toFixed(2)} R${p.ridgeAmp.toFixed(2)}`,
        `CAVE ${p.enableCaves ? 'ON' : 'OFF'}`,
        `WARP ${p.warpAmp | 0}`,
        `ORE ${p.oreRate.toFixed(2)}`,
        (G.genLastMutate ? `MUT ${G.genLastMutate}` : ''),
      ].filter(Boolean),
      mode: (G.genDebug && G.genDebug.mode) ? (G.genDebug.mode | 0) : 0,
    };

    if (G.bgDeco) G.bgDeco.fill(0);
    if (G.enableSkyDecor) generateSkyDecor(surface, {});
  }

  function generateWorld() {
    // Use new pipeline
    G._bulkGen = true;
    generateWorldV2();

    // End of bulk generation.
    G._bulkGen = false;

    // Rebuild chunk metadata after raw generation.
    if (G.rebuildChunkMeta) G.rebuildChunkMeta();

    // Initialise temperature field.
    if (G.initTemperature) G.initTemperature();

    // Rebuild visuals
    if (G.rebuildBgCache) G.rebuildBgCache();
  }
  G.generateWorld = generateWorld;
})();
