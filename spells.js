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
    { name: 'Acid', cooldown: 0.18, cost: 8 },
    { name: 'Freeze', cooldown: 0.20, cost: 8 },
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
    G.packRGBA(90, 255, 120, 255),  // 5: Acid
    G.packRGBA(200, 235, 255, 255), // 6: Freeze
  ];

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
    if (wand === 4) { speed = 96; ttl = 2.0; }
    if (wand === 5) { speed = 132; ttl = 1.4; }
    if (wand === 6) { speed = 126; ttl = 1.4; }

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
      G.carveCircle(cx, cy, 12);
      G.igniteCircle(cx, cy, 13);
      if (G.burst) G.burst(cx, cy, 40, 0xffffb13b, 0xffff7a2b, 120);
    } else if (kind === 5) {
      depositLiquid(cx, cy, 7, MAT.ACID);
      if (G.burst) G.burst(cx, cy, 16, 0xffb8ffcb, 0xff4cff6a, 75);
    } else if (kind === 6) {
      G.freezeCircle(cx, cy, 8);
      if (G.burst) G.burst(cx, cy, 20, 0xffd7f0ff, 0xffbcd2ff, 85);
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
      p.vy += (p.kind === 4 ? 140 : 48) * dt;

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
        const n = (sp > 230) ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const jx = (Math.random() - 0.5) * 1.6;
          const jy = (Math.random() - 0.5) * 1.6;
          // Oppose the projectile velocity so the trail lingers a bit.
          const tvx = -p.vx * 0.12 + (Math.random() - 0.5) * 26;
          const tvy = -p.vy * 0.12 + (Math.random() - 0.5) * 26;
          const life = 0.06 + Math.random() * 0.10;
          G.spawnParticle(p.x + jx, p.y + jy, tvx, tvy, life, col, 1);
        }
      }
    }
  }

  G.updateProjectiles = updateProjectiles;
})();
