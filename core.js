'use strict';
(() => {
  const G = (window.G = window.G || {});
  const C = G.CONF;

  // ------------------------------
  // Small helpers
  // ------------------------------
  G.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  G.lerp = (a, b, t) => a + (b - a) * t;
  G.smoothstep = (t) => t * t * (3 - 2 * t);

  G.assert = (cond, msg) => {
    if (!cond) throw new Error(msg || 'Assertion failed');
  };

  // ------------------------------
  // Fast pixel packing (Uint32 -> ImageData)
  // ------------------------------
  const LITTLE_ENDIAN = (() => {
    const u32 = new Uint32Array([0x0a0b0c0d]);
    const u8 = new Uint8Array(u32.buffer);
    return u8[0] === 0x0d;
  })();

  G.packRGBA = (r, g, b, a = 255) => {
    // ImageData is little-endian on almost all platforms, but we detect anyway.
    return LITTLE_ENDIAN
      ? (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0
      : (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | (a & 255)) >>> 0;
  };

  // ------------------------------
  // Deterministic time helpers
  // ------------------------------
  G._time = {
    acc: 0,
    last: performance.now(),
  };

  // Used by UI FPS counter
  G._fps = {
    value: 60,
    acc: 0,
    n: 0,
  };

  G.updateFps = (dt) => {
    const cur = 1 / dt;
    const f = G._fps;
    f.acc += cur;
    f.n++;
    if (f.n >= 12) {
      f.value = f.acc / f.n;
      f.acc = 0;
      f.n = 0;
    }
  };

  // ------------------------------
  // Quality helper
  // ------------------------------
  G.setQuality = (n) => {
    const V = (G.CONF && G.CONF.VISUALS) ? G.CONF.VISUALS : (G.CONF.VISUALS = {});
    const q = G.clamp(n | 0, 0, 2);
    V.quality = q;
    return q;
  };

  // A couple of constants used everywhere.
  G.W = C.WORLD_W;
  G.H = C.WORLD_H;

  // ------------------------------
  // Loading overlay helpers
  // ------------------------------
  const loadingEl = document.getElementById('loading');
  const loadingTextEl = document.getElementById('loading-text');
  const loadingBarEl = document.getElementById('loading-bar-inner');

  G.setLoading = (text, progress) => {
    if (!loadingEl) return;
    loadingEl.style.display = 'flex';
    loadingEl.classList.remove('hide');
    if (loadingTextEl && text) loadingTextEl.textContent = String(text);
    if (loadingBarEl && typeof progress === 'number') {
      const p = G.clamp(progress, 0, 1);
      loadingBarEl.style.width = Math.round(p * 100) + '%';
    }
  };

  G.finishLoading = () => {
    if (!loadingEl) return;
    loadingEl.classList.add('hide');
    setTimeout(() => {
      if (loadingEl.classList.contains('hide')) loadingEl.style.display = 'none';
    }, 400);
  };

  // ------------------------------
  // Fast index helpers
  // ------------------------------
  function isPow2(v){ return v > 0 && (v & (v - 1)) === 0; }

  // If WORLD_W is a power-of-two, we can replace divisions/modulo by bit ops.
  G._W_IS_POW2 = isPow2(G.W);
  G._W_MASK = G._W_IS_POW2 ? (G.W - 1) : 0;
  G._W_SHIFT = G._W_IS_POW2 ? (Math.log2(G.W) | 0) : -1;

  // Convert index -> (x,y) without allocations.
  // Returns an object from a tiny reusable pool if none provided.
  const _xyTmp = { x: 0, y: 0 };
  G.xyFromIndex = (i, out = _xyTmp) => {
    if (G._W_IS_POW2) {
      out.x = i & G._W_MASK;
      out.y = i >> G._W_SHIFT;
    } else {
      out.y = (i / G.W) | 0;
      out.x = i - out.y * G.W;
    }
    return out;
  };
})();
