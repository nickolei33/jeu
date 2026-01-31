'use strict';
(() => {
  const G = (window.G = window.G || {});

  // --------- Core configuration (tweak here, everything else derives from it)
  G.CONF = {
    // Viewport (in simulation pixels)
    VIEW_W: 640,
    VIEW_H: 360,
    SCALE: 3,
    AUTO_SCALE: true,

    // World (in simulation pixels)
    // Larger & deeper world to support a "real level" feel (macro layout + deep caves)
    // Keep WORLD_W a power-of-two for fast indexing.
    WORLD_W: 2048,
    WORLD_H: 1024,

    // ------------------------------------------------------
    // Level generation (macro -> micro)
    // Primary goal: readable & traversable levels.
    // ------------------------------------------------------
    LEVEL_GEN: {
      // 0..1 : fraction of the world width used for the main layout
      // Slightly higher now that the world is bigger.
      levelLength: 0.95,

      // Macro layout
      roomCount: 12,         // main rooms along the path
      branchCount: 3,        // optional side rooms
      verticality: 0.55,     // 0..1 : vertical variation of the main path
      corridorWidth: 22,     // tunnel diameter-ish (world px)

      // Surface readability
      surfaceRoughness: 0.35, // 0..1 : micro noise on the outdoor surface

      // Micro hazards (kept away from spawn + main path)
      hazardRate: 0.20,      // 0..1

      // Spawn safety / entry
      spawnFlatWidth: 320,     // guaranteed flat ground around spawn (px)
      spawnEntranceOffset: 140, // cave entrance X offset from spawn (px)

      // Micro dressing (SNOW biome): cornices + icicles
      // 0..1 (used by decorateWorld); higher = more set dressing
      snowCorniceRate: 0.60,
      icicleRate: 0.70,

      // Validation / retries
      maxRetries: 8,
    },

    // ------------------------------------------------------
    // Level generation v2 (density + CA + biomes)
    // ------------------------------------------------------
    LEVEL_GEN2: {
      presetIndex: 0,
      presets: [
        {
          name: 'Balanced',
          params: {
            surfaceBase: 0.20,
            surfaceAmp: 0.18,
            surfaceScale: 220,
            surfaceWarpScale: 420,
            surfaceWarpAmp: 38,

            densityScale: 85,
            densityAmp: 0.55,
            ridgeAmp: 0.35,
            warpScale: 120,
            warpAmp: 28,

            caveFill: 0.54,
            caveIter: 4,
            caveScale: 2,
            caveMinDepth: 26,

            erosionPasses: 2,
            slumpRate: 0.08,

            oreRate: 0.18,
            oreScale: 44,
            pocketRate: 0.10,
            pocketScale: 72,

            tunnelCount: 4,
          },
        },
        {
          name: 'Caves Dense',
          params: {
            surfaceBase: 0.22,
            surfaceAmp: 0.20,
            surfaceScale: 200,
            surfaceWarpScale: 380,
            surfaceWarpAmp: 42,

            densityScale: 90,
            densityAmp: 0.60,
            ridgeAmp: 0.40,
            warpScale: 110,
            warpAmp: 32,

            caveFill: 0.58,
            caveIter: 5,
            caveScale: 2,
            caveMinDepth: 30,

            erosionPasses: 2,
            slumpRate: 0.10,

            oreRate: 0.22,
            oreScale: 40,
            pocketRate: 0.12,
            pocketScale: 68,

            tunnelCount: 3,
          },
        },
        {
          name: 'Caves Aerees',
          params: {
            surfaceBase: 0.18,
            surfaceAmp: 0.16,
            surfaceScale: 240,
            surfaceWarpScale: 460,
            surfaceWarpAmp: 34,

            densityScale: 75,
            densityAmp: 0.48,
            ridgeAmp: 0.28,
            warpScale: 130,
            warpAmp: 26,

            caveFill: 0.48,
            caveIter: 3,
            caveScale: 2,
            caveMinDepth: 20,

            erosionPasses: 2,
            slumpRate: 0.06,

            oreRate: 0.16,
            oreScale: 50,
            pocketRate: 0.08,
            pocketScale: 80,

            tunnelCount: 5,
          },
        },
        {
          name: 'Islands',
          params: {
            surfaceBase: 0.16,
            surfaceAmp: 0.22,
            surfaceScale: 180,
            surfaceWarpScale: 380,
            surfaceWarpAmp: 50,

            densityScale: 70,
            densityAmp: 0.50,
            ridgeAmp: 0.50,
            warpScale: 100,
            warpAmp: 40,

            caveFill: 0.50,
            caveIter: 3,
            caveScale: 2,
            caveMinDepth: 18,

            erosionPasses: 2,
            slumpRate: 0.05,

            oreRate: 0.14,
            oreScale: 54,
            pocketRate: 0.06,
            pocketScale: 86,

            tunnelCount: 6,
          },
        },
      ],
    },

    // ------------------------------------------------------
    // Visuals (precomputed caches, pixel-art shading)
    // ------------------------------------------------------
    VISUALS: {
      // 0=Low, 1=Medium, 2=High (toggle with F3)
      quality: 2,

      // Rock texture intensity (0..1)
      rockGrain: 0.68,
    },

    // Fixed timestep simulation
    FIXED_DT: 1 / 60,
    MAX_STEPS_PER_FRAME: 6, // prevents spiral-of-death when tab was inactive

    // How far (in pixels) the simulation is updated around the camera/player
    SIM_MARGIN: 56,

    // Chunking (performance + future streaming)
    // IMPORTANT: keep a power-of-two for fast indexing.
    CHUNK_SIZE: 32,

    // Temperature simulation
    // Units are in "°C" (conceptually). Internally stored as int16.
    TEMP_DIFFUSION_SCALE: 1.0,
    TEMP_PHASE_PROB: 0.10,

    // Player
    PLAYER_MAX_SPEED: 78,

    // Cape (wizard_sdf.js)
    // World-space units (simulation pixels)
    CAPE: {
      // Cape chain simulation (wizard_sdf.js) — WORLD pixels
      // 목표: souple, ondulante, et "verticale" en chute (Noita-ish).
      // Slightly shorter + more links = smoother, less rigid, better drape.
      length: 20,     // total length (WORLD px)
      links: 18,      // number of links along the spine

      // Visual width (WORLD px)
      wTop: 2.0,
      wBot: 5.0,

      // Physics
      gravity: 900,
      damping: 0.9955,

      // Aerodynamics (separate X / Y to avoid "balloon floating")
      dragX: 4.8,
      dragY: 3.6,

      // Bending resistance (keep low for cloth feel)
      bend: 0.05,

      // Solver
      substeps: 3,
      iterations: 10,

      // Collisions
      thickness: 1.4,
      // Higher = slides more (less sticking / "blocking" on turns)
      friction: 0.9,
      collideFrom: 4,

      // Stability / anti-glitch
      // If the attachment point moves too far in a single frame (e.g. instant turn),
      // we partially rebase upper links to avoid a 1-2 frame "stretched line" artifact.
      turnTeleportDist: 7.5,
      turnRebase: 0.85,
      maxDispPerSubstep: 8.0,


      // Emergency clamp: maximum allowed segment stretch before we hard-clamp.
      // Prevents rare 1-2 frame \"rubber band\" elongation during very fast motion.
      maxSegStretch: 1.25,

      // Turn swing tuning
      kickImpulse: 42,
      kickAccel: 520,

      // Turn "un-stick" helper:
      // When rapidly changing facing, the cape can briefly get trapped against
      // the body collider in 2D. We allow it to pass through the body for a
      // tiny window so it can re-center behind the sprite.
      // (Cape is rendered behind the body, so this pass-through isn't visible.)
      turnNoCollideTime: 0.14,

      // Extra "un-stick" helper on turn:
      // While body collisions are off, softly pushes the spine behind the torso
      // so it doesn't get trapped on the wrong side when re-enabling collisions.
      keepBehindDist: 0.8,      // WORLD px (how far behind the anchor plane)
      keepBehindStiff: 0.42,    // 0..1 (strength)
    },

    // Character (5loc procedural port)
    // Visual-only tuning (does NOT affect gameplay physics).
    // Prevents rapid pose toggling ("blink") on small slopes/steps.
    CHAR5LOC: {
      // Delay before switching to the "fall" pose after leaving the ground.
      // Increase slightly if you see flicker when going up/down tiny slopes.
      fallAnimDelay: 0.12,      // seconds

      // "Long fall" threshold: we keep walk/run arm swing for short airtime
      // (small bumps, tiny gaps), and only raise arms in the dramatic fall pose
      // after this delay (or when vy is very high).
      longFallDelay: 0.28,      // seconds
      longFallVy: 320,          // px/s

      // While off-ground for a short time, keep move-arm animation (prevents
      // arms popping up/down on small slopes and 1-frame airborne states).
      airMoveGrace: 0.20,       // seconds

      // Idle breathing (visual only)
      idleBreathAmp: 0.65,      // local units (scaled)

      // If falling faster than this, bypass the delay (instant fall pose).
      fallImmediateVy: 220,     // px/s

      // If moving upward faster than this, don't apply grounded grace (jump pose wins).
      groundGraceVy: -25,       // px/s

      // ------------------------------
      // Run / walk gait tuning (visual only)
      // ------------------------------
      // Reference speed for "full run" stride.
      // Match the sandbox max speed so we actually reach the intended
      // stride at full sprint (otherwise the gait looks like "gliding").
      runSpeedRef: 78,

      // Stride (local units; multiplied by the visual scale during draw)
      // Keep a tiny minimum stride so slow movement doesn't look like
      // "ice skating".
      strideMin: 2.0,
      // Bigger stride = less "zombie gliding" and more anime-like readability.
      strideMax: 18.0,

      // Foot lift during swing (local units)
      liftMin: 1.2,
      // Higher lift helps sell the swing phase (anime-ish), while foot-plant
      // keeps contact stable.
      liftMax: 8.2,

      // Portion of the cycle spent in stance (foot on ground)
      stanceWalk: 0.63,
      // Slightly shorter stance at high speed = snappier, less "stuck".
      stanceRun: 0.42,

      // Small asymmetry for a less "robotic" gait (radians of phase bias)
      phaseBias: 0.08,

      // ------------------------------
      // Depth readability (far/back leg)
      // ------------------------------
      // The "far" leg is shaded darker and can read oddly if it swings
      // exactly like the near leg (it can appear to "cut" through the torso).
      // Slightly smaller swing + overshoot improves readability.
      farStrideMul: 0.98,
      farLiftMul: 0.98,
      farOvershootMul: 0.90,

      // ------------------------------
      // Hard turn / pivot animation (visual only)
      // ------------------------------
      // When the facing flips at speed, we briefly plant a pivot foot so the
      // character doesn't look like it's "ice skating" during a demi-tour.
      // Snappy demi-tours: shorter + more decisive.
      // (Coupled with ground braking in player.js to avoid "skate".)
      turnAnimTime: 0.10,      // seconds
      turnMinSpeed: 14,        // px/s (ignore tiny flips)
      // How much the walk cycle keeps advancing during the turn window.
      // Lower = less "glide".
      turnCycleMul: 0.03,      // 0..1

      // During a hard turn, the non-pivot leg performs a forced step and
      // plants on the new side. This parameter controls when the step lands.
      // Earlier plant = crisper turn.
      turnStepPlantU: 0.38,    // 0..1 within the turn window

      // When to visually flip facing inside the turn window.
      // Keep old facing early (skid), then snap to new direction.
      // Flip slightly earlier so the turn reads as a real pivot, not a glide.
      turnFaceFlipU: 0.42,

      // ------------------------------
      // Air legs (jump / fall)
      // ------------------------------
      // A small, slower "air cycle" so legs aren't frozen in a single pose.
      // Long enough to read as "animated", short enough to not look like
      // running in the void.
      airLegCycleHz: 1.35,
      // Extra scissor amplitude during fall (cartoon/anime readability).
      airLegScissorAmp: 0.22,
      // Knee drive during jump (more tuck / more fun).
      airJumpTuck: 1.0,

      // Acceleration deadzone for upper-body lean (visual only): prevents
      // recurrent arm/body popping on tiny bumps/slopes.
      axDeadzone: 140,

      // ------------------------------
      // Leg slack / IK stability (visual only)
      // ------------------------------
      // If the hip is at full leg extension, stride collapses and the character
      // looks like it's "gliding". We keep a bit of slack so knees stay bent.
      hipDropIdle: 1.2,
      hipDropRun: 4.2,

      // Reduce hip bounce so it doesn't temporarily remove the slack.
      hipBounceScale: 0.45,

      // Reach padding for IK (smaller = more reach). Too large => gliding.
      // Slightly smaller padding = more reachable X before clamping,
      // reducing visible foot sliding.
      legReachPad: 0.18,
    },

    // Ballistic material particles (Noita-style "pixel splashes") (Noita-style "pixel splashes")
    MAT_PARTICLES: {
      MAX: 1400,
      // How many collision substeps per update (prevents tunneling)
      SUBSTEPS: 2,
    },

    // Debug
    START_SEED: 0, // 0 = random at startup
  };

  // --------- Keybinds (easy to tweak / AZERTY-friendly)
  // Notes:
  // - Movement supports ZQSD/WASD + arrows
  // - Most toggles ignore key-repeat to avoid flicker
  G.KEYBINDS = {
    moveLeft: ['a', 'q', 'arrowleft'],
    moveRight: ['d', 'arrowright'],
    jump: ['w', 'z', ' ', 'arrowup'],
    sprint: ['shift'],
    toggleSprint: ['capslock'],

    // Gameplay
    nextWand: ['tab'],
    prevWand: ['shift+tab'],
    wand1to7: ['1', '2', '3', '4', '5', '6', '7'],
    nextBrush: ['e'],
    prevBrush: ['shift+e'],
    radiusUp: [']'],
    radiusDown: ['['],

    // Toggles
    regenSameSeed: ['r'],
    resetWorld: ['shift+r'],
    nextSeed: ['n'],
    toggleHUD: ['h'],
    toggleHelp: ['t', '?'],
    toggleDebug: ['f1'],
    toggleGenDebug: ['f2'],
    genDebugMode: ['f4'],
    genRegen: ['f5'],
    genMutate: ['f6'],
    genPreset: ['f7'],
    toggleQuality: ['f3'],
    togglePostFX: ['g'],
    togglePause: ['p', 'escape'],
    toggleMenu: ['m'],
  };
})();
