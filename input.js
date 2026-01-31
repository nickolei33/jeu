'use strict';
(() => {
  const G = (window.G = window.G || {});
  const { VIEW_W, VIEW_H } = G.CONF;

  // ------------------------------
  // Input (layout-friendly)
  // ------------------------------
  G.keys = new Set();

  // Centralized keybinds (config.js)
  const BIN = G.KEYBINDS || {};

  G.input = {
    left: false,
    right: false,
    jumpHeld: false,
    jumpPressed: false,
    sprintHeld: false,
    sprintToggle: false,
  };

  let prevJumpHeld = false;

  G.mouse = { sx: VIEW_W * 0.5, sy: VIEW_H * 0.5, worldX: 0, worldY: 0, left: false, right: false };

  const canvas = G.canvas;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function updateMousePos(ev) {
    const r = canvas.getBoundingClientRect();
    const mx = ((ev.clientX - r.left) / r.width) * VIEW_W;
    const my = ((ev.clientY - r.top) / r.height) * VIEW_H;
    G.mouse.sx = G.clamp(mx, 0, VIEW_W - 1);
    G.mouse.sy = G.clamp(my, 0, VIEW_H - 1);
  }
  G.updateMousePos = updateMousePos;

  canvas.addEventListener('mousemove', updateMousePos);
  canvas.addEventListener('mousedown', (e) => {
    updateMousePos(e);
    if (e.button === 0) {
      if (G.UI?.showMenu && G.menuClick) {
        G.menuClick(G.mouse.sx | 0, G.mouse.sy | 0);
        return;
      }
      G.mouse.left = true;
    }
    if (e.button === 2) G.mouse.right = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) G.mouse.left = false;
    if (e.button === 2) G.mouse.right = false;
  });
  window.addEventListener('blur', () => {
    G.keys.clear();
    G.mouse.left = false;
    G.mouse.right = false;
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();

      const dir = e.deltaY > 0 ? -1 : 1;

      if (e.shiftKey) {
        // Shift+wheel => brush selection
        const n = G.BRUSHES?.length || 1;
        G.brushIndex = (G.brushIndex + dir + n) % n;
      } else if (e.ctrlKey) {
        // Ctrl+wheel => wand selection
        const n = G.WANDS?.length || 1;
        G.currentWand = (G.currentWand + dir + n) % n;
      } else {
        // wheel => radius
        G.paintRadius += dir;
        G.paintRadius = G.clamp(G.paintRadius, 2, 24);
      }
    },
    { passive: false },
  );

  function normKey(k) {
    if (!k) return '';
    // Keep space as-is
    if (k === ' ') return ' ';
    return k.toLowerCase();
  }

  function anyDown(list) {
    if (!list || !list.length) return false;
    for (const k of list) {
      if (G.keys.has(k)) return true;
    }
    return false;
  }

  function setQuality(n) {
    const q = G.setQuality ? G.setQuality(n) : G.clamp(n | 0, 0, 2);
    if (G.log) G.log(q === 0 ? 'QUALITY LOW' : (q === 1 ? 'QUALITY MED' : 'QUALITY HIGH'));
  }

  window.addEventListener('keydown', (e) => {
    // Prevent toggle spam from key-repeat.
    if (e.repeat) return;

    const k = normKey(e.key);
    if (!k) return;

    // Track held keys
    G.keys.add(k);
    if (e.shiftKey && k !== 'shift') G.keys.add('shift+' + k);

    // Prevent page scroll / focus stealing
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab'].includes(k)) e.preventDefault();
    if (k === 'f1' || k === 'f2') e.preventDefault();

    const combo = (e.shiftKey && k !== 'shift') ? ('shift+' + k) : k;

    // Sprint toggle (Caps Lock)
    if (BIN.toggleSprint && BIN.toggleSprint.includes(k)) {
      G.input.sprintToggle = !G.input.sprintToggle;
      if (G.log) G.log(G.input.sprintToggle ? 'SPRINT ON' : 'SPRINT OFF');
      return;
    }

    // Menu toggle
    if (anyDown(BIN.toggleMenu) && k === 'm') {
      if (G.UI) G.UI.showMenu = !G.UI.showMenu;
      if (G.log) G.log(G.UI?.showMenu ? 'MENU ON' : 'MENU OFF');
      return;
    }

    // Help (hold)
    if (BIN.toggleHelp && BIN.toggleHelp.includes(k)) {
      if (G.UI) G.UI.showHelp = true;
      return;
    }

    // Menu shortcuts (avoid changing wands while menu is open)
    if (G.UI?.showMenu) {
      if (k === '1') { setQuality(0); return; }
      if (k === '2') { setQuality(1); return; }
      if (k === '3') { setQuality(2); return; }
      if (k === 'h') { G.UI.showHUD = !G.UI.showHUD; if (G.log) G.log(G.UI.showHUD ? 'HUD ON' : 'HUD OFF'); return; }
      if (k === 't' || k === '?') { G.UI.showHelp = !G.UI.showHelp; if (G.log) G.log(G.UI.showHelp ? 'HELP ON' : 'HELP OFF'); return; }
      if (k === 'g') { G.postFX = !G.postFX; if (G.log) G.log(G.postFX ? 'POSTFX ON' : 'POSTFX OFF'); return; }
      if (k === 'p' || k === 'escape') {
        G.paused = !G.paused;
        if (G.log) G.log(G.paused ? 'PAUSED' : 'RESUMED');
        return;
      }
    }

    // Quick wand selection (1..7)
    if (k >= '1' && k <= '7') {
      G.currentWand = (k.charCodeAt(0) - 49) | 0;
      return;
    }

    // Wand cycle
    if (anyDown(BIN.nextWand) && k === 'tab') {
      const n = G.WANDS?.length || 1;
      G.currentWand = (G.currentWand + 1) % n;
      return;
    }
    if (anyDown(BIN.prevWand) && combo === 'shift+tab') {
      const n = G.WANDS?.length || 1;
      G.currentWand = (G.currentWand - 1 + n) % n;
      return;
    }

    // Brush cycle
    if (anyDown(BIN.nextBrush) && k === 'e' && !e.shiftKey) {
      const n = G.BRUSHES?.length || 1;
      G.brushIndex = (G.brushIndex + 1) % n;
      return;
    }
    if (anyDown(BIN.prevBrush) && combo === 'shift+e') {
      const n = G.BRUSHES?.length || 1;
      G.brushIndex = (G.brushIndex - 1 + n) % n;
      return;
    }

    // Brush radius hotkeys
    if (anyDown(BIN.radiusUp) && k === ']') {
      G.paintRadius = G.clamp((G.paintRadius | 0) + 1, 2, 24);
      return;
    }
    if (anyDown(BIN.radiusDown) && k === '[') {
      G.paintRadius = G.clamp((G.paintRadius | 0) - 1, 2, 24);
      return;
    }

    // Regenerate (same seed)
    if (anyDown(BIN.regenSameSeed) && k === 'r' && !e.shiftKey) {
      if (G.regenWorld) G.regenWorld();
      else if (G.resetWorldWithSeed) G.resetWorldWithSeed(G.seed | 0);
      if (G.log) G.log('WORLD REGEN');
      return;
    }

    // Reset world (random seed)
    if (anyDown(BIN.resetWorld) && combo === 'shift+r') {
      if (G.resetWorld) G.resetWorld();
      if (G.log) G.log('WORLD RESET');
      return;
    }

    // Next seed (+1)
    if (anyDown(BIN.nextSeed) && k === 'n') {
      if (G.nextSeed) G.nextSeed();
      else if (G.resetWorldWithSeed) G.resetWorldWithSeed(((G.seed | 0) + 1) | 0);
      if (G.log) G.log('NEXT SEED');
      return;
    }

    // Level-gen debug overlay (rooms/corridors/path)
    if (anyDown(BIN.toggleGenDebug) && k === 'f2') {
      if (G.UI) G.UI.showGenDebug = !G.UI.showGenDebug;
      if (G.log) G.log(G.UI?.showGenDebug ? 'GEN DEBUG ON' : 'GEN DEBUG OFF');
      return;
    }

    if (anyDown(BIN.genDebugMode) && k === 'f4') {
      if (G.genCycleDebugMode) G.genCycleDebugMode();
      return;
    }
    if (anyDown(BIN.genRegen) && k === 'f5') {
      if (G.genRegen) G.genRegen();
      return;
    }
    if (anyDown(BIN.genMutate) && k === 'f6') {
      if (G.genMutateParam) G.genMutateParam();
      return;
    }
    if (anyDown(BIN.genPreset) && k === 'f7') {
      if (G.genNextPreset) G.genNextPreset();
      return;
    }

    // Visual quality (Low/Med/High)
    if (anyDown(BIN.toggleQuality) && k === 'f3') {
      const V = (G.CONF && G.CONF.VISUALS) ? G.CONF.VISUALS : (G.CONF.VISUALS = {});
      const cur = (V.quality | 0) || 0;
      const nxt = (cur + 1) % 3;
      setQuality(nxt);
      return;
    }

    // Toggles
    if (anyDown(BIN.toggleHUD) && k === 'h') G.UI.showHUD = !G.UI.showHUD;
    if (anyDown(BIN.togglePostFX) && k === 'g') {
      G.postFX = !G.postFX;
      if (G.log) G.log(G.postFX ? 'POSTFX ON' : 'POSTFX OFF');
    }
    if (anyDown(BIN.toggleDebug) && k === 'f1') G.UI.showDebug = !G.UI.showDebug;

    // Pause
    if (anyDown(BIN.togglePause) && (k === 'p' || k === 'escape')) {
      G.paused = !G.paused;
      if (G.log) G.log(G.paused ? 'PAUSED' : 'RESUMED');
      if (G.paused) G.UI.showHelp = true;
    }
  });

  window.addEventListener('keyup', (e) => {
    const k = normKey(e.key);
    if (!k) return;
    G.keys.delete(k);
    G.keys.delete('shift+' + k);
    if (BIN.toggleHelp && BIN.toggleHelp.includes(k)) {
      if (G.UI) G.UI.showHelp = false;
    }
  });

  // Called from main loop
  G.updateInput = () => {
    const keys = G.keys;

    // Movement uses keybind lists (config.js)
    const left = anyDown(BIN.moveLeft);
    const right = anyDown(BIN.moveRight);
    const jumpHeld = anyDown(BIN.jump);
    const sprintHeld = anyDown(BIN.sprint);

    G.input.left = left;
    G.input.right = right;

    G.input.jumpHeld = jumpHeld;
    G.input.jumpPressed = jumpHeld && !prevJumpHeld;
    G.input.sprintHeld = sprintHeld;
    prevJumpHeld = jumpHeld;
  };
})();
