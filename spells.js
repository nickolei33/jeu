'use strict';
(() => {
  const G = (window.G = window.G || {});
  const C = G.CONF;
  const { WORLD_W: W, WORLD_H: H } = C;
  const { MAT } = G;

  // ------------------------------
  // Wands / spells
  // ------------------------------
  G.WANDS = [
    { name: 'Dig', cooldown: 0.10, cost: 4 },
    { name: 'Fire', cooldown: 0.14, cost: 7 },
    { name: 'Water', cooldown: 0.10, cost: 5 },
    { name: 'Oil', cooldown: 0.10, cost: 5 },
    { name: 'Bomb', cooldown: 0.35, cost: 12 },
    { name: 'Mega Bomb', cooldown: 0.70, cost: 18 },
    { name: 'Acid', cooldown: 0.18, cost: 8 },
  ];

  G.currentWand = 0;
  G.castTimer = 0;
  G.projectiles = [];

  // Projectile trail colors (packed RGBA)
  const TRAIL_COL = [
    G.packRGBA(190, 180, 170, 255), // 0: Dig (dust)
    G.packRGBA(255, 140, 60, 255),  // 1: Fire
    G.packRGBA(120, 190, 255, 255), // 2: Water
    G.packRGBA(190, 160, 90, 255),  // 3: Oil
    G.packRGBA(255, 230, 190, 255), // 4: Bomb (sparks)
    G.packRGBA(255, 230, 120, 255), // 5: Mega Bomb
    G.packRGBA(90, 255, 120, 255),  // 6: Acid
    G.packRGBA(255, 200, 90, 255),  // 7: Mini Bomb
  ];

  const MINI_BOMB_KIND = 7;

  G.clearProjectiles = () => {
    G.projectiles.length = 0;
  };

  function castSpellAt(tx, ty) {
    const wand = G.currentWand | 0;
    const spec = G.WANDS[wand];
    const pl = G.player;

    if (!spec) return false;
    if (pl.mana < spec.cost) return false;

    pl.mana -= spec.cost;

    const ox = pl.x;
    const oy = pl.y - pl.h * 0.62;

    let dx = tx - ox;
    let dy = ty - oy;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;

    let speed = 150;
    let ttl = 1.25;

    if (wand === 3) { speed = 118; ttl = 1.7; }
    if (wand === 4) { speed = 160; ttl = 1.8; }
    if (wand === 5) { speed = 170; ttl = 2.2; }
    if (wand === 6) { speed = 132; ttl = 1.4; }

    G.projectiles.push({ x: ox, y: oy, vx: dx * speed, vy: dy * speed, ttl, kind: wand });

    // cast sparkle
    if (G.burst) G.burst(ox, oy, 8, 0xffffffff, 0xffb8ffcb, 55);

    return true;
  }
  G.castSpellAt = castSpellAt;

  // ------------------------------
  // Spell effects
  // ------------------------------
  function depositLiquid(cx, cy, r, mat) {
    // ------------------------------------------------------
    // Noita-ish liquid deposition
    //
    // Old behavior: instantly fill a big circle.
    // New behavior:
    //  1) Place a small "seed puddle" so the liquid always exists
    //  2) Spray additional mass as ballistic material particles
    //     (these will reinsert into the grid on impact)
    //
    // This avoids the "teleport liquid" look and adds inertia.
    // ------------------------------------------------------

    // Create a tiny cavity so the spell always has somewhere to exist.
    G.carveCircle(cx, cy, 1);

    // Small seed puddle (keeps it responsive and deterministic)
    const seedR = Math.max(2, (r * 0.45) | 0);
    G.fillCircle(cx, cy, seedR, mat, 0, (cur) => (cur === MAT.EMPTY || G.isGas(cur)));

    // Ballistic spray (material leaves the grid temporarily and then comes back)
    if (G.burstMat) {
      const n = 14 + (r * 3) | 0;
      const sp = 80 + r * 6;
      G.burstMat(mat, cx + 0.5, cy + 0.5, n, sp, 0.55, 0.65);
    } else {
      // Fallback: fill the full radius if the material-particle system isn't present.
      G.fillCircle(cx, cy, r, mat, 0, (cur) => (cur === MAT.EMPTY || G.isGas(cur)));
    }
  }

  function applyImpact(kind, x, y) {
    const cx = G.clamp(x | 0, 1, W - 2);
    const cy = G.clamp(y | 0, 1, H - 2);

    if (kind === 0) {
      G.carveCircle(cx, cy, 3);
      if (G.burst) G.burst(cx, cy, 10, 0xffc2ac5c, 0xff2b2b31, 50);
    } else if (kind === 1) {
      G.carveCircle(cx, cy, 2);
      G.igniteCircle(cx, cy, 7);
      if (G.burst) G.burst(cx, cy, 18, 0xffffb13b, 0xffd94a2a, 85);
    } else if (kind === 2) {
      depositLiquid(cx, cy, 7, MAT.WATER);
      if (G.burst) G.burst(cx, cy, 14, 0xffbcd2ff, 0xff3d6fe0, 55);
    } else if (kind === 3) {
      depositLiquid(cx, cy, 7, MAT.OIL);
      if (G.burst) G.burst(cx, cy, 12, 0xffb57b3e, 0xff7a4e23, 55);
    } else if (kind === 4) {
      // High-power bomb
      G.carveCircle(cx, cy, 22);
      G.igniteCircle(cx, cy, 20);
      if (G.addTempCircle) G.addTempCircle(cx, cy, 26, 180);

      // Core flash + sparks
      if (G.burst) {
        G.burst(cx, cy, 90, 0xffffffff, 0xffffe08a, 220);
        G.burst(cx, cy, 70, 0xffffb13b, 0xffff7a2b, 180);
      }

      // Debris spray (material particles)
      if (G.burstMat) {
        G.burstMat(MAT.DIRT, cx + 0.5, cy + 0.5, 120, 160, 0.35, 0.75);
        G.burstMat(MAT.SAND, cx + 0.5, cy + 0.5, 80, 150, 0.30, 0.70);
      }
    } else if (kind === 5) {
      // Mega Bomb (10x+ power + cluster)
      G.carveCircle(cx, cy, 48);
      G.igniteCircle(cx, cy, 42);
      if (G.addTempCircle) G.addTempCircle(cx, cy, 78, 1200);

      // Lava core + molten ring (slightly reduced)
      G.fillCircle(cx, cy, 20, MAT.LAVA, 250, (cur) => (cur === MAT.EMPTY || G.isGas(cur)));
      const meltR = 40;
      const meltR2 = meltR * meltR;
      const x0 = Math.max(2, cx - meltR);
      const x1 = Math.min(W - 3, cx + meltR);
      const y0 = Math.max(2, cy - meltR);
      const y1 = Math.min(H - 3, cy + meltR);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy > meltR2) continue;
          const i = G.idx(x, y);
          const m = G.mat[i] | 0;
          if (m === MAT.ROCK || m === MAT.DARK_ROCK || m === MAT.SANDSTONE) {
            if (G.rand01() < 0.55) G.setIndex(i, MAT.LAVA, 240);
          } else if (m === MAT.DIRT || m === MAT.SAND) {
            if (G.rand01() < 0.30) G.setIndex(i, MAT.LAVA, 210);
          }
        }
      }

      // Lava splash
      if (G.burstMat) {
        G.burstMat(MAT.LAVA, cx + 0.5, cy + 0.5, 60, 180, 0.18, 0.9);
      }

      if (G.burst) {
        G.burst(cx, cy, 180, 0xffffffff, 0xffffe7b0, 280);
        G.burst(cx, cy, 140, 0xffffb13b, 0xffff7a2b, 230);
        G.burst(cx, cy, 90, 0xfff6faff, 0xff8fd6ff, 190);
      }

      if (G.burstMat) {
        G.burstMat(MAT.DIRT, cx + 0.5, cy + 0.5, 220, 200, 0.30, 0.9);
        G.burstMat(MAT.SAND, cx + 0.5, cy + 0.5, 160, 190, 0.25, 0.85);
        G.burstMat(MAT.ROCK, cx + 0.5, cy + 0.5, 80, 160, 0.20, 0.75);
      }

      // Cluster mini bombs
      const count = 8 + G.randi(5);
      for (let i = 0; i < count; i++) {
        const a = G.rand01() * Math.PI * 2;
        const v = 110 + G.rand01() * 80;
        const vx = Math.cos(a) * v;
        const vy = Math.sin(a) * v - 60;
        G.projectiles.push({ x: cx + 0.5, y: cy + 0.5, vx, vy, ttl: 0.8 + G.rand01() * 0.4, kind: MINI_BOMB_KIND });
      }
    } else if (kind === MINI_BOMB_KIND) {
      // Mini bomb impact
      G.carveCircle(cx, cy, 10);
      G.igniteCircle(cx, cy, 10);
      if (G.addTempCircle) G.addTempCircle(cx, cy, 14, 120);
      if (G.burst) G.burst(cx, cy, 40, 0xffffd78a, 0xffff7a2b, 160);
    } else if (kind === 6) {
      depositLiquid(cx, cy, 7, MAT.ACID);
      if (G.burst) G.burst(cx, cy, 16, 0xffb8ffcb, 0xff4cff6a, 75);
    }
  }
  G.applyImpact = applyImpact;

  function updateProjectiles(dt) {
    for (let i = G.projectiles.length - 1; i >= 0; i--) {
      const p = G.projectiles[i];
      p.ttl -= dt;
      if (p.ttl <= 0) {
        G.projectiles.splice(i, 1);
        continue;
      }

      // gravity (bomb heavier)
      p.vy += (p.kind === 4 || p.kind === 5 || p.kind === MINI_BOMB_KIND ? 180 : 48) * dt;

      const dx = p.vx * dt;
      const dy = p.vy * dt;

      // Sub-stepping avoids tunneling.
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2));

      let hit = false;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const sx = p.x + dx * t;
        const sy = p.y + dy * t;

        if (sx < 1 || sx >= W - 1 || sy < 1 || sy >= H - 1) {
          applyImpact(p.kind, sx, sy);
          hit = true;
          break;
        }

        const m = G.mat[G.idx(sx | 0, sy | 0)];
        if (G.blocksProjectile(m)) {
          applyImpact(p.kind, sx, sy);
          hit = true;
          break;
        }

        // Fire bolt can ignite flammables mid-flight
        if (p.kind === 1 && (m === MAT.OIL || m === MAT.WOOD || m === MAT.LEAVES)) {
          if (G.rand01() < 0.22) {
            const j = G.idx(sx | 0, sy | 0);
            G.setIndex(j, MAT.FIRE, 22 + G.randi(45), 0);
          }
        }
      }

      if (hit) {
        G.projectiles.splice(i, 1);
        continue;
      }

      p.x += dx;
      p.y += dy;

      // Projectile trail particles (lightweight, pixel-art friendly)
      if (G.spawnParticle) {
        const col = TRAIL_COL[p.kind | 0] || 0xffffffff;
        const sp = Math.hypot(p.vx, p.vy);
        const n = (p.kind === 4) ? 5 : (sp > 230 ? 2 : 1);
        for (let k = 0; k < n; k++) {
          const jx = (Math.random() - 0.5) * 1.6;
          const jy = (Math.random() - 0.5) * 1.6;
          // Oppose the projectile velocity so the trail lingers a bit.
          const tvx = -p.vx * 0.10 + (Math.random() - 0.5) * (p.kind === 4 ? 60 : 26);
          const tvy = -p.vy * 0.10 + (Math.random() - 0.5) * (p.kind === 4 ? 60 : 26);
          const life = (p.kind === 4 ? 0.18 : 0.06) + Math.random() * (p.kind === 4 ? 0.18 : 0.10);
          const size = (p.kind === 4) ? 2 : 1;
          G.spawnParticle(p.x + jx, p.y + jy, tvx, tvy, life, col, size);
        }
      }
    }
  }

  G.updateProjectiles = updateProjectiles;
})();
