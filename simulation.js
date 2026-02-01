'use strict';
(() => {
  const G = (window.G = window.G || {});
  const C = G.CONF;
  const { WORLD_W: W, WORLD_H: H } = C;
  const { MAT } = G;

  const CHUNK = G.CHUNK;
  const CHW = CHUNK?.W ?? 0;
  const CHH = CHUNK?.H ?? 0;
  const CSHIFT = CHUNK?.SHIFT ?? 5;

  // Helper: clamp an active area to world bounds (inner border)
  function clampRegion(x0, y0, x1, y1) {
    x0 = G.clamp(x0 | 0, 1, W - 2);
    y0 = G.clamp(y0 | 0, 1, H - 2);
    x1 = G.clamp(x1 | 0, 1, W - 2);
    y1 = G.clamp(y1 | 0, 1, H - 2);
    if (x1 < x0) { const t = x0; x0 = x1; x1 = t; }
    if (y1 < y0) { const t = y0; y0 = y1; y1 = t; }
    return { x0, y0, x1, y1 };
  }

  // ------------------------------
  // Movement primitives
  // ------------------------------
  function tryMovePowder(x, y, i, self) {
    if (y >= H - 2) return;
    const below = i + W;
    const mb = G.mat[below];

    // Powder sinks through gases and lighter liquids
    if (
      mb === MAT.EMPTY ||
      G.isGas(mb) ||
      (G.isLiquid(mb) && G.density[mb] < G.density[self])
    ) {
      G.swapCells(i, below);
      return;
    }

    // Diagonal
    const dir = (G.rand01() < 0.5) ? -1 : 1;
    let nx = x + dir;
    if (nx > 0 && nx < W - 1) {
      const ni = below + dir;
      const mn = G.mat[ni];
      if (
        mn === MAT.EMPTY ||
        G.isGas(mn) ||
        (G.isLiquid(mn) && G.density[mn] < G.density[self])
      ) {
        G.swapCells(i, ni);
        return;
      }
    }

    nx = x - dir;
    if (nx > 0 && nx < W - 1) {
      const ni = below - dir;
      const mn = G.mat[ni];
      if (
        mn === MAT.EMPTY ||
        G.isGas(mn) ||
        (G.isLiquid(mn) && G.density[mn] < G.density[self])
      ) {
        G.swapCells(i, ni);
        return;
      }
    }
  }

  function tryMoveLiquid(x, y, i, self, spread = 4) {
    if (y >= H - 2) return;
    const selfD = G.density[self];

    const below = i + W;
    const mb = G.mat[below];

    // Liquid sinks through gases and lighter liquids
    if (
      mb === MAT.EMPTY ||
      G.isGas(mb) ||
      (G.isLiquid(mb) && G.density[mb] < selfD)
    ) {
      G.swapCells(i, below);
      return;
    }

    // Diagonal down
    const dir = (G.rand01() < 0.5) ? -1 : 1;
    let nx = x + dir;
    if (nx > 0 && nx < W - 1) {
      const ni = below + dir;
      const mn = G.mat[ni];
      if (
        mn === MAT.EMPTY ||
        G.isGas(mn) ||
        (G.isLiquid(mn) && G.density[mn] < selfD)
      ) {
        G.swapCells(i, ni);
        return;
      }
    }

    nx = x - dir;
    if (nx > 0 && nx < W - 1) {
      const ni = below - dir;
      const mn = G.mat[ni];
      if (
        mn === MAT.EMPTY ||
        G.isGas(mn) ||
        (G.isLiquid(mn) && G.density[mn] < selfD)
      ) {
        G.swapCells(i, ni);
        return;
      }
    }

    // Horizontal spread (simple, stable)
    const dir2 = (G.rand01() < 0.5) ? -1 : 1;
    for (let step = 1; step <= spread; step++) {
      const tx = x + dir2 * step;
      if (tx <= 0 || tx >= W - 1) break;
      const ti = i + dir2 * step;
      const mt = G.mat[ti];
      if (mt === MAT.EMPTY || G.isGas(mt) || (G.isLiquid(mt) && G.density[mt] < selfD)) {
        G.swapCells(i, ti);
        return;
      }
      if (G.isSolid(mt) || G.isPowder(mt)) break;
    }
    for (let step = 1; step <= spread; step++) {
      const tx = x - dir2 * step;
      if (tx <= 0 || tx >= W - 1) break;
      const ti = i - dir2 * step;
      const mt = G.mat[ti];
      if (mt === MAT.EMPTY || G.isGas(mt) || (G.isLiquid(mt) && G.density[mt] < selfD)) {
        G.swapCells(i, ti);
        return;
      }
      if (G.isSolid(mt) || G.isPowder(mt)) break;
    }
  }

  function tryMoveGasUp(x, y, i) {
    if (y <= 1) return;
    const up = i - W;
    if (G.mat[up] === MAT.EMPTY) {
      G.swapCells(i, up);
      return;
    }
    const dir = (G.rand01() < 0.5) ? -1 : 1;
    const nx = x + dir;
    if (nx > 0 && nx < W - 1) {
      const ui = up + dir;
      if (G.mat[ui] === MAT.EMPTY) {
        G.swapCells(i, ui);
        return;
      }
    }
  }

  // Export movement primitives for player/spells if needed
  G.sim = G.sim || {};
  G.sim.tryMovePowder = tryMovePowder;
  G.sim.tryMoveLiquid = tryMoveLiquid;
  G.sim.tryMoveGasUp = tryMoveGasUp;

  // ------------------------------
  // Data-driven reactions
  // ------------------------------
  function tryReact(i, j) {
    const a = G.mat[i];
    const b = G.mat[j];
    if (a === MAT.EMPTY || b === MAT.EMPTY) return;

    const rid = G.reactionMap ? G.reactionMap[(a << 8) | b] : 0;
    if (!rid) return;
    const rule = G.reactionRules[rid - 1];
    if (!rule) return;
    if (G.rand01() > rule.prob) return;

    // Convert A
    if (rule.aTo !== 255) {
      const newA = rule.aTo;
      const lifeA = (rule.aLife >= 0) ? rule.aLife : 0;
      G.setIndex(i, newA, lifeA, 0);
      if (G.hasTempTarget[newA]) G.temp[i] = G.tempTarget[newA];
    }

    // Convert B
    if (rule.bTo !== 255) {
      const newB = rule.bTo;
      const lifeB = (rule.bLife >= 0) ? rule.bLife : 0;
      G.setIndex(j, newB, lifeB, 0);
      if (G.hasTempTarget[newB]) G.temp[j] = G.tempTarget[newB];
    }

    // Heat deltas (small, stable)
    if (rule.heatA) G.temp[i] = (G.temp[i] + rule.heatA) | 0;
    if (rule.heatB) G.temp[j] = (G.temp[j] + rule.heatB) | 0;
  }

  function reactAround(x, y, i) {
    // 4-neighborhood is enough (cheap + readable)
    if (x > 1) tryReact(i, i - 1);
    if (x < W - 2) tryReact(i, i + 1);
    if (y > 1) tryReact(i, i - W);
    if (y < H - 2) tryReact(i, i + W);
  }

  // ------------------------------
  // Local interactions (fire/freeze)
  // ------------------------------
  function igniteCircle(cx, cy, r) {
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
        const m = G.mat[i];

        // air sparks
        if (m === MAT.EMPTY && G.rand01() < 0.16) {
          G.setIndex(i, MAT.FIRE, 18 + G.randi(35), 0);
          continue;
        }

        // ignite flammables
        if ((m === MAT.OIL || m === MAT.WOOD || m === MAT.LEAVES) && G.rand01() < 0.33) {
          G.setIndex(i, MAT.FIRE, 22 + G.randi(55), 0);
          continue;
        }

        // melt snow/ice
        if (m === MAT.SNOW && G.rand01() < 0.10) {
          G.setIndex(i, MAT.WATER, 0, G.SET_KEEP_TEMP);
        }
        if (m === MAT.ICE && G.rand01() < 0.08) {
          G.setIndex(i, MAT.WATER, 0, G.SET_KEEP_TEMP);
        }
      }
    }

    // Add a bit of heat in the area (helps temperature-driven phase changes feel real)
    if (G.addTempCircle) G.addTempCircle(cx, cy, r, 40);
  }
  G.igniteCircle = igniteCircle;

  function freezeCircle(cx, cy, r) {
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
        const m = G.mat[i];

        if (m === MAT.WATER) {
          G.setIndex(i, MAT.ICE, 0, G.SET_KEEP_TEMP);
        } else if (m === MAT.STEAM) {
          G.setIndex(i, MAT.SNOW, 0, G.SET_KEEP_TEMP);
        } else if (m === MAT.FIRE) {
          G.setIndex(i, MAT.EMPTY, 0, G.SET_KEEP_TEMP);
        } else if (m === MAT.EMPTY && G.rand01() < 0.35) {
          G.setIndex(i, MAT.SNOW, 0, G.SET_AMBIENT);
        }
      }
    }

    if (G.addTempCircle) G.addTempCircle(cx, cy, r, -70);
  }
  G.freezeCircle = freezeCircle;

  // ------------------------------
  // Material updates
  // ------------------------------
  function updateFire(x, y, i) {
    // Life-driven decay
    if (G.life[i] === 0) {
      const min = G.lifeMin[MAT.FIRE] | 0;
      const max = G.lifeMax[MAT.FIRE] | 0;
      G.life[i] = min + G.randi(Math.max(1, (max - min + 1)));
    }
    if (G.life[i] > 0) G.life[i]--;
    if (G.life[i] === 0) {
      // Keep heat in the air pocket for a moment
      G.setIndex(i, MAT.EMPTY, 0, G.SET_KEEP_TEMP);
      return;
    }

    // Data-driven reactions handle ignition/extinguish.
    reactAround(x, y, i);

    // Small random sparks help the fire look alive.
    if (G.rand01() < 0.08) {
      const dir = (G.rand01() < 0.5) ? -1 : 1;
      const j = i + dir;
      if (G.mat[j] === MAT.EMPTY) G.setIndex(j, MAT.FIRE, 10 + G.randi(20), 0);
    }

    tryMoveGasUp(x, y, i);
  }

  function updateSteam(x, y, i) {
    // Life-driven decay
    if (G.life[i] === 0) {
      const min = G.lifeMin[MAT.STEAM] | 0;
      const max = G.lifeMax[MAT.STEAM] | 0;
      G.life[i] = min + G.randi(Math.max(1, (max - min + 1)));
    }
    if (G.life[i] > 0) G.life[i]--;
    if (G.life[i] === 0) {
      const altProb = G.lifeDecayAltProb[MAT.STEAM] || 0;
      const out = (G.rand01() < altProb) ? (G.lifeDecayAltTo[MAT.STEAM] | 0) : (G.lifeDecayTo[MAT.STEAM] | 0);
      G.setIndex(i, out, 0, G.SET_KEEP_TEMP);
      return;
    }

    // A tiny bit of random dissipation makes steam look less "gridy"
    if (G.rand01() < 0.006) {
      G.setIndex(i, MAT.EMPTY, 0, G.SET_KEEP_TEMP);
      return;
    }

    tryMoveGasUp(x, y, i);
  }

  function updateAcid(x, y, i) {
    tryMoveLiquid(x, y, i, MAT.ACID, 5);

    // Data-driven corrosion / neutralisation
    reactAround(x, y, i);

    // slowly disappears
    if (G.rand01() < 0.002) {
      G.setIndex(i, MAT.EMPTY, 0, G.SET_KEEP_TEMP);
    }
  }

  function updateLava(x, y, i) {
    if (G.life[i] === 0) {
      const min = G.lifeMin[MAT.LAVA] | 0;
      const max = G.lifeMax[MAT.LAVA] | 0;
      G.life[i] = min + G.randi(Math.max(1, (max - min + 1)));
    }
    if (G.life[i] > 0) G.life[i]--;
    if (G.life[i] === 0) {
      G.setIndex(i, MAT.ROCK, 0, G.SET_KEEP_TEMP);
      return;
    }

    tryMoveLiquid(x, y, i, MAT.LAVA, 2);

    // Data-driven reactions (water contact, etc.)
    reactAround(x, y, i);

    // Visual embers / glow
    if (G.spawnParticle && (G.frameId + i) % 6 === 0) {
      const jx = (G.rand01() - 0.5) * 2.0;
      const jy = (G.rand01() - 0.5) * 2.0;
      const vx = (G.rand01() - 0.5) * 20;
      const vy = -40 - G.rand01() * 40;
      const life = 0.08 + G.rand01() * 0.10;
      const col = (G.rand01() < 0.5) ? 0xffffb13b : 0xffff7a2b;
      G.spawnParticle(x + 0.5 + jx, y + 0.5 + jy, vx, vy, life, col, 1);
    }
  }

  // Ice is handled by temperature-driven phase changes.
  function updateIce(_x, _y, _i) {}

  // ------------------------------
  // Step
  // ------------------------------
  function updateCell(x, y) {
    const i = G.idx(x, y);
    if (G.stamp[i] === G.frameId) return;

    const m = G.mat[i];
    if (m === MAT.EMPTY) return;

    if (m === MAT.SAND) tryMovePowder(x, y, i, MAT.SAND);
    else if (m === MAT.DIRT) tryMovePowder(x, y, i, MAT.DIRT);
    else if (m === MAT.SNOW) tryMovePowder(x, y, i, MAT.SNOW);
    else if (m === MAT.LEAVES) updateLeaves(x, y, i);

    else if (m === MAT.WATER) tryMoveLiquid(x, y, i, MAT.WATER, 5);
    else if (m === MAT.OIL) tryMoveLiquid(x, y, i, MAT.OIL, 6);
    else if (m === MAT.ACID) updateAcid(x, y, i);
    else if (m === MAT.LAVA) updateLava(x, y, i);

    else if (m === MAT.FIRE) updateFire(x, y, i);
    else if (m === MAT.STEAM) updateSteam(x, y, i);

    else if (m === MAT.ICE) updateIce(x, y, i);

    G.stamp[i] = G.frameId;
  }

  // Leaves: anchored to nearby wood, fall when detached.
  const LEAF_ANCHOR = 6;
  function updateLeaves(x, y, i) {
    const mat = G.mat;
    const life = G.life;

    // Check for nearby wood within radius 2
    let woodNear = false;
    for (let oy = -2; oy <= 2 && !woodNear; oy++) {
      const yy = y + oy;
      if (yy <= 1 || yy >= H - 1) continue;
      let ii = G.idx(x - 2, yy);
      for (let ox = -2; ox <= 2; ox++, ii++) {
        const xx = x + ox;
        if (xx <= 1 || xx >= W - 1) continue;
        if (mat[ii] === MAT.WOOD) { woodNear = true; break; }
      }
    }

    // Propagate support through neighboring leaves
    let support = 0;
    if (woodNear) support = LEAF_ANCHOR;
    else {
      const n1 = i - W, n2 = i + W, n3 = i - 1, n4 = i + 1;
      const n5 = i - W - 1, n6 = i - W + 1, n7 = i + W - 1, n8 = i + W + 1;
      const nei = [n1, n2, n3, n4, n5, n6, n7, n8];
      for (let k = 0; k < nei.length; k++) {
        const j = nei[k];
        if (mat[j] === MAT.LEAVES) {
          const v = (life[j] | 0) - 1;
          if (v > support) support = v;
        }
      }
    }

    if (support > 0) {
      if ((life[i] | 0) < support) life[i] = support;
      return;
    }

    if ((life[i] | 0) > 0) {
      life[i] = (life[i] - 1) | 0;
      return;
    }

    tryMovePowder(x, y, i, MAT.LEAVES);
  }

  function stepRegionNoFrame(x0, y0, x1, y1) {
    const r = clampRegion(x0, y0, x1, y1);
    x0 = r.x0; y0 = r.y0; x1 = r.x1; y1 = r.y1;

    for (let y = y1; y >= y0; y--) {
      const ltr = (G.rand01() < 0.5);
      if (ltr) {
        for (let x = x0; x <= x1; x++) updateCell(x, y);
      } else {
        for (let x = x1; x >= x0; x--) updateCell(x, y);
      }
    }
  }

  function stepRegion(x0, y0, x1, y1) {
    G.frameId++;
    stepRegionNoFrame(x0, y0, x1, y1);
  }

  // ------------------------------
  // Temperature diffusion + phase changes (region-limited)
  // ------------------------------
  const PHASE_NONE = 32767;

  function randomLifeFor(matId) {
    if (!G.hasLife[matId]) return 0;
    const min = G.lifeMin[matId] | 0;
    const max = G.lifeMax[matId] | 0;
    return (min + G.randi(Math.max(1, (max - min + 1)))) | 0;
  }

  function stepTemperatureRegion(x0, y0, x1, y1) {
    const r = clampRegion(x0, y0, x1, y1);
    x0 = r.x0; y0 = r.y0; x1 = r.x1; y1 = r.y1;

    const temp = G.temp;
    const out = G.temp2;
    const mat = G.mat;

    const diffScale = +((C.TEMP_DIFFUSION_SCALE ?? 1.0) || 1.0);
    const phaseScale = +((C.TEMP_PHASE_PROB ?? 0.10) || 0.10);

    // 1) diffusion into temp2
    for (let y = y0; y <= y1; y++) {
      let i = G.idx(x0, y);
      for (let x = x0; x <= x1; x++, i++) {
        const m = mat[i];
        let t = temp[i];

        // Heat sources drift back toward their target
        if (G.hasTempTarget[m]) {
          const target = G.tempTarget[m];
          t = (t + ((target - t) * 0.25)) | 0;
        }

        // 4-neighbor average (stable, cheap)
        const avg = (temp[i - 1] + temp[i + 1] + temp[i - W] + temp[i + W]) * 0.25;
        const k = (G.tCond[m] || 0.08) * diffScale;
        out[i] = (t + (avg - t) * k) | 0;
      }
    }

    // 2) commit + phase transitions (probabilistic)
    for (let y = y0; y <= y1; y++) {
      let i = G.idx(x0, y);
      for (let x = x0; x <= x1; x++, i++) {
        const t = out[i] | 0;
        temp[i] = t;

        const m = mat[i];
        if (m === MAT.EMPTY) continue;

        const prob = (G.phaseProb[m] || 0) * phaseScale;
        if (prob <= 0) continue;
        if (G.rand01() > prob) continue;

        // Priority: ignite > boil > melt > freeze
        const igAt = G.igniteAt[m];
        if (igAt !== PHASE_NONE && t >= igAt) {
          const nm = G.igniteTo[m];
          const life = randomLifeFor(nm);
          G.setIndex(i, nm, life, 0); // fire/lava get tempTarget via setIndex
          continue;
        }

        const boilAt = G.boilAt[m];
        if (boilAt !== PHASE_NONE && t >= boilAt) {
          const nm = G.boilTo[m];
          const life = randomLifeFor(nm);
          G.setIndex(i, nm, life, G.SET_KEEP_TEMP);
          continue;
        }

        const meltAt = G.meltAt[m];
        if (meltAt !== PHASE_NONE && t >= meltAt) {
          const nm = G.meltTo[m];
          const life = randomLifeFor(nm);
          const flags = G.hasTempTarget[nm] ? 0 : G.SET_KEEP_TEMP;
          G.setIndex(i, nm, life, flags);
          continue;
        }

        const frAt = G.freezeAt[m];
        if (frAt !== PHASE_NONE && t <= frAt) {
          const nm = G.freezeTo[m];
          const life = randomLifeFor(nm);
          G.setIndex(i, nm, life, G.SET_KEEP_TEMP);
        }
      }
    }
  }

  G.stepTemperatureRegion = stepTemperatureRegion;

  // The main sim step used by the game loop.
  // - Updates only chunks around camera/player.
  // - Skips chunks that have been stable for a while.
  let regionTick = 1;
  function stepSimulationActive() {
    const margin = C.SIM_MARGIN | 0;
    const cam = G.camera;
    const p = G.player;

    // camera box
    let x0 = (cam.x | 0) - margin;
    let y0 = (cam.y | 0) - margin;
    let x1 = (cam.x | 0) + C.VIEW_W + margin;
    let y1 = (cam.y | 0) + C.VIEW_H + margin;

    // union with player-centered box (prevents camera-lag bugs)
    x0 = Math.min(x0, (p.x | 0) - margin);
    y0 = Math.min(y0, (p.y | 0) - margin);
    x1 = Math.max(x1, (p.x | 0) + margin);
    y1 = Math.max(y1, (p.y | 0) + margin);

    // Clamp region
    const rr = clampRegion(x0, y0, x1, y1);
    x0 = rr.x0; y0 = rr.y0; x1 = rr.x1; y1 = rr.y1;

    // Determine chunk range
    const cx0 = G.clamp(x0 >> CSHIFT, 0, CHW - 1);
    const cy0 = G.clamp(y0 >> CSHIFT, 0, CHH - 1);
    const cx1 = G.clamp(x1 >> CSHIFT, 0, CHW - 1);
    const cy1 = G.clamp(y1 >> CSHIFT, 0, CHH - 1);

    // One stamp per simulation tick (not per chunk)
    G.frameId++;
    regionTick = (regionTick + 1) >>> 0;
    const prevTick = (regionTick - 1) >>> 0;

    const CS = CHUNK?.SIZE ?? 32;

    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const ci = (cx + cy * CHW) | 0;

        // New chunk entering the region: bootstrap it for a couple frames
        if (G.chunkLastInRegion[ci] !== prevTick) {
          G.markChunkActive(ci, 2);
        }
        G.chunkLastInRegion[ci] = regionTick;

        const ttl = G.chunkTTL[ci] | 0;
        const always = G.chunkAlways[ci] | 0;
        if (ttl <= 0 && always <= 0) continue;

        // Chunk bounds, clipped to region
        const xA = Math.max(x0, cx * CS);
        const xB = Math.min(x1, (cx + 1) * CS - 1);
        const yA = Math.max(y0, cy * CS);
        const yB = Math.min(y1, (cy + 1) * CS - 1);

        stepRegionNoFrame(xA, yA, xB, yB);

        // Decay TTL (alwaysUpdate chunks can stay awake due to chunkAlways)
        if (G.chunkTTL[ci] > 0) G.chunkTTL[ci]--;
      }
    }

    // Temperature and phase changes are also region-limited.
    // This makes temperature "real" near the player without simulating the whole world.
    stepTemperatureRegion(x0, y0, x1, y1);
  }

  G.stepSimulationActive = stepSimulationActive;
  G.stepSimulationRegion = stepRegion;
})();
