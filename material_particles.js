'use strict';
(() => {
  const G = (window.G = window.G || {});
  const { MAT } = G;

  // =========================================================
  // Material Particles (Noita-style bridge)
  //
  // Purpose
  // - Give liquids/powders believable inertia without rewriting the whole
  //   cellular automaton.
  // - Allow effects like splashes, sprays, dust puffs to be *real material*
  //   temporarily leaving the grid and re-inserting on impact.
  //
  // This is intentionally single-threaded and conservative for stability.
  // =========================================================

  const CONF = (G.CONF && G.CONF.MAT_PARTICLES) || {};
  const MAX = CONF.MAX || 1400;
  const SUBSTEPS = CONF.SUBSTEPS || 2;

  // A lightweight pool. Each entry:
  // { x,y, px,py, vx,vy, mat, ttl, col }
  G.matParticles = [];

  // Colors for airborne material (packed RGBA)
  const COL = {
    [MAT.SAND]: G.packRGBA(214, 196, 122, 255),
    [MAT.DIRT]: G.packRGBA(150, 110, 70, 255),
    [MAT.SNOW]: G.packRGBA(235, 246, 255, 255),
    [MAT.ICE]: G.packRGBA(200, 228, 255, 255),
    [MAT.WATER]: G.packRGBA(120, 190, 255, 255),
    [MAT.OIL]: G.packRGBA(190, 160, 90, 255),
    [MAT.ACID]: G.packRGBA(90, 255, 120, 255),
    [MAT.LAVA]: G.packRGBA(255, 120, 60, 255),
    [MAT.ROCK]: G.packRGBA(110, 110, 120, 255),
    [MAT.DARK_ROCK]: G.packRGBA(70, 70, 80, 255),
    [MAT.SANDSTONE]: G.packRGBA(200, 178, 110, 255),
    [MAT.WOOD]: G.packRGBA(180, 130, 70, 255),
  };

  // Which materials are allowed to be ejected from the grid as particles.
  // Keep this conservative to avoid tearing holes in terrain.
  function canEject(mat) {
    return (
      mat === MAT.SAND ||
      mat === MAT.DIRT ||
      mat === MAT.SNOW ||
      mat === MAT.WATER ||
      mat === MAT.OIL ||
      mat === MAT.ACID
    );
  }

  // Particle physics parameters per category.
  function matParams(mat) {
    // Default: dust-like
    let g = 360;
    let drag = 3.5;
    let bounce = 0.10;

    if (mat === MAT.WATER) { g = 300; drag = 2.4; bounce = 0.05; }
    else if (mat === MAT.OIL) { g = 280; drag = 2.0; bounce = 0.06; }
    else if (mat === MAT.ACID) { g = 305; drag = 2.1; bounce = 0.05; }
    else if (mat === MAT.SNOW) { g = 220; drag = 4.2; bounce = 0.02; }
    else if (mat === MAT.SAND || mat === MAT.DIRT) { g = 420; drag = 2.8; bounce = 0.08; }
    else if (mat === MAT.LAVA) { g = 340; drag = 2.6; bounce = 0.04; }

    return { g, drag, bounce };
  }

  function tryDeposit(ix, iy, mat) {
    if (!G.inb(ix, iy)) return false;
    const i = G.idx(ix, iy);
    const cur = G.mat[i];
    if (cur === MAT.EMPTY || G.isGas(cur)) {
      // Deposit uses ambient temperature. Liquids will settle via cell sim.
      G.setIndex(i, mat, 0, G.SET_AMBIENT);
      return true;
    }
    return false;
  }

  // Spawn a free-flying material particle.
  G.spawnMatParticle = (mat, x, y, vx, vy, ttl = 0.65, opt = null) => {
    if (G.matParticles.length >= MAX) return;
    const col = (opt && opt.col != null) ? (opt.col >>> 0) : (COL[mat] || 0xffffffff);
    G.matParticles.push({
      x: +x,
      y: +y,
      vx: +vx,
      vy: +vy,
      mat: mat | 0,
      ttl: +ttl,
      col,
      // for cheap drag stability
      px: +x,
      py: +y,
    });
  };

  // Remove a cell from the world and turn it into a particle.
  // This is the key "bridge" move Noita describes.
  G.ejectCellAsParticle = (cx, cy, vx, vy, ttl = 0.55) => {
    const x = cx | 0;
    const y = cy | 0;
    if (!G.inb(x, y)) return false;
    const i = G.idx(x, y);
    const mat = G.mat[i] | 0;
    if (!canEject(mat)) return false;

    // Only eject if the cell is on/near the surface of a pile (avoid carving deep holes)
    const below = G.safeGet(x, y + 1, MAT.ROCK);
    const above = G.safeGet(x, y - 1, MAT.ROCK);
    if (above !== MAT.EMPTY && !G.isGas(above)) {
      // buried
      return false;
    }

    // Remove from grid
    G.setIndex(i, MAT.EMPTY, 0, G.SET_KEEP_TEMP);

    // Spawn particle at cell center
    G.spawnMatParticle(mat, x + 0.5, y + 0.5, vx, vy, ttl);
    return true;
  };

  G.burstMat = (mat, x, y, n, speed = 90, upBias = 0.45, ttl = 0.60) => {
    for (let k = 0; k < n; k++) {
      const a = (Math.random() * Math.PI * 2);
      const r = 0.25 + Math.random() * 0.75;
      const v = speed * r;
      let vx = Math.cos(a) * v;
      let vy = Math.sin(a) * v;
      // bias upward a bit
      vy -= Math.abs(v) * upBias;
      G.spawnMatParticle(mat, x, y, vx, vy, ttl * (0.7 + Math.random() * 0.6));
    }
  };

  // Update & reinsert into the world.
  G.updateMatParticles = (dt) => {
    if (!G.matParticles.length) return;

    // Substep for collision stability (cheap because N is small).
    const sub = Math.max(1, SUBSTEPS | 0);
    const h = dt / sub;

    for (let s = 0; s < sub; s++) {
      for (let idx = G.matParticles.length - 1; idx >= 0; idx--) {
        const p = G.matParticles[idx];
        p.ttl -= h;
        if (p.ttl <= 0) {
          G.matParticles.splice(idx, 1);
          continue;
        }

        const mp = matParams(p.mat);

        // Semi-implicit drag toward current velocity (stable)
        p.vy += mp.g * h;
        p.vx *= (1 - mp.drag * h);
        p.vy *= (1 - mp.drag * h);

        const nx = p.x + p.vx * h;
        const ny = p.y + p.vy * h;

        // bounds
        if (nx < 1 || nx >= (G.W - 1) || ny < 1 || ny >= (G.H - 1)) {
          G.matParticles.splice(idx, 1);
          continue;
        }

        const ix = nx | 0;
        const iy = ny | 0;
        const cur = G.mat[G.idx(ix, iy)] | 0;

        // If we are in empty/gas, just move.
        if (cur === MAT.EMPTY || G.isGas(cur)) {
          p.x = nx;
          p.y = ny;
          continue;
        }

        // We hit something (solid/liquid/powder). Try to deposit at previous or nearby.
        const pix = p.x | 0;
        const piy = p.y | 0;

        // Prefer depositing where we came from.
        if (tryDeposit(pix, piy, p.mat)) {
          // tiny VFX puff
          if (G.spawnParticle && Math.random() < 0.30) {
            G.spawnParticle(p.x, p.y, -p.vx * 0.15, -p.vy * 0.15, 0.06, p.col, 1);
          }
          G.matParticles.splice(idx, 1);
          continue;
        }

        // Try a couple of neighbors (helps with walls)
        const sx = Math.sign(p.vx) || 1;
        const sy = Math.sign(p.vy) || 1;
        const ok = (
          tryDeposit(pix - sx, piy, p.mat) ||
          tryDeposit(pix, piy - sy, p.mat) ||
          tryDeposit(pix - sx, piy - sy, p.mat)
        );
        if (ok) {
          G.matParticles.splice(idx, 1);
          continue;
        }

        // Otherwise bounce back (droplet ricochet) and shorten lifespan.
        p.vx = -p.vx * mp.bounce;
        p.vy = -p.vy * mp.bounce;
        p.x = p.x + p.vx * h;
        p.y = p.y + p.vy * h;
        p.ttl *= 0.75;
      }
    }
  };

  G.clearMatParticles = () => {
    G.matParticles.length = 0;
  };
})();
