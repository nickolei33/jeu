'use strict';
(() => {
  const G = (window.G = window.G || {});
  const { VIEW_W, VIEW_H } = G.CONF;

  // ------------------------------
  // UI state
  // ------------------------------
  G.UI = {
    showHUD: true,
    showHelp: false,
    showDebug: false,
    showGenDebug: false,
    showMenu: false,
  };

  const UI_FONT = 7;
  const PF_SP = 1;
  const UI_SLOT = 12;
  const UI_ICON = 10;

  function uiPanel(x, y, w, h, a = 0.22) {
    const ctx = G.ctx;
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x, y, 1, h);
    ctx.fillRect(x + w - 1, y, 1, h);
  }

  const PF_BASE = {
    'A': [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
    'B': [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
    'C': [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
    'D': [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
    'E': [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
    'F': [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
    'G': [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0e],
    'H': [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
    'I': [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
    'J': [0x07, 0x02, 0x02, 0x02, 0x12, 0x12, 0x0c],
    'K': [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
    'L': [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
    'M': [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
    'N': [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
    'O': [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
    'P': [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
    'Q': [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
    'R': [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
    'S': [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
    'T': [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
    'U': [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
    'V': [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
    'W': [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
    'X': [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
    'Y': [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
    'Z': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
    '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
    '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
    '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
    '3': [0x1e, 0x01, 0x01, 0x0e, 0x01, 0x01, 0x1e],
    '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
    '5': [0x1f, 0x10, 0x10, 0x1e, 0x01, 0x01, 0x1e],
    '6': [0x0e, 0x10, 0x10, 0x1e, 0x11, 0x11, 0x0e],
    '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
    '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
    '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x01, 0x0e],
    ' ': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
    '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
    ':': [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00],
    '/': [0x01, 0x02, 0x04, 0x08, 0x10, 0x00, 0x00],
    '-': [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
    '+': [0x00, 0x04, 0x04, 0x1f, 0x04, 0x04, 0x00],
    '?': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04],
    '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
    ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
    '[': [0x0e, 0x08, 0x08, 0x08, 0x08, 0x08, 0x0e],
    ']': [0x0e, 0x02, 0x02, 0x02, 0x02, 0x02, 0x0e],
    '#': [0x0a, 0x0a, 0x1f, 0x0a, 0x1f, 0x0a, 0x0a],
    '%': [0x19, 0x19, 0x02, 0x04, 0x08, 0x13, 0x13],
    '|': [0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
    '^': [0x04, 0x0a, 0x11, 0x00, 0x00, 0x00, 0x00],
    '=': [0x00, 0x1f, 0x00, 0x1f, 0x00, 0x00, 0x00],
    '_': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f],
    ',': [0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c, 0x08],
    "'": [0x04, 0x04, 0x08, 0x00, 0x00, 0x00, 0x00],
    '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
    '"': [0x0a, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00],
    ';': [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x08],
  };

  function buildSmallFont(base) {
    const colGroups = [[0], [1, 2], [3], [4]];
    const rowGroups = [[0], [1, 2], [3], [4], [5], [6]];
    const out = {};
    for (const key in base) {
      const rows = base[key] || [];
      const small = new Array(rowGroups.length).fill(0);
      for (let ry = 0; ry < rowGroups.length; ry++) {
        let rowBits = 0;
        for (let rx = 0; rx < colGroups.length; rx++) {
          let on = false;
          for (const sy of rowGroups[ry]) {
            const srcRow = rows[sy] | 0;
            for (const sx of colGroups[rx]) {
              if ((srcRow >> (4 - sx)) & 1) { on = true; break; }
            }
            if (on) break;
          }
          if (on) rowBits |= (1 << (colGroups.length - 1 - rx));
        }
        small[ry] = rowBits;
      }
      out[key] = small;
    }
    return out;
  }

  const USE_SMALL_FONT = true;
  const PF = USE_SMALL_FONT ? buildSmallFont(PF_BASE) : PF_BASE;
  const PF_W = USE_SMALL_FONT ? 4 : 5;
  const PF_H = USE_SMALL_FONT ? 6 : 7;
  const UI_LINE = PF_H;

  function normalizeText(s) {
    return String(s)
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\u2191/g, '^')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
  }

  function uiTextWidth(s) {
    const text = normalizeText(s);
    let w = 0;
    let maxW = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\n') {
        if (w > maxW) maxW = w;
        w = 0;
        continue;
      }
      w += PF_W + PF_SP;
    }
    if (w > 0) w -= PF_SP;
    return Math.max(maxW, w);
  }

  function uiTextTrim(s, maxW) {
    const text = normalizeText(s);
    if (uiTextWidth(text) <= maxW) return text;
    const ell = '...';
    const ellW = (PF_W + PF_SP) * ell.length - PF_SP;
    let w = 0;
    let out = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\n') break;
      const nextW = w + PF_W + PF_SP;
      if (nextW > maxW - ellW) break;
      out += ch;
      w = nextW;
    }
    return out + ell;
  }

  function uiText(s, x, y, a = 0.90) {
    const ctx = G.ctx;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    const text = normalizeText(s);
    let cx = (x | 0);
    const cy = (y | 0);
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\n') {
        cx = (x | 0);
        continue;
      }
      const rows = PF[ch] || PF['?'];
      for (let ry = 0; ry < PF_H; ry++) {
        const row = rows[ry] | 0;
        for (let rx = 0; rx < PF_W; rx++) {
          if ((row >> (PF_W - 1 - rx)) & 1) {
            ctx.fillRect(cx + rx, cy + ry, 1, 1);
          }
        }
      }
      cx += PF_W + PF_SP;
    }
  }

  function uiBar(x, y, w, h, frac, c2) {
    const ctx = G.ctx;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = c2;
    ctx.fillRect(x, y, (w * G.clamp(frac, 0, 1)) | 0, h);
  }

  // ------------------------------
  // Icon helpers
  // ------------------------------
  function createIcon(size, drawFn) {
    const ic = document.createElement('canvas');
    ic.width = size;
    ic.height = size;
    const g = ic.getContext('2d');
    g.imageSmoothingEnabled = false;
    drawFn(g, size);
    return ic;
  }

  function iconFrame(g, s) {
    g.clearRect(0, 0, s, s);
  }

  const wandIcons = [
    // Dig
    createIcon(UI_ICON, (g) => {
      iconFrame(g, UI_ICON);
      g.fillStyle = '#1b1b22'; g.fillRect(1, 1, UI_ICON - 2, UI_ICON - 2);
      g.fillStyle = '#cdd3dd'; g.fillRect(3, 4, UI_ICON - 6, 2);
      g.fillStyle = '#8aa0b8'; g.fillRect(4, 6, UI_ICON - 8, 1);
      g.fillStyle = '#b57b3e'; g.fillRect((UI_ICON >> 1), 6, 1, UI_ICON - 5);
    }),
    // Fire
    createIcon(UI_ICON, (g) => {
      iconFrame(g, UI_ICON);
      g.fillStyle = '#1b1b22'; g.fillRect(1, 1, UI_ICON - 2, UI_ICON - 2);
      g.fillStyle = '#ffb13b'; g.fillRect(5, 2, 2, 2);
      g.fillStyle = '#ff7a2b'; g.fillRect(4, 4, 4, 4);
      g.fillStyle = '#d94a2a'; g.fillRect(5, 7, 2, 3);
    }),
    // Water
    createIcon(UI_ICON, (g) => {
      iconFrame(g, UI_ICON);
      g.fillStyle = '#1b1b22'; g.fillRect(1, 1, UI_ICON - 2, UI_ICON - 2);
      g.fillStyle = '#3d6fe0'; g.fillRect(4, 3, 4, 6);
      g.fillStyle = '#bcd2ff'; g.fillRect(5, 4, 1, 5);
    }),
    // Oil
    createIcon(UI_ICON, (g) => {
      iconFrame(g, UI_ICON);
      g.fillStyle = '#1b1b22'; g.fillRect(1, 1, UI_ICON - 2, UI_ICON - 2);
      g.fillStyle = '#7a4e23'; g.fillRect(4, 4, 4, 6);
      g.fillStyle = '#b57b3e'; g.fillRect(5, 4, 1, 6);
      g.fillStyle = '#7b59b3'; g.fillRect(8, 6, 1, 1);
    }),
    // Bomb
    createIcon(UI_ICON, (g) => {
      iconFrame(g, UI_ICON);
      g.fillStyle = '#1b1b22'; g.fillRect(1, 1, UI_ICON - 2, UI_ICON - 2);
      g.fillStyle = '#111116'; g.fillRect(4, 5, 4, 4);
      g.fillStyle = '#ffb13b'; g.fillRect(8, 1, 2, 2);
    }),
    // Acid
    createIcon(UI_ICON, (g) => {
      iconFrame(g, UI_ICON);
      g.fillStyle = '#1b1b22'; g.fillRect(1, 1, UI_ICON - 2, UI_ICON - 2);
      g.fillStyle = '#2a8f3a'; g.fillRect(3, 5, 6, 5);
      g.fillStyle = '#4cff6a'; g.fillRect(4, 5, 2, 5);
      g.fillStyle = '#b8ffcb'; g.fillRect(7, 6, 1, 3);
    }),
    // Freeze
    createIcon(UI_ICON, (g) => {
      iconFrame(g, UI_ICON);
      g.fillStyle = '#1b1b22'; g.fillRect(1, 1, UI_ICON - 2, UI_ICON - 2);
      g.fillStyle = '#bcd2ff'; g.fillRect(4, 3, 4, 6);
      g.fillStyle = '#ffffff'; g.fillRect(6, 4, 1, 4);
    }),
  ];

  function buildBrushIcons() {
    const MAT = G.MAT;
    return (G.BRUSHES || []).map((b) =>
      createIcon(UI_ICON, (g) => {
        iconFrame(g, UI_ICON);
        g.fillStyle = '#15151c'; g.fillRect(0, 0, UI_ICON, UI_ICON);

        function px(x, y, c) { g.fillStyle = c; g.fillRect(x, y, 1, 1); }

        if (b.mat === MAT.ROCK) { g.fillStyle = '#2b2b31'; g.fillRect(2, 3, 6, 5); g.fillStyle = '#42424d'; g.fillRect(3, 4, 4, 3); }
        else if (b.mat === MAT.DIRT) { g.fillStyle = '#6b4a2c'; g.fillRect(2, 4, 6, 4); g.fillStyle = '#8a6138'; g.fillRect(3, 4, 2, 4); }
        else if (b.mat === MAT.SAND) { g.fillStyle = '#c2ac5c'; g.fillRect(2, 5, 6, 3); g.fillStyle = '#d7c47a'; g.fillRect(4, 4, 2, 1); }
        else if (b.mat === MAT.SNOW) { g.fillStyle = '#eaf6ff'; g.fillRect(2, 5, 6, 3); g.fillStyle = '#bcd2ff'; g.fillRect(3, 5, 2, 3); }
        else if (b.mat === MAT.ICE) { g.fillStyle = '#bcd2ff'; g.fillRect(2, 3, 6, 5); g.fillStyle = '#d7f0ff'; g.fillRect(3, 4, 2, 3); }
        else if (b.mat === MAT.WOOD) { g.fillStyle = '#82552d'; g.fillRect(2, 3, 6, 5); g.fillStyle = '#a6713e'; g.fillRect(3, 4, 4, 1); }
        else if (b.mat === MAT.WATER) { g.fillStyle = '#3d6fe0'; g.fillRect(2, 5, 6, 3); g.fillStyle = '#bcd2ff'; g.fillRect(3, 5, 2, 3); }
        else if (b.mat === MAT.OIL) { g.fillStyle = '#7a4e23'; g.fillRect(2, 5, 6, 3); g.fillStyle = '#b57b3e'; g.fillRect(3, 5, 2, 3); px(6, 6, '#7b59b3'); }
        else if (b.mat === MAT.ACID) { g.fillStyle = '#2a8f3a'; g.fillRect(2, 5, 6, 3); g.fillStyle = '#4cff6a'; g.fillRect(3, 5, 2, 3); px(7, 6, '#b8ffcb'); }
        else if (b.mat === MAT.LAVA) { g.fillStyle = '#b63a2b'; g.fillRect(2, 5, 6, 3); g.fillStyle = '#ff7a2b'; g.fillRect(3, 5, 2, 3); px(7, 6, '#ffb13b'); }
        else if (b.mat === MAT.FIRE) { g.fillStyle = '#d94a2a'; g.fillRect(2, 5, 6, 3); g.fillStyle = '#ffb13b'; g.fillRect(4, 4, 2, 2); }
        else if (b.mat === MAT.STEAM) { g.fillStyle = '#bdbdd0'; g.fillRect(2, 5, 6, 3); g.fillStyle = '#ffffff'; g.fillRect(4, 4, 2, 1); }
        else { g.fillStyle = '#d0d0d0'; g.fillRect(3, 3, 4, 4); g.fillStyle = '#0b0b0b'; g.fillRect(3, 4, 4, 1); g.fillRect(3, 6, 4, 1); }
      }),
    );
  }

  // created lazily (after brush init)
  let brushIcons = null;

  // ------------------------------
  // Render HUD
  // ------------------------------
  function renderHUD() {
    if (!G.UI.showHUD) return;
    const ctx = G.ctx;
    const p = G.player;

    if (!brushIcons) brushIcons = buildBrushIcons();

    // Top-left HP/MP
    const x0 = 4, y0 = 4;
    const hudW = 110;
    const hudH = UI_LINE * 2 + 4;
    uiPanel(x0, y0, hudW, hudH, 0.18);
    const hpY = y0 + 2;
    uiText('HP', x0 + 4, hpY, 0.75);
    uiBar(x0 + 16, hpY + 2, hudW - 20, 2, p.hp / p.hpMax, 'rgba(255,95,95,0.85)');
    const mpY = hpY + UI_LINE;
    uiText('MP', x0 + 4, mpY, 0.75);
    uiBar(x0 + 16, mpY + 2, hudW - 20, 2, p.mana / p.manaMax, 'rgba(120,210,255,0.85)');

    // Status icons (gap between top-left and top-right panels)
    // Communicate systemic effects (wet/oil/burn/cold/acid) in a readable way.
    if (p && p.status) {
      const s = p.status;
      const icons = [
        { key: 'wet', col: 'rgba(90,160,255,0.85)', label: 'W' },
        { key: 'oily', col: 'rgba(200,150,80,0.85)', label: 'O' },
        { key: 'corrosive', col: 'rgba(90,255,120,0.85)', label: 'A' },
        { key: 'burning', col: 'rgba(255,120,60,0.90)', label: 'F' },
        { key: 'frozen', col: 'rgba(200,235,255,0.85)', label: 'C' },
      ];
      let sx = x0 + 128 + 6;
      const sy = y0 + 4;
      for (const ic of icons) {
        const t = s[ic.key] || 0;
        if (t > 0) {
          ctx.globalAlpha = Math.min(1, t / 0.6);
          uiPanel(sx, sy, 10, 10, 0.22);
          ctx.fillStyle = ic.col;
          ctx.fillRect(sx + 2, sy + 2, 6, 6);
          ctx.globalAlpha = 1;
        }
        sx += 12;
      }
    }

    // Top-right brush info
    const bx = VIEW_W - (hudW + 4), by = 4;
    uiPanel(bx, by, hudW, hudH, 0.18);
    if (brushIcons[G.brushIndex]) ctx.drawImage(brushIcons[G.brushIndex], bx + 3, by + 3, UI_ICON, UI_ICON);
    const brushName = uiTextTrim(`${G.BRUSHES[G.brushIndex].name}`, hudW - 20);
    uiText(brushName, bx + 16, by + 2, 0.82);
    uiText(`R=${G.paintRadius}`, bx + 16, by + 2 + UI_LINE, 0.65);

    // Message log (top, under the bars)
    // Helps communicate systems and make deaths feel fair.
    let logH = 0;
    if (G.logLines && G.logLines.length) {
      const x = 4;
      const y = 24;
      const w = VIEW_W - 8;
      const lines = G.logLines;
      logH = lines.length * UI_LINE + 3;
      uiPanel(x, y, w, logH, 0.14);
      for (let i = 0; i < lines.length; i++) {
        const L = lines[i];
        const a = (L.t0 > 0) ? G.clamp(L.ttl / L.t0, 0, 1) : 1;
        ctx.globalAlpha = 0.55 + 0.45 * a;
        const line = uiTextTrim(L.text, w - 6);
        uiText(line, x + 3, y + 2 + i * UI_LINE, 0.78);
        ctx.globalAlpha = 1;
      }
    }

    // Bottom hotbar
    const slots = G.WANDS.length;
    const barW = slots * UI_SLOT + 6;
    const hx = ((VIEW_W - barW) / 2) | 0;
    const hy = VIEW_H - (UI_SLOT + 4);
    uiPanel(hx, hy, barW, UI_SLOT + 2, 0.20);

    for (let i = 0; i < slots; i++) {
      const x = hx + 4 + i * UI_SLOT;
      const y = hy + 1;
      const sel = (i === G.currentWand);

      ctx.fillStyle = sel ? 'rgba(255,255,255,0.70)' : 'rgba(255,255,255,0.16)';
      ctx.fillRect(x, y, UI_SLOT, 1);
      ctx.fillRect(x, y + UI_SLOT - 1, UI_SLOT, 1);
      ctx.fillRect(x, y, 1, UI_SLOT);
      ctx.fillRect(x + UI_SLOT - 1, y, 1, UI_SLOT);

      if (wandIcons[i]) ctx.drawImage(wandIcons[i], x + ((UI_SLOT - UI_ICON) / 2) | 0, y + ((UI_SLOT - UI_ICON) / 2) | 0, UI_ICON, UI_ICON);

      if (sel) {
        const cd = G.WANDS[i].cooldown;
        const t = G.clamp(G.castTimer / cd, 0, 1);
        if (t > 0) {
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(x + 1, y + 1 + ((UI_SLOT - 2) * t) | 0, UI_SLOT - 2, (UI_SLOT - 2) - ((UI_SLOT - 2) * t) | 0);
        }
      }
    }

    // Selected wand label
    uiPanel(4, VIEW_H - 22, 150, 14, 0.16);
    uiText(`W${G.currentWand + 1} ${G.WANDS[G.currentWand].name}  cost:${G.WANDS[G.currentWand].cost}`, 8, VIEW_H - 12, 0.80);

    if (G.UI.showDebug) {
      const mx = G.mouse?.worldX | 0;
      const my = G.mouse?.worldY | 0;
      const px = p.x | 0;
      const py = p.y | 0;

      const inb = (x, y) => x >= 0 && x < G.W && y >= 0 && y < G.H;
      const mi = inb(mx, my) ? G.idx(mx, my) : -1;
      const pi = inb(px, py) ? G.idx(px, py) : -1;

      const tMouse = mi >= 0 ? G.temp[mi] : 0;
      const tPlayer = pi >= 0 ? G.temp[pi] : 0;

      const mMouse = mi >= 0 ? G.mat[mi] : 0;
      const mPlayer = pi >= 0 ? G.mat[pi] : 0;

      // If log is visible, push debug panel down so it doesn't overlap.
      const yDbg = 24 + (logH ? (logH + 4) : 0);
      uiPanel(4, yDbg, 220, 90, 0.18);
      uiText(`seed ${G.seed | 0}`, 8, yDbg + 10, 0.65);
      const q = (G.CONF?.VISUALS?.quality | 0);
      uiText(`quality ${q===0?'LOW':(q===1?'MED':'HIGH')}`, 8, yDbg + 18, 0.65);
      uiText(`fps ${(G._fps?.value | 0) || 0}`, 8, yDbg + 26, 0.65);
      uiText(`pos ${(px)},${(py)}`, 8, yDbg + 34, 0.65);
      uiText(`T@player ${tPlayer}°C  mat ${G.matName?.[mPlayer] || mPlayer}`, 8, yDbg + 42, 0.65);
      uiText(`T@mouse  ${tMouse}°C  mat ${G.matName?.[mMouse] || mMouse}`, 8, yDbg + 50, 0.65);

      // Chunk debug
      if (G.CHUNK && inb(mx, my)) {
        const ci = G.chunkIndexXY(mx, my);
        uiText(`chunk ${ci} ttl ${G.chunkTTL[ci] | 0} always ${G.chunkAlways[ci] | 0}`, 8, yDbg + 58, 0.65);
      }

      // Worldgen validation summary (macro traversal)
      const vg = G.levelGenDebug?.validation;
      if (vg) {
        uiText(
          `worldgen ${vg.ok ? 'OK' : 'FAIL'}  tries ${vg.tries | 0}  path ${vg.pathLen | 0}`,
          8,
          yDbg + 66,
          0.65,
        );
      }
    }
  }

  function renderHelp() {
    if (!G.UI.showHelp) return;

    const lines = [
      'ZQSD / WASD / Arrows : bouger',
      'Shift : courir (maintenir)',
      'Verr Maj : sprint toggle',
      'Espace / Z / W / UP : sauter (ou nager)',
      'Saut double : appuie encore en l\'air',
      'Clic gauche : tirer un sort (wand)',
      'Clic droit : peindre (brush)',
      'Molette : rayon | Shift+Molette : brush',
      'E / Shift+E : brush suivant/précédent',
      '[ / ] : rayon -/+',
      '1..7 : wands | Tab / Shift+Tab : wand suivant/précédent',
      'R : regen monde (même seed) | N : seed suivante | Shift+R : seed aléatoire',
      'M : menu rapide',
      'P/Echap : pause | H : HUD | T : aide (maintenir) | F1 : debug HUD | F2 : debug worldgen | F3 : qualité | G : postFX',
    ];

    const x = 4;
    const y = VIEW_H - (lines.length * 10 + 10);
    const maxLineW = lines.reduce((m, s) => Math.max(m, uiTextWidth(s)), 0);
    const w = Math.min(VIEW_W - 8, maxLineW + 10);
    const h = lines.length * UI_LINE + 4;
    uiPanel(x, y, w, h, 0.16);
    for (let i = 0; i < lines.length; i++) {
      const line = uiTextTrim(lines[i], w - 6);
      uiText(line, x + 4, y + 2 + i * UI_LINE, 0.74);
    }
  }

  G.renderHUD = renderHUD;
  G.renderHelp = renderHelp;

  function renderMenu() {
    if (!G.UI.showMenu) return;

    const V = (G.CONF && G.CONF.VISUALS) ? G.CONF.VISUALS : { quality: 0 };
    const q = (V.quality | 0) || 0;
    const qLabel = q === 0 ? 'LOW' : (q === 1 ? 'MED' : 'HIGH');

    const cycleQuality = () => {
      const nxt = (q + 1) % 3;
      const nq = G.setQuality ? G.setQuality(nxt) : nxt;
      if (G.log) G.log(nq === 0 ? 'QUALITY LOW' : (nq === 1 ? 'QUALITY MED' : 'QUALITY HIGH'));
    };

    const toggleHUD = () => { G.UI.showHUD = !G.UI.showHUD; if (G.log) G.log(G.UI.showHUD ? 'HUD ON' : 'HUD OFF'); };
    const toggleHelp = () => { G.UI.showHelp = !G.UI.showHelp; if (G.log) G.log(G.UI.showHelp ? 'HELP ON' : 'HELP OFF'); };
    const togglePostFX = () => { G.postFX = !G.postFX; if (G.log) G.log(G.postFX ? 'POSTFX ON' : 'POSTFX OFF'); };
    const togglePause = () => { G.paused = !G.paused; if (G.log) G.log(G.paused ? 'PAUSED' : 'RESUMED'); };
    const nextSeed = () => { if (G.nextSeed) G.nextSeed(); else if (G.resetWorldWithSeed) G.resetWorldWithSeed(((G.seed | 0) + 1) | 0); if (G.log) G.log('NEXT SEED'); };
    const regenSeed = () => { if (G.regenWorld) G.regenWorld(); else if (G.resetWorldWithSeed) G.resetWorldWithSeed(G.seed | 0); if (G.log) G.log('WORLD REGEN'); };
    const randomSeed = () => { if (G.resetWorld) G.resetWorld(); if (G.log) G.log('WORLD RESET'); };

    const sprintOn = (G.input && G.input.sprintToggle) ? 'ON' : 'OFF';
    const lines = [
      { text: `Qualité : ${qLabel}  (1/2/3)`, action: cycleQuality },
      { text: `HUD : ${G.UI.showHUD ? 'ON' : 'OFF'}  (H)`, action: toggleHUD },
      { text: `Aide : ${G.UI.showHelp ? 'ON' : 'OFF'}  (T)`, action: toggleHelp },
      { text: `PostFX : ${G.postFX ? 'ON' : 'OFF'}  (G)`, action: togglePostFX },
      { text: `Sprint toggle : ${sprintOn}  (Verr Maj)` },
      { text: `Pause : ${G.paused ? 'ON' : 'OFF'}  (P)`, action: togglePause },
      { text: `Seed : ${G.seed | 0}  (click = next)`, action: nextSeed },
      { text: 'Regen seed (R)', action: regenSeed },
      { text: 'Random seed (Shift+R)', action: randomSeed },
      { text: 'Fermer : M' },
    ];

    const maxLineW = lines.reduce((m, l) => Math.max(m, uiTextWidth(l.text)), 0);
    const w = Math.min(VIEW_W - 8, maxLineW + 12);
    const h = lines.length * UI_LINE + 12;
    const x = ((VIEW_W - w) / 2) | 0;
    const y = ((VIEW_H - h) / 2) | 0;

    uiPanel(x, y, w, h, 0.24);
    uiText('MENU', x + 6, y + 2, 0.9);
    const items = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lx = x + 6;
      const ly = y + 12 + i * UI_LINE;
      const a = line.action ? 0.88 : 0.78;
      const text = uiTextTrim(line.text, w - 10);
      uiText(text, lx, ly, a);
      if (line.action) {
        items.push({
          x: x + 4,
          y: ly,
          w: w - 8,
          h: UI_LINE,
          action: line.action,
        });
      }
    }
    G._menuItems = items;
  }

  G.menuClick = (sx, sy) => {
    if (!G.UI.showMenu || !G._menuItems) return false;
    for (const it of G._menuItems) {
      if (sx >= it.x && sx < it.x + it.w && sy >= it.y && sy < it.y + it.h) {
        if (it.action) it.action();
        return true;
      }
    }
    return false;
  };

  G.renderMenu = renderMenu;
})();
