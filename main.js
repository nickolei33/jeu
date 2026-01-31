'use strict';
(() => {
  const G = (window.G = window.G || {});
  const C = G.CONF;

  // ------------------------------
  // Reset / bootstrap
  // ------------------------------
  function ensureLoadingHelpers() {
    if (G.setLoading && G.finishLoading) return;
    const getEls = () => ({
      el: document.getElementById('loading'),
      text: document.getElementById('loading-text'),
      bar: document.getElementById('loading-bar-inner'),
    });
    G.setLoading = (text, progress) => {
      const { el, text: tEl, bar } = getEls();
      if (!el) return;
      el.style.display = 'flex';
      el.classList.remove('hide');
      if (tEl && text) tEl.textContent = String(text);
      if (bar && typeof progress === 'number') {
        const p = G.clamp(progress, 0, 1);
        bar.style.width = Math.round(p * 100) + '%';
      }
    };
    G.finishLoading = () => {
      const { el } = getEls();
      if (!el) return;
      el.classList.add('hide');
      setTimeout(() => {
        if (el.classList.contains('hide')) el.style.display = 'none';
      }, 400);
    };
  }

  function resetWorld(newSeed) {
    ensureLoadingHelpers();
    if (G.setLoading) G.setLoading('Generating world...', 0.15);
    G._booting = true;

    // Use a new seed if provided, else keep current seed.
    if (typeof newSeed === 'number') G.setSeed(newSeed | 0);
    else G.setSeed(G.seed | 0);

    G.generateWorld();
    if (G.setLoading) G.setLoading('Finalizing...', 0.9);

    // Clear transient entities
    if (G.clearProjectiles) G.clearProjectiles();
    if (G.clearParticles) G.clearParticles();
    if (G.clearMatParticles) G.clearMatParticles();

    // Respawn player in a safe spot
    G.respawnPlayer(true);
  }

  // Public helpers (dev-friendly)
  // - resetWorld(): random seed (legacy)
  // - resetWorldWithSeed(seed): deterministic seed
  // - regenWorld(): same seed
  // - nextSeed(): +1 seed
  G.resetWorldWithSeed = (seed) => resetWorld(seed | 0);
  G.regenWorld = () => resetWorld(G.seed | 0);
  G.nextSeed = () => resetWorld(((G.seed | 0) + 1) | 0);

  G.resetWorld = () => {
    const s = (Date.now() ^ ((Math.random() * 1e9) | 0)) | 0;
    resetWorld(s);
  };

  // Boot
  G.paused = false;
  resetWorld(G.seed);
  if (G.UI) G.UI.showHelp = true;

  // ------------------------------
  // Main loop (fixed timestep)
  // ------------------------------
  let acc = 0;
  let last = performance.now();

  function frame(now) {
    const dtFrame = Math.min(0.1, Math.max(0.0, (now - last) / 1000));
    last = now;

    // FPS counter is based on real frame time (not fixed dt).
    if (G.updateFps) G.updateFps(dtFrame);

    acc += dtFrame;

    const fixed = C.FIXED_DT;
    let steps = 0;
    while (acc >= fixed && steps++ < C.MAX_STEPS_PER_FRAME) {
      acc -= fixed;
      tick(fixed);
    }

    // Render once per RAF
    if (G.render) G.render();

    requestAnimationFrame(frame);
  }

  function tick(dt) {
    // Update derived mouse world coordinates
    if (G.mouse && G.camera) {
      G.mouse.worldX = (G.camera.x | 0) + (G.mouse.sx | 0);
      G.mouse.worldY = (G.camera.y | 0) + (G.mouse.sy | 0);
    }

    if (G.updateInput) G.updateInput();

    if (G.paused) {
      // still allow camera to settle
      if (G.updateCamera) G.updateCamera(dt);
      if (G.updateWizardAnim) G.updateWizardAnim(dt);
      return;
    }

    // Wand cooldown
    if (G.castTimer > 0) G.castTimer = Math.max(0, G.castTimer - dt);

    // Casting (LMB)
    if (G.mouse && G.mouse.left && G.castTimer <= 0) {
      const ok = G.castSpellAt(G.mouse.worldX, G.mouse.worldY);
      if (ok) {
        const w = G.WANDS[G.currentWand];
        G.castTimer = w.cooldown;
        if (G.player) G.player.castT = 0.22;
      }
    }

    // Projectiles + particles
    if (G.updateProjectiles) G.updateProjectiles(dt);

    // Noita-style bridge: ballistic material particles (splashes/dust)
    if (G.updateMatParticles) G.updateMatParticles(dt);
    if (G.applyPainting) G.applyPainting();

    // World simulation
    if (G.stepSimulationActive) G.stepSimulationActive();

    // Player movement after terrain update (reduces "floating" artifacts)
    if (G.movePlayer) G.movePlayer(dt, G.input);

    // Visual particles last
    if (G.updateParticles) G.updateParticles(dt);

    // UI log
    if (G.updateLog) G.updateLog(dt);

    // Camera & sprite anim
    if (G.updateCamera) G.updateCamera(dt);
    if (G.updateWizardAnim) G.updateWizardAnim(dt);
  }

  requestAnimationFrame(frame);
})();
