'use strict';
(() => {
  const G = (window.G = window.G || {});

  // =========================================================
  // Data-driven materials
  // - Keep integer IDs for speed and backwards compatibility
  // - Drive categories, thermal properties and reactions from tables
  // =========================================================

  // ------------------------------
  // Material IDs (stable)
  // ------------------------------
  G.MAT = {
    EMPTY: 0,
    ROCK: 1,
    SAND: 2,
    WATER: 3,
    OIL: 4,
    WOOD: 5,
    FIRE: 6,
    STEAM: 7,
    DIRT: 8,
    SNOW: 9,
    ICE: 10,
    ACID: 11,    LAVA: 12,
    PACKED_SNOW: 13,
    DARK_ROCK: 14,
    SANDSTONE: 15,
    LEAVES: 16,
  };
  const { MAT } = G;

  // ------------------------------
  // Categories
  // ------------------------------
  G.CAT = {
    EMPTY: 0,
    SOLID: 1,
    POWDER: 2,
    LIQUID: 3,
    GAS: 4,
  };
  const { CAT } = G;

  // ------------------------------
  // Definitions
  // tempTarget: a "source" temperature this cell will drift toward
  // tCond:     diffusion strength (rough conductivity/heat capacity blend)
  // phase:     temperature-driven transitions (probabilistic)
  // alwaysUpdate: forces chunk updates even if no movement happened
  // ------------------------------
  const DEF = [
    {
      id: MAT.EMPTY,
      name: 'EMPTY',
      cat: CAT.EMPTY,
      density: 0,
      tCond: 0.03,
    },
    {
      id: MAT.ROCK,
      name: 'ROCK',
      cat: CAT.SOLID,
      density: 250,
      tCond: 0.12,
      phase: {
        // optional (rare): at very high temp, become lava
        meltAt: 1250,
        meltTo: MAT.LAVA,
        prob: 0.006,
      },
    },
    { id: MAT.SAND, name: 'SAND', cat: CAT.POWDER, density: 120, tCond: 0.08 },
    {
      id: MAT.WATER,
      name: 'WATER',
      cat: CAT.LIQUID,
      density: 60,
      tCond: 0.22,
      phase: {
        freezeAt: -1,
        freezeTo: MAT.ICE,
        boilAt: 103,
        boilTo: MAT.STEAM,
        prob: 0.12,
      },
    },
    {
      id: MAT.OIL,
      name: 'OIL',
      cat: CAT.LIQUID,
      density: 50,
      tCond: 0.16,
      phase: {
        igniteAt: 285,
        igniteTo: MAT.FIRE,
        prob: 0.06,
      },
      tags: ['flammable'],
    },
    {
      id: MAT.WOOD,
      name: 'WOOD',
      cat: CAT.SOLID,
      density: 200,
      tCond: 0.06,
      phase: {
        igniteAt: 240,
        igniteTo: MAT.FIRE,
        prob: 0.05,
      },
      tags: ['flammable'],
    },
    {
      id: MAT.LEAVES,
      name: 'LEAVES',
      cat: CAT.POWDER,
      density: 70,
      tCond: 0.04,
      phase: {
        igniteAt: 210,
        igniteTo: MAT.FIRE,
        prob: 0.08,
      },
      tags: ['flammable'],
    },
    {
      id: MAT.FIRE,
      name: 'FIRE',
      cat: CAT.GAS,
      density: 8,
      tCond: 0.10,
      tempTarget: 520,
      life: { min: 18, max: 65, decayTo: MAT.EMPTY },
      alwaysUpdate: true,
      tags: ['hot'],
    },
    {
      id: MAT.STEAM,
      name: 'STEAM',
      cat: CAT.GAS,
      density: 5,
      tCond: 0.06,
      life: { min: 40, max: 120, decayTo: MAT.WATER, decayAltTo: MAT.EMPTY, decayAltProb: 0.45 },
      alwaysUpdate: true,
    },
    { id: MAT.DIRT, name: 'DIRT', cat: CAT.POWDER, density: 110, tCond: 0.08 },
    {
      id: MAT.SNOW,
      name: 'SNOW',
      cat: CAT.POWDER,
      density: 40,
      tCond: 0.07,
      phase: {
        meltAt: 2,
        meltTo: MAT.WATER,
        prob: 0.10,
      },
    },
    {
      id: MAT.ICE,
      name: 'ICE',
      cat: CAT.SOLID,
      density: 235,
      tCond: 0.10,
      phase: {
        meltAt: 1,
        meltTo: MAT.WATER,
        prob: 0.06,
      },
    },
    {
      id: MAT.ACID,
      name: 'ACID',
      cat: CAT.LIQUID,
      density: 75,
      tCond: 0.18,
      alwaysUpdate: true,
      tags: ['corrosive'],
    },
    {
      id: MAT.LAVA,
      name: 'LAVA',
      cat: CAT.LIQUID,
      density: 180,
      tCond: 0.25,
      tempTarget: 950,
      life: { min: 220, max: 440, decayTo: MAT.ROCK },
      alwaysUpdate: true,
      tags: ['hot'],
    },
    {
      id: MAT.PACKED_SNOW,
      name: 'PACKED_SNOW',
      cat: CAT.SOLID,
      density: 210,
      tCond: 0.09,
      phase: {
        meltAt: 1,
        meltTo: MAT.WATER,
        prob: 0.03,
      },
    },
    {
      id: MAT.DARK_ROCK,
      name: 'DARK_ROCK',
      cat: CAT.SOLID,
      density: 265,
      tCond: 0.13,
      phase: {
        meltAt: 1350,
        meltTo: MAT.LAVA,
        prob: 0.006,
      },
    },
    {
      id: MAT.SANDSTONE,
      name: 'SANDSTONE',
      cat: CAT.SOLID,
      density: 245,
      tCond: 0.11,
      phase: {
        meltAt: 1250,
        meltTo: MAT.LAVA,
        prob: 0.006,
      },
    },
];

  // ------------------------------
  // Build fast lookups
  // ------------------------------
  G.MATS = new Array(256).fill(null);

  G.density = new Int16Array(256);
  G.cat = new Uint8Array(256);
  G.tCond = new Float32Array(256);
  G.tempTarget = new Int16Array(256);
  G.hasTempTarget = new Uint8Array(256);

  G.lifeMin = new Uint16Array(256);
  G.lifeMax = new Uint16Array(256);
  G.lifeDecayTo = new Uint8Array(256);
  G.lifeDecayAltTo = new Uint8Array(256);
  G.lifeDecayAltProb = new Float32Array(256);
  G.hasLife = new Uint8Array(256);

  // Phase change thresholds (sentinel 32767 for "none")
  const NONE = 32767;
  G.meltAt = new Int16Array(256); G.meltAt.fill(NONE);
  G.meltTo = new Uint8Array(256);
  G.freezeAt = new Int16Array(256); G.freezeAt.fill(NONE);
  G.freezeTo = new Uint8Array(256);
  G.boilAt = new Int16Array(256); G.boilAt.fill(NONE);
  G.boilTo = new Uint8Array(256);
  G.igniteAt = new Int16Array(256); G.igniteAt.fill(NONE);
  G.igniteTo = new Uint8Array(256);
  G.phaseProb = new Float32Array(256);

  G.alwaysUpdate = new Uint8Array(256);
  G.tagHot = new Uint8Array(256);
  G.tagCorrosive = new Uint8Array(256);
  G.tagFlammable = new Uint8Array(256);

  G.matName = new Array(256).fill('');

  for (const d of DEF) {
    G.MATS[d.id] = d;
    G.matName[d.id] = d.name;

    G.density[d.id] = d.density | 0;
    G.cat[d.id] = d.cat | 0;
    G.tCond[d.id] = Math.max(0, Math.min(1, d.tCond ?? 0.08));

    if (typeof d.tempTarget === 'number') {
      G.tempTarget[d.id] = d.tempTarget | 0;
      G.hasTempTarget[d.id] = 1;
    } else {
      G.tempTarget[d.id] = 0;
      G.hasTempTarget[d.id] = 0;
    }

    if (d.life) {
      G.hasLife[d.id] = 1;
      G.lifeMin[d.id] = d.life.min | 0;
      G.lifeMax[d.id] = d.life.max | 0;
      G.lifeDecayTo[d.id] = d.life.decayTo | 0;
      G.lifeDecayAltTo[d.id] = (d.life.decayAltTo ?? 0) | 0;
      G.lifeDecayAltProb[d.id] = +((d.life.decayAltProb ?? 0) || 0);
    }

    if (d.phase) {
      const p = d.phase;
      if (typeof p.meltAt === 'number') { G.meltAt[d.id] = p.meltAt | 0; G.meltTo[d.id] = p.meltTo | 0; }
      if (typeof p.freezeAt === 'number') { G.freezeAt[d.id] = p.freezeAt | 0; G.freezeTo[d.id] = p.freezeTo | 0; }
      if (typeof p.boilAt === 'number') { G.boilAt[d.id] = p.boilAt | 0; G.boilTo[d.id] = p.boilTo | 0; }
      if (typeof p.igniteAt === 'number') { G.igniteAt[d.id] = p.igniteAt | 0; G.igniteTo[d.id] = p.igniteTo | 0; }
      G.phaseProb[d.id] = +((p.prob ?? 0.10) || 0);
    }

    if (d.alwaysUpdate) G.alwaysUpdate[d.id] = 1;

    if (d.tags) {
      if (d.tags.includes('hot')) G.tagHot[d.id] = 1;
      if (d.tags.includes('corrosive')) G.tagCorrosive[d.id] = 1;
      if (d.tags.includes('flammable')) G.tagFlammable[d.id] = 1;
    }
  }

  // ------------------------------
  // Category helpers
  // ------------------------------
  G.isSolid = (m) => (G.cat[m] === CAT.SOLID);
  G.isPowder = (m) => (G.cat[m] === CAT.POWDER);
  G.isLiquid = (m) => (G.cat[m] === CAT.LIQUID);
  G.isGas = (m) => (G.cat[m] === CAT.GAS);

  // Terrain = cave walls / things that are not empty, not gas, not liquid.
  G.isTerrain = (m) => (m !== MAT.EMPTY && !G.isGas(m) && !G.isLiquid(m));

  // Player collision: solids always block, powders block but can be "soft" resolved.
  G.blocksPlayer = (m) => (m !== MAT.LEAVES && (G.isSolid(m) || G.isPowder(m)));

  // Projectiles: what stops a projectile in flight
  G.blocksProjectile = (m) => (m !== MAT.EMPTY && !G.isGas(m) && m !== MAT.WATER && m !== MAT.OIL && m !== MAT.ACID);

  // Hazards
  G.isHot = (m) => (G.tagHot[m] === 1);
  G.isCorrosive = (m) => (G.tagCorrosive[m] === 1);
  G.isLiquidSwimmable = (m) => (m === MAT.WATER || m === MAT.OIL || m === MAT.ACID);

  // "Dynamic" = likely to move with gravity/flow
  G.isDynamic = (m) => (G.isPowder(m) || G.isLiquid(m) || G.isGas(m));
})();
