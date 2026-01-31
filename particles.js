'use strict';
(() => {
  const G = (window.G = window.G || {});

  // ------------------------------
  // Particles (visual-only, capped for stability)
  // ------------------------------
  const MAX = 1800;
  G.particles = [];

  G.clearParticles = () => {
    G.particles.length = 0;
  };

  G.spawnParticle = (x, y, vx, vy, ttl, col, size = 1) => {
    if (G.particles.length >= MAX) return;
    G.particles.push({ x, y, vx, vy, ttl, col: col >>> 0, size });
  };

  G.burst = (x, y, n, colA, colB, sp = 65) => {
    for (let i = 0; i < n; i++) {
      const a = G.rand01() * Math.PI * 2;
      const r = 0.25 + G.rand01() * 0.75;
      const v = sp * r;
      const col = (G.rand01() < 0.5) ? colA : colB;
      G.spawnParticle(x, y, Math.cos(a) * v, Math.sin(a) * v, 0.20 + G.rand01() * 0.35, col);
    }
  };

  G.updateParticles = (dt) => {
    for (let i = G.particles.length - 1; i >= 0; i--) {
      const p = G.particles[i];
      p.ttl -= dt;
      if (p.ttl <= 0) {
        G.particles.splice(i, 1);
        continue;
      }
      p.vy += 120 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= (1 - 3.0 * dt);
      p.vy *= (1 - 2.0 * dt);
    }
  };
})();
