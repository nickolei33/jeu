'use strict';
(() => {
  const G = (window.G = window.G || {});

  // =========================================================
  // WIZARD ANIMATION CLIPS - ULTIMATE POLISH (RUN + WALK)
  // =========================================================
  // - Added WALK cycle for low speeds.
  // - Refined RUN for high speeds.
  // =========================================================

  G.wizardClips = G.wizardClips || {};

  function normaliseClip(clip) {
    if (!clip || !Array.isArray(clip.keyframes)) return null;
    return {
      name: clip.name, loop: !!clip.loop, duration: clip.duration || 1,
      keyframes: clip.keyframes.map(k => ({
        t: k.t,
        root: { x: k.root?.x || 0, y: k.root?.y || 0 },
        bones: { ...k.bones },
        events: k.events || {}
      })),
    };
  }

  function loadWizardClips(clips) {
    for (const c of (Array.isArray(clips) ? clips : [clips])) {
      const clip = normaliseClip(c);
      if (clip) G.wizardClips[clip.name] = clip;
    }
  }
  G.loadWizardClips = loadWizardClips;

  // =====================================================
  // IDLE
  // =====================================================
  function makeIdleClip() {
    // 24-second "Performance" loop
    // Phases: Breathe -> Look Around -> Inspect Staff -> Tap Ground -> Stretch -> Reset
    const frames = [
      // --- PHASE 1: BASE BREATHING (0-4s) ---
      { t: 0.0, root: { x: 0, y: 0 }, bones: { spine: -5, neck: 5, armR_up: -40, armR_lo: -40, armL_up: -10, armL_lo: 10, cape: 5, staff: 0 } },
      { t: 1.0, root: { x: 0, y: -1 }, bones: { spine: -8, neck: 3, armR_up: -42, armR_lo: -38, armL_up: -12, armL_lo: 8, cape: 4, staff: 2 } }, // In
      { t: 2.0, root: { x: 0, y: 1 }, bones: { spine: -4, neck: 6, armR_up: -38, armR_lo: -42, armL_up: -8, armL_lo: 12, cape: 6, staff: -1 } }, // Out
      { t: 3.0, root: { x: 0, y: -1 }, bones: { spine: -8, neck: 3, armR_up: -42, armR_lo: -38, armL_up: -12, armL_lo: 8, cape: 4, staff: 2 } }, // In
      { t: 4.0, root: { x: 0, y: 0 }, bones: { spine: -5, neck: 5, armR_up: -40, armR_lo: -40, armL_up: -10, armL_lo: 10, cape: 5, staff: 0 } }, // Out

      // --- PHASE 2: LOOK AROUND (4-8s) ---
      // Look Left
      { t: 5.0, root: { x: 0, y: 0 }, bones: { spine: -5, neck: -20, armR_up: -38, armR_lo: -40, armL_up: -10, armL_lo: 10, cape: 2, staff: 0 } },
      // Look Right (pass through center)
      { t: 6.5, root: { x: 0, y: 0 }, bones: { spine: -5, neck: 25, armR_up: -42, armR_lo: -40, armL_up: -10, armL_lo: 10, cape: 8, staff: 0 } },
      // Return Center
      { t: 8.0, root: { x: 0, y: 0 }, bones: { spine: -5, neck: 5, armR_up: -40, armR_lo: -40, armL_up: -10, armL_lo: 10, cape: 5, staff: 0 } },

      // --- PHASE 3: INSPECT STAFF (8-12s) ---
      // Lift staff high (bring armR up and forward)
      { t: 9.0, root: { x: -2, y: -1 }, bones: { spine: -10, neck: 15, armR_up: -80, armR_lo: -60, armL_up: -20, armL_lo: 0, cape: 0, staff: 10 } },
      // Inspect closely (tilt head down towards orb)
      { t: 10.0, root: { x: -2, y: -1 }, bones: { spine: -12, neck: 25, armR_up: -85, armR_lo: -55, armL_up: -20, armL_lo: 0, cape: 0, staff: 15 } },
      // Lower staff back down
      { t: 12.0, root: { x: 0, y: 0 }, bones: { spine: -5, neck: 5, armR_up: -40, armR_lo: -40, armL_up: -10, armL_lo: 10, cape: 5, staff: 0 } },

      // --- PHASE 4: GROUND TAP (Magic Check) (15-19s) ---
      // Lift slightly
      { t: 15.5, root: { x: 0, y: -2 }, bones: { spine: -10, neck: 0, armR_up: -60, armR_lo: -20, armL_up: -15, armL_lo: 5, cape: 2, staff: 5 } },
      // TAP DOWN! (Impact)
      { t: 16.0, root: { x: 0, y: 2 }, bones: { spine: 5, neck: 10, armR_up: -20, armR_lo: -50, armL_up: -5, armL_lo: 15, cape: 10, staff: -5 } },
      // Recover interaction
      { t: 17.0, root: { x: 0, y: 0 }, bones: { spine: -5, neck: 5, armR_up: -40, armR_lo: -40, armL_up: -10, armL_lo: 10, cape: 5, staff: 0 } },

      // --- PHASE 5: BIG STRETCH (19-24s) ---
      // Arch back, arms slightly back/down
      { t: 20.0, root: { x: 0, y: -4 }, bones: { spine: -25, neck: -10, armR_up: -60, armR_lo: -10, armL_up: -30, armL_lo: -10, cape: -5, staff: 5 } },
      // Hold stretch...
      { t: 21.5, root: { x: 0, y: -3 }, bones: { spine: -22, neck: -5, armR_up: -55, armR_lo: -15, armL_up: -25, armL_lo: -5, cape: -2, staff: 4 } },
      // Relax / Shakeout
      { t: 23.0, root: { x: 0, y: 1 }, bones: { spine: 0, neck: 10, armR_up: -30, armR_lo: -50, armL_up: 0, armL_lo: 20, cape: 8, staff: -2 } },

      // Loop
      { t: 24.0, root: { x: 0, y: 0 }, bones: { spine: -5, neck: 5, armR_up: -40, armR_lo: -40, armL_up: -10, armL_lo: 10, cape: 5, staff: 0 } }
    ];
    return { name: 'idle', loop: true, duration: 24.0, keyframes: frames };
  }

  // =====================================================
  // WALK (NEW) - Relaxed Stroll
  // =====================================================
  function makeWalkClip() {
    // Standard 8-frame Walk
    return {
      name: 'walk', loop: true, duration: 0.8,
      keyframes: [
        // Contact R
        { t: 0.0, root: { x: 0, y: 1 }, bones: { legR_up: 30, legR_lo: 0, legL_up: -20, legL_lo: 10, armL_up: 20, armL_lo: 10, armR_up: -20, armR_lo: -20, spine: -5 } },
        // Down R
        { t: 0.1, root: { x: 0, y: 2 }, bones: { legR_up: 20, legR_lo: 20, legL_up: -10, legL_lo: 40, armL_up: 15, armL_lo: 15, armR_up: -25, armR_lo: -15, spine: -2 } },
        // Pass R
        { t: 0.2, root: { x: 0, y: 1 }, bones: { legR_up: 0, legR_lo: 10, legL_up: 10, legL_lo: 60, armL_up: 0, armL_lo: 20, armR_up: -40, armR_lo: -40, spine: 0 } },
        // Up R
        { t: 0.3, root: { x: 0, y: 0 }, bones: { legR_up: -10, legR_lo: 10, legL_up: 20, legL_lo: 30, armL_up: -10, armL_lo: 10, armR_up: -30, armR_lo: -30, spine: -2 } },
        // Contact L
        { t: 0.4, root: { x: 0, y: 1 }, bones: { legL_up: 30, legL_lo: 0, legR_up: -20, legR_lo: 10, armR_up: 10, armR_lo: -10, armL_up: -10, armL_lo: 20, spine: -5 } },
        // Down L
        { t: 0.5, root: { x: 0, y: 2 }, bones: { legL_up: 20, legL_lo: 20, legR_up: -10, legR_lo: 40, armR_up: 5, armR_lo: -15, armL_up: 0, armL_lo: 25, spine: -2 } },
        // Pass L
        { t: 0.6, root: { x: 0, y: 1 }, bones: { legL_up: 0, legL_lo: 10, legR_up: 10, legR_lo: 60, armR_up: -10, armR_lo: -20, armL_up: 10, armL_lo: 20, spine: 0 } },
        // Up L
        { t: 0.7, root: { x: 0, y: 0 }, bones: { legL_up: -10, legL_lo: 10, legR_up: 20, legR_lo: 30, armR_up: -15, armR_lo: -25, armL_up: 15, armL_lo: 15, spine: -2 } },
        // Loop
        { t: 0.8, root: { x: 0, y: 1 }, bones: { legR_up: 30, legR_lo: 0, legL_up: -20, legL_lo: 10, armL_up: 20, armL_lo: 10, armR_up: -20, armR_lo: -20, spine: -5 } }
      ]
    };
  }

  // =====================================================
  // RUN - FLUID MANGA DASH (Updated)
  // =====================================================
  function makeRunClip() {
    const frames = [
      { t: 0.0, root: { x: 4, y: 4 }, bones: { spine: -40, neck: 30, legL_up: 50, legL_lo: -10, legR_up: -30, legR_lo: 20, armL_up: -50, armL_lo: 40, armR_up: -20, armR_lo: -60, cape: -10 } },
      { t: 0.0625, root: { x: 2, y: 6 }, bones: { spine: -38, neck: 28, legL_up: 40, legL_lo: 20, legR_up: -20, legR_lo: 40, armL_up: -30, armL_lo: 30, armR_up: -30, armR_lo: -50, cape: -5 } },
      { t: 0.125, root: { x: 0, y: 3 }, bones: { spine: -35, neck: 25, legL_up: 10, legL_lo: 40, legR_up: 20, legR_lo: 60, armL_up: 10, armL_lo: 20, armR_up: -60, armR_lo: -40, cape: 0 } },
      { t: 0.1875, root: { x: 2, y: 2 }, bones: { spine: -38, neck: 28, legL_up: -10, legL_lo: 30, legR_up: 40, legR_lo: 30, armL_up: 30, armL_lo: 10, armR_up: -70, armR_lo: -30, cape: -5 } },
      { t: 0.25, root: { x: 4, y: 4 }, bones: { spine: -40, neck: 30, legL_up: -30, legL_lo: 20, legR_up: 50, legR_lo: -10, armL_up: 40, armL_lo: 20, armR_up: -80, armR_lo: -40, cape: -10 } },
      { t: 0.3125, root: { x: 2, y: 6 }, bones: { spine: -38, neck: 28, legL_up: -20, legL_lo: 40, legR_up: 40, legR_lo: 20, armL_up: 30, armL_lo: 30, armR_up: -60, armR_lo: -30, cape: -5 } },
      { t: 0.375, root: { x: 0, y: 3 }, bones: { spine: -35, neck: 25, legL_up: 20, legL_lo: 60, legR_up: 10, legR_lo: 40, armL_up: -10, armL_lo: 20, armR_up: -40, armR_lo: -40, cape: 0 } },
      { t: 0.4375, root: { x: 2, y: 2 }, bones: { spine: -38, neck: 28, legL_up: 40, legL_lo: 30, legR_up: -10, legR_lo: 30, armL_up: -40, armL_lo: 30, armR_up: -30, armR_lo: -50, cape: -5 } },
      { t: 0.5, root: { x: 4, y: 4 }, bones: { spine: -40, neck: 30, legL_up: 50, legL_lo: -10, legR_up: -30, legR_lo: 20, armL_up: -50, armL_lo: 40, armR_up: -20, armR_lo: -60, cape: -10 } }
    ];
    return { name: 'run', loop: true, duration: 0.5, keyframes: frames };
  }

  function makeJumpClip() {
    return {
      name: 'jump', loop: false, duration: 0.3,
      keyframes: [
        { t: 0, root: { x: 0, y: 0 }, bones: { spine: -20, legL_up: 10, legL_lo: 80, legR_up: 10, legR_lo: 80 } },
        { t: 0.3, root: { x: 0, y: -8 }, bones: { spine: 15, neck: -10, legL_up: -20, legL_lo: -10, legR_up: 10, legR_lo: 60, cape: -40 } }
      ]
    };
  }

  function makeCastClip() {
    return {
      name: 'cast', loop: false, duration: 0.25,
      keyframes: [
        { t: 0, root: { x: -5, y: 2 }, bones: { spine: -30, armR_up: -140, armR_lo: -130 } },
        { t: 0.25, root: { x: 6, y: -1 }, bones: { spine: -20, armR_up: -170, armR_lo: 0 } }
      ]
    };
  }

  loadWizardClips([makeIdleClip(), makeWalkClip(), makeRunClip(), makeJumpClip(), makeCastClip()]);
})();
