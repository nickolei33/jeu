'use strict';
(() => {
  const G = (window.G = window.G || {});
  const { MAT } = G;

  // =========================================================
  // Data-driven reactions (Noita-ish adjacency rules)
  //
  // Each rule describes what happens when two neighboring cells touch.
  // The engine compiles this into a fast 256x256 lookup.
  //
  // Fields:
  // - a, b: material IDs
  // - prob: probability (0..1) per check
  // - aTo / bTo: resulting materials (optional)
  // - aLife / bLife: override life (optional)
  // - heatA / heatB: temperature delta to apply (optional)
  // - keepTempA/B: preserve temperature during conversion (default true)
  // =========================================================

  const R = [
    // Water + lava => steam + rock (violent)
    { a: MAT.WATER, b: MAT.LAVA, prob: 0.55, aTo: MAT.STEAM, aLife: 60, bTo: MAT.ROCK, heatA: +40 },

    // Water + fire => steam (extinguish)
    { a: MAT.WATER, b: MAT.FIRE, prob: 0.35, aTo: MAT.STEAM, aLife: 50, bTo: MAT.EMPTY, heatA: +25 },

    // Oil/wood + fire => more fire
    { a: MAT.OIL, b: MAT.FIRE, prob: 0.18, aTo: MAT.FIRE, aLife: 30 },
    { a: MAT.WOOD, b: MAT.FIRE, prob: 0.12, aTo: MAT.FIRE, aLife: 35 },

    // Ice/snow + fire/lava => water
    { a: MAT.ICE, b: MAT.FIRE, prob: 0.22, aTo: MAT.WATER },
    { a: MAT.SNOW, b: MAT.FIRE, prob: 0.18, aTo: MAT.WATER },
    { a: MAT.ICE, b: MAT.LAVA, prob: 0.35, aTo: MAT.WATER, heatA: +35 },
    { a: MAT.SNOW, b: MAT.LAVA, prob: 0.30, aTo: MAT.WATER, heatA: +25 },

    // Acid corrodes soft materials
    { a: MAT.ACID, b: MAT.WOOD, prob: 0.14, bTo: MAT.EMPTY, heatA: +8 },
    { a: MAT.ACID, b: MAT.DIRT, prob: 0.11, bTo: MAT.EMPTY, heatA: +5 },
    { a: MAT.ACID, b: MAT.SAND, prob: 0.10, bTo: MAT.EMPTY, heatA: +5 },
    { a: MAT.ACID, b: MAT.SNOW, prob: 0.12, bTo: MAT.EMPTY, heatA: +4 },

    // Acid + water => (soft) neutralisation
    { a: MAT.ACID, b: MAT.WATER, prob: 0.06, aTo: MAT.WATER },
  ];

  // Export source list (editable)
  G.REACTIONS = R;

  // Compile to lookup table.
  // reactionMap[a*256 + b] = index+1 (0 means none)
  const reactionMap = new Uint16Array(256 * 256);
  const rules = [];

  function addRule(a, b, rule) {
    const idx = rules.push(rule) - 1;
    reactionMap[(a << 8) | b] = (idx + 1);
  }

  for (const r of R) {
    const rule = {
      prob: +r.prob,
      aTo: (typeof r.aTo === 'number') ? r.aTo : 255,
      bTo: (typeof r.bTo === 'number') ? r.bTo : 255,
      aLife: (typeof r.aLife === 'number') ? r.aLife : -1,
      bLife: (typeof r.bLife === 'number') ? r.bLife : -1,
      heatA: (typeof r.heatA === 'number') ? r.heatA : 0,
      heatB: (typeof r.heatB === 'number') ? r.heatB : 0,
    };

    // Directional entries: (a,b) and (b,a).
    // We apply the same transform but swapped for the reverse.
    addRule(r.a, r.b, { ...rule });
    addRule(r.b, r.a, {
      prob: rule.prob,
      aTo: rule.bTo,
      bTo: rule.aTo,
      aLife: rule.bLife,
      bLife: rule.aLife,
      heatA: rule.heatB,
      heatB: rule.heatA,
    });
  }

  G.reactionMap = reactionMap;
  G.reactionRules = rules;
})();
