'use strict';
(() => {
  const G = (window.G = window.G || {});

  // =========================================================
  // In-game message log (Noita/Nethack style communication)
  // - Systems should call G.log("...") when something notable happens.
  // - UI renders the last lines (with fade).
  // =========================================================

  const MAX_LINES = 6;

  G.logLines = [];

  G.log = (text, ttl = 2.5) => {
    if (!text) return;
    const s = String(text);
    G.logLines.push({ text: s, ttl: +ttl, t0: +ttl });
    while (G.logLines.length > MAX_LINES) G.logLines.shift();

    // Also mirror to console for dev.
    try { console.log('[LOG]', s); } catch (e) {}
  };

  G.updateLog = (dt) => {
    if (!G.logLines.length) return;
    for (let i = G.logLines.length - 1; i >= 0; i--) {
      const L = G.logLines[i];
      L.ttl -= dt;
      if (L.ttl <= 0) G.logLines.splice(i, 1);
    }
  };
})();
