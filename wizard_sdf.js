'use strict';
(() => {
  const G = (window.G = window.G || {});

  // =========================================================
  // WIZARD SDF RENDERER V16 - ULTIMATE POLISH (AAA DETAILS)
  // =========================================================
  // - Walk Cycle integration.
  // - Rim Lighting for volume.
  // - Accessories: Belt Buckle, Potion.
  // - Alive: Blinking, Beard Physics.
  // - Magic Trail.
  // =========================================================

  const WIZ_W = 96;
  const WIZ_H = 96;
  const PIVOT = { x: 48, y: 92 };
  const SCALE = 0.5;

  const off = document.createElement('canvas');
  off.width = WIZ_W;
  off.height = WIZ_H;
  const offCtx = off.getContext('2d', { willReadFrequently: false });
  offCtx.imageSmoothingEnabled = false;

  let img = offCtx.getImageData(0, 0, WIZ_W, WIZ_H);
  let pix = new Uint32Array(img.data.buffer);

  // PALETTE
  const COL = {
    robeDark: 0xff4a1570,
    robeMid: 0xff6a2590,
    robeLit: 0xff8a45b0,
    goldDark: 0xffb07010,
    goldLit: 0xfffac020,
    boots: 0xff4a2510,
    belt: 0xff5a3015,
    skin: 0xffe0c0a0,
    beard: 0xffe0e0e8,
    wood: 0xff5a4030,
    orb: 0xffd020a0,
    orbGlow: 0xffff40d0,
    outline: 0xff100515,

    // New
    potion: 0xff4040e0, // Blue potion
    potionCork: 0xff806040,
    rim: 0x40ffffff, // Rim Light Overlay

    dust: 0xffa0a090,
    speedLine: 0x88ffffff,
    sparkle: 0xff20ff60,
    trail: 0x66ff20a0 // Trail color
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smin(a, b, k) {
    const h = Math.max(k - Math.abs(a - b), 0.0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  }
  function lerpAngle(a, b, t) {
    const da = (b - a) % 360;
    const dist = (2 * da) % 360 - da;
    return a + dist * t;
  }
  function sdCircle(px, py, cx, cy, r) { return Math.hypot(px - cx, py - cy) - r; }
  function sdBox(px, py, cx, cy, w, h) {
    const dx = Math.abs(px - cx) - w;
    const dy = Math.abs(py - cy) - h;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0.0);
  }
  function sdSegment(px, py, ax, ay, bx, by) {
    const paX = px - ax, paY = py - ay, baX = bx - ax, baY = by - ay;
    const h = clamp((paX * baX + paY * baY) / (baX * baX + baY * baY + 1e-6), 0, 1);
    return Math.hypot(paX - baX * h, paY - baY * h);
  }

  function sdCurve3(px, py, p1, p2, p3) {
    return Math.min(
      sdSegment(px, py, p1.x, p1.y, p2.x, p2.y),
      sdSegment(px, py, p2.x, p2.y, p3.x, p3.y)
    );
  }

  // TRAIL SYSTEM
  class TrailNode {
    constructor(x, y) { this.x = x; this.y = y; this.life = 1.0; }
  }

  class Particle {
    constructor(x, y, vx, vy, life, color, grav = 0, size = 1) {
      this.x = x; this.y = y;
      this.vx = vx; this.vy = vy;
      this.life = life; this.maxLife = life;
      this.color = color;
      this.grav = grav;
      this.size = size;
    }
    update(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vy += this.grav * dt;
      this.life -= dt;
      return this.life > 0;
    }
  }

  // PARTICLE SYSTEM REMOVED FROM HERE - MOVED TO GLOBAL
  const trail = []; // Keep trail for now or remove? Trail is also local.
  // Actually, trail should also be global if we want it to stay in world space.
  // For now, let's just focus on the dust as requested.


  const wizard = {
    state: 'idle', facing: 1,
    time: { idle: 0, run: 0, walk: 0, jump: 0, fall: 0 },
    pose: null,
    scale: { x: 1, y: 1 },

    // Cape Verlet State (local space relative to anchor? No, safer to track "local offset" space)
    // Cape: World Space Nodes (initialized in update if empty)
    cape: {
      nodes: [], // Array of {x, y, oldX, oldY} in World Space
      initialized: false
    },
    beard: { ang: 0, vel: 0 },
    staff: { ang: 0, vel: 0 },
    blink: 0, // 0 = open, 1 = closed
    blinkTimer: 0,
    visualY: 0
  };
  G.wizard = wizard;

  function solveLimb(start, baseAngle, l1, l2, a1, a2) {
    const RAD = Math.PI / 180;
    const u = (baseAngle + a1) * RAD;
    const mid = { x: start.x + Math.cos(u) * l1, y: start.y + Math.sin(u) * l1 };
    const l = u + a2 * RAD;
    const end = { x: mid.x + Math.cos(l) * l2, y: mid.y + Math.sin(l) * l2 };
    return { mid, end };
  }

  // 2-bone IK solver for our limb representation.
  function solveLimbIK(start, baseAngleDeg, l1, l2, targetX, targetY, prevUpDeg = 0, prevLoDeg = 0) {
    const dx = targetX - start.x;
    const dy = targetY - start.y;
    let d = Math.hypot(dx, dy);

    // Clamp to reachable range (avoid NaN from acos)
    const minD = Math.abs(l1 - l2) + 1e-4;
    const maxD = (l1 + l2) - 1e-4;
    d = clamp(d, minD, maxD);

    const ang = Math.atan2(dy, dx); // absolute direction to target

    // Elbow angle (relative), 0 = fully extended
    let cos2 = (d * d - l1 * l1 - l2 * l2) / (2 * l1 * l2);
    cos2 = clamp(cos2, -1, 1);
    const theta2 = Math.acos(cos2); // 0..pi

    // Helper: minimal absolute angular distance in degrees
    const absAngDist = (a, b) => Math.abs(((b - a) % 360 + 540) % 360 - 180);

    // Two possible solutions (elbow "up" vs "down")
    // Solution A: +sin
    const k1 = l1 + l2 * Math.cos(theta2);
    const k2A = l2 * Math.sin(theta2);
    const theta1A = ang - Math.atan2(k2A, k1);
    const upA = (theta1A * 180 / Math.PI) - baseAngleDeg;
    const loA = (theta2 * 180 / Math.PI);

    // Solution B: -sin (mirror)
    const k2B = -k2A;
    const theta1B = ang - Math.atan2(k2B, k1);
    const upB = (theta1B * 180 / Math.PI) - baseAngleDeg;
    const loB = -(theta2 * 180 / Math.PI);

    // Pick closer to previous angles (prevents elbow flipping)
    const costA = absAngDist(prevUpDeg, upA) + absAngDist(prevLoDeg, loA);
    const costB = absAngDist(prevUpDeg, upB) + absAngDist(prevLoDeg, loB);

    const up = (costA <= costB) ? upA : upB;
    const lo = (costA <= costB) ? loA : loB;

    const limb = solveLimb(start, baseAngleDeg, l1, l2, up, lo);
    return { up, lo, mid: limb.mid, end: limb.end };
  }

  function renderWizard(pose) {
    if (!pose) return;
    const B = pose.bones || {};
    const root = pose.root || { x: 0, y: 0 };

    const rx = root.x, ry = root.y - 25;
    const facing = wizard.facing;

    const spineRad = (B.spine || 0) * Math.PI / 180;
    const chest = { x: rx + Math.sin(spineRad) * 10, y: ry - Math.cos(spineRad) * 10 };
    const neckRad = spineRad + (B.neck || 0) * Math.PI / 180;
    const head = { x: chest.x + Math.sin(neckRad) * 6, y: chest.y - Math.cos(neckRad) * 6 };

    const legL = solveLimb({ x: rx - 4, y: ry + 4 }, 90, 8, 8, B.legL_up || 0, B.legL_lo || 0);
    const legR = solveLimb({ x: rx + 4, y: ry + 4 }, 90, 8, 8, B.legR_up || 0, B.legR_lo || 0);
    const armL = solveLimb({ x: chest.x - 6, y: chest.y - 2 }, 110, 8, 7, B.armL_up || 0, B.armL_lo || 0);
    const armR = solveLimb({ x: chest.x + 6, y: chest.y - 2 }, 70, 8, 7, B.armR_up || 0, B.armR_lo || 0);

    const staffAngle = (70 + (B.armR_up || 0) + (B.armR_lo || 0) + (B.staff || 0)) * Math.PI / 180;
    const staffBot = { x: armR.end.x - Math.cos(staffAngle) * 10, y: armR.end.y - Math.sin(staffAngle) * 10 };
    const staffTop = { x: armR.end.x + Math.cos(staffAngle) * 20, y: armR.end.y + Math.sin(staffAngle) * 20 };

    // Record Trail
    if (Math.random() < 0.5) trail.push(new TrailNode(staffTop.x * facing, staffTop.y));
    // Note: Trail needs World Space. This is Local Render Space.
    // Correction: We render trail in screen space usually, but here everything is baked to canvas.
    // For baked, we can only trail relative to wizard. That looks okay for local motion.

    const capeAnchor = { x: chest.x - 6, y: chest.y };
    // Old cape points removed (moved to World Space Nodes)

    // Draw Cape Mesh (Behind Body)
    // Clear canvas first
    offCtx.fillStyle = '#00000000';
    offCtx.clearRect(0, 0, WIZ_W, WIZ_H);


    // Draw Cape (Behind Body)
    // We draw the cape first into the offscreen buffer, then the SDF body overwrites it.
    if (wizard.capeSim && wizard.capeSim.points && wizard.capeSim.points.length > 1) {
      const player = G.player || { x: 0, y: 0 };
      const pts = wizard.capeSim.points;

      // Convert WORLD -> wizard offscreen coords (pixel-perfect)
      const project = (pWorld) => {
        const dx = (pWorld.x - player.x) * facing;
        const dy = (pWorld.y - player.y);
        return { x: Math.round(PIVOT.x + dx), y: Math.round(PIVOT.y + dy) };
      };

      const hex = (u32) => '#' + (u32 & 0xFFFFFF).toString(16).padStart(6, '0');
      const cDark = hex(COL.robeDark);
      const cMid  = hex(COL.robeMid);
      const cLit  = hex(COL.robeLit);

      // Back direction sign (for consistent normals)
      // Use actual facing for stable cape normals (avoids 1-2 frame "twist" artifacts on rapid turns).
      const backDir = -facing;
      const bSign = (backDir >= 0) ? 1 : -1;

      const backEdge = new Array(pts.length);
      const frontEdge = new Array(pts.length);

      for (let i = 0; i < pts.length; i++) {
        const P = pts[i];
        const P0 = pts[Math.max(0, i - 1)];
        const P1 = pts[Math.min(pts.length - 1, i + 1)];

        // Tangent
        let tx = P1.x - P0.x;
        let ty = P1.y - P0.y;
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;

        // Normal (perp)
        let nx = -ty;
        let ny = tx;

        // Ensure the normal points towards the "back" side of the character.
        // Back vector is roughly (bSign, 0).
        if (nx * bSign < 0) { nx = -nx; ny = -ny; }

        const tV = (pts.length <= 1) ? 0 : (i / (pts.length - 1));
        let wBack = lerp(wizard.capeSim.wTop, wizard.capeSim.wBot, tV);
        let wFront = wBack * 0.28; // small thickness on "front" side

        // Taper near the attachment to avoid a sharp "corner" fold at the top.
        const taper = 0.65 + 0.35 * tV; // 0.65 at root -> 1.0 at tail
        wBack *= taper;
        wFront *= taper;

        backEdge[i]  = { x: P.x + nx * wBack,  y: P.y + ny * wBack };
        frontEdge[i] = { x: P.x - nx * wFront, y: P.y - ny * wFront };
      }

      // Draw as a chain of quads (pixel-friendly)
      for (let i = 0; i < pts.length - 1; i++) {
        const b0 = project(backEdge[i]);
        const b1 = project(backEdge[i + 1]);
        const f1 = project(frontEdge[i + 1]);
        const f0 = project(frontEdge[i]);

        // Curvature-based shading
        const dx0 = pts[i + 1].x - pts[i].x;
        const dy0 = pts[i + 1].y - pts[i].y;
        const dx1 = (i < pts.length - 2) ? (pts[i + 2].x - pts[i + 1].x) : dx0;
        const dy1 = (i < pts.length - 2) ? (pts[i + 2].y - pts[i + 1].y) : dy0;
        const l0 = Math.hypot(dx0, dy0) || 1;
        const l1 = Math.hypot(dx1, dy1) || 1;
        const t0x = dx0 / l0, t0y = dy0 / l0;
        const t1x = dx1 / l1, t1y = dy1 / l1;
        const bend = Math.abs(t0x * t1y - t0y * t1x); // 0..1

        const tSeg = (pts.length <= 2) ? 0 : (i / (pts.length - 2));
        let shade = 0.56 - 0.22 * tSeg + 0.30 * bend;
        if (((i + (G.frameId || 0)) % 5) === 0) shade += 0.05; // subtle fold hint

        let col = cDark;
        if (shade > 0.73) col = cLit;
        else if (shade > 0.50) col = cMid;

        offCtx.fillStyle = col;
        offCtx.beginPath();
        offCtx.moveTo(b0.x, b0.y);
        offCtx.lineTo(b1.x, b1.y);
        offCtx.lineTo(f1.x, f1.y);
        offCtx.lineTo(f0.x, f0.y);
        offCtx.closePath();
        offCtx.fill();
      }

      // Back edge highlight
      offCtx.strokeStyle = cLit;
      offCtx.beginPath();
      const s0 = project(backEdge[0]);
      offCtx.moveTo(s0.x, s0.y);
      for (let i = 1; i < backEdge.length; i++) {
        const pp = project(backEdge[i]);
        offCtx.lineTo(pp.x, pp.y);
      }
      offCtx.stroke();
    }
    // Sync Buffer for SDF Loop
    img = offCtx.getImageData(0, 0, WIZ_W, WIZ_H);
    pix = new Uint32Array(img.data.buffer);

    // pix.fill(0); // REMOVED to show Cape.
    // But pix is aliased to img.data.
    // If we fill(0), we erase what we just drew.
    // So DO NOT fill(0).
    // But we need to clear where the body will be?
    // SDF logic writes to `pix` if `col !== 0`.
    // If SDF writes, it overwrites cape. (Good, Body in front).
    // If SDF doesn't write (empty space), Cape remains. (Good).
    // But we need to clear "previous frame garbage" which we did with clearRect.
    // So removing `pix.fill(0)` is correct IF clearRect cleared the buffer.
    // `getImageData` captures the cleared + cape state.
    // So `pix` contains Cape + Transparent.
    // Perfect.

    // Light Source roughly top-left (-1, -1) from facing perspective

    for (let y = 0; y < WIZ_H; y++) {
      for (let x = 0; x < WIZ_W; x++) {
        // Skip if pixel is already filled by cape? No, Body must overwrite.

        const lx = (x - PIVOT.x) / SCALE;
        const ly = (y - PIVOT.y) / SCALE;
        let col = 0;

        // ... SDF Logic Follows ...
        // Remove Old Cape SDF Block


        // STAFF
        const dStaff = sdSegment(lx, ly, staffBot.x, staffBot.y, staffTop.x, staffTop.y) - 2.0;
        if (dStaff < 0) col = COL.wood;

        // LEGS & BOOTS
        const dLegL = sdSegment(lx, ly, rx - 4, ry + 4, legL.mid.x, legL.mid.y) - 3.5;
        const dBooL = sdBox(lx, ly, legL.end.x, legL.end.y, 3, 3);
        if (dLegL < 0) col = COL.robeDark;
        if (dBooL < 0) col = COL.boots;

        const dLegR = sdSegment(lx, ly, rx + 4, ry + 4, legR.mid.x, legR.mid.y) - 3.5;
        const dBooR = sdBox(lx, ly, legR.end.x, legR.end.y, 3, 3);
        if (dLegR < 0) col = COL.robeDark;
        if (dBooR < 0) col = COL.boots;

        // ROBE BODY
        const dRobe = sdSegment(lx, ly, rx, ry - 2, rx, ry + 10) - 7.0;
        const dSkirt = sdSegment(lx, ly, rx, ry + 2, rx, ry + 9) - 8.0;
        let dMainBody = smin(dRobe, dSkirt, 2.0);

        if (dMainBody < 0) {
          if (Math.abs(lx - rx) < 1.5 && ly < ry + 10) col = COL.goldLit;
          else col = COL.robeMid;

          // Belt Buckle (New)
          if (Math.abs(lx - rx) < 3 && Math.abs(ly - (ry + 2)) < 2) col = COL.goldLit;
        }

        // Potion (New) - Hanging on left hip
        const potionX = rx - 5, potionY = ry + 3;
        // animate potion slightly
        const potX = potionX + Math.sin(Date.now() * 0.005) * 1;
        const dPotion = sdCircle(lx, ly, potX, potionY, 2.5);
        if (dPotion < 0) col = COL.potion;

        // ARMS
        const dArmL_S = sdSegment(lx, ly, chest.x - 6, chest.y, armL.mid.x, armL.mid.y) - 3;
        const dArmL_E = sdSegment(lx, ly, armL.mid.x, armL.mid.y, armL.end.x, armL.end.y) - 3;
        if (dArmL_S < 0 || dArmL_E < 0) col = COL.robeLit;
        const dArmR_S = sdSegment(lx, ly, chest.x + 6, chest.y, armR.mid.x, armR.mid.y) - 3;
        const dArmR_E = sdSegment(lx, ly, armR.mid.x, armR.mid.y, armR.end.x, armR.end.y) - 3;
        if (dArmR_S < 0 || dArmR_E < 0) col = COL.robeLit;

        // BEARD PHYSICS
        // Beard tip rotates based on wizard.beard.ang
        const bAng = (90 + (wizard.beard.ang || 0)) * Math.PI / 180;
        const beardTip = { x: head.x + Math.cos(bAng) * 8, y: head.y + 2 + Math.sin(bAng) * 8 };

        // HEAD & BEARD
        const dHead = sdCircle(lx, ly, head.x, head.y, 6.5);
        const dBeard = sdSegment(lx, ly, head.x, head.y + 2, beardTip.x, beardTip.y) - (4.0 - (ly - head.y) * 0.3);

        if (dBeard < 0) col = COL.beard;
        else if (dHead < 0) col = COL.skin;

        // BLINKING EYES
        if (wizard.blink < 0.5) {
          const eyeX = head.x + 3; // Facing right
          if (Math.abs(lx - eyeX) < 1 && Math.abs(ly - head.y) < 1) col = 0xff000000;
        }

        // HAT
        const hatBase = { x: head.x, y: head.y - 5 };
        const hatMid = { x: head.x - 4, y: head.y - 15 };
        const hatTip = { x: head.x - 12, y: head.y - 12 };

        const dHatMid = sdSegment(lx, ly, hatBase.x, hatBase.y, hatMid.x, hatMid.y) - (5.0 - (hatBase.y - ly) * 0.2);
        const dHatTip = sdSegment(lx, ly, hatMid.x, hatMid.y, hatTip.x, hatTip.y) - 3.0; // Tighter tip
        const dHatBrim = sdSegment(lx, ly, head.x - 10, head.y - 4, head.x + 10, head.y - 4) - 1.5;
        const dHatBand = sdSegment(lx, ly, head.x - 5, head.y - 6, head.x + 5, head.y - 6) - 2.0;

        if (dHatBand < 0) col = COL.goldLit;
        else if (dHatMid < 0 || dHatTip < 0 || dHatBrim < 0) col = COL.robeDark;

        // ORB
        const dOrb = sdCircle(lx, ly, staffTop.x, staffTop.y, 4.0);
        if (dOrb < 0) col = COL.orb;
        else if (dOrb < 2.0) col = COL.orbGlow;

        // OUTLINE
        const dAll = Math.min(dMainBody, dHead, dHatMid, dHatTip, dHatBrim, dBooL, dBooR, dArmL_S, dArmR_E, dStaff);
        if (col === 0 && dAll < 1.5 / SCALE) col = COL.outline;

        // RIM LIGHT (New)
        // If inside shape, check if near left edge (since light is top-left in facing space)
        if (col !== 0 && col !== COL.outline && col !== COL.orb && col !== COL.orbGlow && dAll > -1.5) {
          // Determine normal approximation roughly or just x gradient
          // Simple Rim: Top-Left edge
          if (lx < rx && ly < ry) {
            // Additive blend? No, just set to lit color or lighten
            // Hardcoded rim color
            // Check against neighbors to see if it's an edge
          }
          // Actually Rim Light in 2D SDF usually means: dAll + shift > 0
          const dShift = dAll + 0.5; // Erode
          // Hard to do strictly without normals. 
          // Color Logic: If Main Body & Left side -> Lighter
        }

        if (col !== 0) pix[y * WIZ_W + x] = col;
      }
    }
    offCtx.putImageData(img, 0, 0);

    // DEBUG: Draw Cape Particles (local rig space -> sprite space)
    // NOTE: Keep disabled by default (uncomment if needed).
    /*
    if (G.wizard.xpbdCape && G.wizard.xpbdCape.p) {
      offCtx.fillStyle = 'rgba(255,0,0,0.85)';
      for (const pt of G.wizard.xpbdCape.p) {
        const sx = PIVOT.x + pt.x * SCALE;
        const sy = PIVOT.y + pt.y * SCALE;
        offCtx.fillRect(sx, sy, 1, 1);
      }
    }
    */


    // TRAIL RENDER (Local space approximation)
    /*
    offCtx.fillStyle = 'rgba(255, 32, 160, 0.4)';
    for(let t of trail) {
        const px = (t.x * SCALE * facing) + PIVOT.x; // Facing flip
        const py = (t.y * SCALE) + PIVOT.y;
        offCtx.fillRect(px-2, py-2, 4, 4);
    }
    */
  }

  function spawnDust(wx, wy, opt = null, color = COL.dust) {
    // World-space dust emitter.
    // wx/wy are WORLD coordinates (same space as G.player.x/y).
    if (!G.spawnParticle) return;

    const o = opt || {};
    const dir = (o.dir === undefined) ? 0 : o.dir; // -1..1 (roughly)
    const n = (o.n === undefined) ? 6 : o.n;
    const lift = (o.lift === undefined) ? 1.0 : o.lift;
    const spread = (o.spread === undefined) ? 1.0 : o.spread;
    const size = (o.size === undefined) ? 2 : o.size;

    for (let i = 0; i < n; i++) {
      const jitterX = (Math.random() - 0.5) * 6 * spread;
      const jitterY = (Math.random() - 0.5) * 3;

      // Kick the dust slightly opposite the direction of movement (dir)
      const vx = (-dir * (22 + Math.random() * 34)) + (Math.random() - 0.5) * 28;
      const vy = (-(26 + Math.random() * 48) * lift) + (Math.random() - 0.5) * 14;

      const life = 0.14 + Math.random() * 0.22;
      G.spawnParticle(wx + jitterX, wy + jitterY, vx, vy, life, color, size);

      // ------------------------------------------------------
      // Noita-style bridge: occasionally eject a real pixel from the
      // ground and let it fly as a "material particle", then reinsert.
      // This restores the missing "dust chunks" feel when running/turning.
      // ------------------------------------------------------
      if (G.ejectCellAsParticle && Math.random() < 0.12) {
        const ex = (wx + jitterX) | 0;
        const ey = ((wy | 0) + 1) | 0;
        // Smaller velocity than the visual dust so it reads as heavier chunks.
        const evx = vx * 0.25 + (Math.random() - 0.5) * 18;
        const evy = vy * 0.25;
        G.ejectCellAsParticle(ex, ey, evx, evy, 0.55);
      }
    }
  }

  function updatePhysics(dt, p, pose) {
    const t = Date.now() * 0.001;

    // Smooth cape preferred direction so turns don't hard-snap.
    // This does NOT affect sprite facing; only cape bias/wind.
    if (wizard.capeDir === undefined) wizard.capeDir = (wizard.facing || 1);
    const kDir = 1 - Math.pow(0.001, dt); // ~0.15s response at 60fps
    wizard.capeDir += ((wizard.facing || 1) - wizard.capeDir) * kDir;
    wizard.capeDir = clamp(wizard.capeDir, -1, 1);

    // Countdown: brief window after a fast turn where we disable BODY collisions
    // so the cape can swap sides without getting trapped against the torso.
    if (wizard._capeNoBodyCollideT) {
      wizard._capeNoBodyCollideT = Math.max(0, wizard._capeNoBodyCollideT - dt);
    }

    
    // --- CAPE (WORLD-SPACE CHAIN CLOAK) ---
    // A "chain of links" (rope) simulation with PBD constraints.
    // This is easier to tune than a full cloth grid and gives a very Noita-like follow-through.
    if (!wizard.capeSim) {
      const capeCfg = (G.CONF && G.CONF.CAPE) || {};
      wizard.capeSim = new CapeChain({
        // Total cape length in WORLD pixels
        length: (capeCfg.length ?? 22),
        // Number of chain links (points) along the cape spine
        links: (capeCfg.links ?? 14),

        // Visual width (world px)
        wTop: (capeCfg.wTop ?? 2.0),
        wBot: (capeCfg.wBot ?? 5.0),

        // Physics
        substeps: (capeCfg.substeps ?? 2),
        iterations: (capeCfg.iterations ?? 8),
        gravity: (capeCfg.gravity ?? 900),
        damping: (capeCfg.damping ?? 0.995),

        // Aerodynamics (separate X/Y)
        dragX: (capeCfg.dragX ?? 6.0),
        dragY: (capeCfg.dragY ?? 3.2),

        // Bending resistance (keep low for "cloth" feel)
        bend: (capeCfg.bend ?? 0.10),

        // Collision tuning
        thickness: (capeCfg.thickness ?? 1.4),
        friction: (capeCfg.friction ?? 0.55),

        // Start collisions a few links down so the top stays clean (no shoulder kink)
        collideFrom: (capeCfg.collideFrom ?? 3),

        // Stability / turn glitch fixes
        turnTeleportDist: (capeCfg.turnTeleportDist ?? 7.5),
        turnRebase: (capeCfg.turnRebase ?? 0.85),
        maxDispPerSubstep: (capeCfg.maxDispPerSubstep ?? 10.0),

        // Emergency stretch clamp
        maxSegStretch: (capeCfg.maxSegStretch ?? 1.25),

        // Turn swing tuning
        kickImpulse: (capeCfg.kickImpulse ?? 42),
        kickAccel: (capeCfg.kickAccel ?? 520),
      });
      if (G.log) G.log('CAPE CHAIN');
    }

    if (wizard.capeSim) {
      const capeCfg = (G.CONF && G.CONF.CAPE) || {};

      // IMPORTANT: use the *actual* sprite facing for physics direction.
      // Using the smoothed capeDir here can lag during quick direction changes and
      // make the cape feel like it "blocks" / bunches up.
      const frontDir = (wizard.facing || 1);
      const backDir = -frontDir; // -1 or +1
      const speed = Math.abs(p.vx);
      const speed01 = clamp(speed / 80, 0, 1);

      // Falling factor (0..1). Used to make the cape "plane" faster in a drop.
      // p.vy > 0 means falling down.
      const fall01 = clamp((p.vy - 8) / 180, 0, 1);

      // Anchor near shoulders/back (WORLD pixels)
      // Keep it near the center so turns do not teleport the cape.
      const runBob = (p.onGround ? Math.sin((wizard.time.run || 0) * 10) * 0.8 * speed01 : 0);

      // Anchor near the actual shoulder/back attachment point.
      // IMPORTANT: the SDF sprite is authored in rig-local units and converted to pixels with SCALE.
      // By deriving the anchor from the current pose, we keep the cape visually attached (no jitter / detach).
      let anchor = {
        x: p.x + backDir * 3.5,
        y: p.y - 25 + runBob
      };

      if (pose && pose.root && pose.bones) {
        const B = pose.bones;
        const root = pose.root;

        const rx = root.x || 0;
        const ry = (root.y || 0) - 25;

        const spineRad = (B.spine || 0) * Math.PI / 180;
        const chestX = rx + Math.sin(spineRad) * 10;
        const chestY = ry - Math.cos(spineRad) * 10;

        // Back attachment: closer to the upper-back center so the top fold
        // sits *behind* the torso instead of popping on the shoulder edge.
        // (Rig space is authored facing-right; we convert to world with SCALE and facing.)
        const axLocal = chestX - 2.5;
        const ayLocal = chestY + 2.0;

        // Keep the pinned point close to the body for a centered look, but add a tiny
        // back bias so the first link starts behind the silhouette.
        anchor = {
          x: p.x + axLocal * SCALE * (wizard.facing || 1) + backDir * 0.5,
          y: p.y + ayLocal * SCALE + runBob
        };
      }

      // Relative wind (WORLD px/s). The solver drags point velocity toward this wind.
      // - Running: strong horizontal trailing.
      // - Falling: strong upward component so the cape streams vertically.
      const tNoise = t;
      // Relative wind (WORLD px/s). The solver drags point velocity toward this wind.
      // - Running: strong horizontal trailing.
      // - Falling: stronger back-stream + lift so the cape snaps horizontal faster.
      // Note: keep base trailing VERY small so the cape hangs more vertically at idle.
      // (Most of the horizontal trail should come from actual movement / falling.)
      const windX = (-p.vx * 1.05)
        + backDir * (0.25 + 38.0 * speed01 + 240.0 * fall01)
        + Math.sin(tNoise * 0.9) * 2.0;
      const windY = (-p.vy * (1.05 + 1.15 * fall01))
        + Math.cos(tNoise * 1.3) * 1.2;

      // Make the cape respond quicker in a fall (more dynamism) without making
      // running feel too "stiff".
      const dragXMul = 1.0 + 0.20 * speed01 + 0.95 * fall01;
      const dragYMul = 1.0 + 3.2 * fall01;

      // Simple body colliders in WORLD pixels (very cheap).
      // IMPORTANT:
      // - The colliders should follow the *actual sprite facing* (wizard.facing), not the
      //   smoothed capeDir. Using capeDir here can momentarily put colliders on the wrong
      //   side during a flip, which can trap/bunch the cape.
      // - We bias colliders *towards the front* so the cape can sit behind the upper back.
      const colliders = [];

      const noBody = (wizard._capeNoBodyCollideT || 0) > 0;
      if (!noBody) {
        colliders.push(
          { type: 'circle',  x: p.x + frontDir * 2.0, y: anchor.y - 11.0, r: 6.0 },                   // head
          { type: 'capsule', ax: p.x + frontDir * 2.0, ay: anchor.y - 2.0, bx: p.x + frontDir * 2.0, by: p.y - 10.0, r: 7.5 }, // torso
          { type: 'circle',  x: anchor.x + frontDir * 1.2, y: anchor.y + 3.0, r: 4.0 },               // shoulder
        );
      }

      // During a turn (when body collisions are disabled), force the cape to migrate
      // behind the character so it doesn't get "caught" when collisions turn back on.
      const turnNoCollideTime = (capeCfg.turnNoCollideTime ?? 0.12);
      const keepBehind01 = (noBody && turnNoCollideTime > 1e-6)
        ? clamp((wizard._capeNoBodyCollideT || 0) / turnNoCollideTime, 0, 1)
        : 0;

      // Cheap ground line when grounded (prevents the cape from sinking under feet)
      if (p.onGround) {
        colliders.push({ type: 'capsule', ax: p.x - 200, ay: p.y + 1, bx: p.x + 200, by: p.y + 1, r: 1.0 });
      }

      wizard.capeSim.step(
        dt,
        anchor,
        { windX, windY, fall01, dragXMul, dragYMul, keepBehind01,
        keepBehindDist: (capeCfg.keepBehindDist ?? 0.8),
        keepBehindStiff: (capeCfg.keepBehindStiff ?? 0.42) },
        colliders,
        backDir,
        tNoise
      );
    }
// Beard Physics (Legacy)
    const targetAng = clamp(p.vx * -0.5, -45, 45);
    const ba = (targetAng - wizard.beard.ang) * 100 - wizard.beard.vel * 10;
    wizard.beard.vel += ba * dt;
    wizard.beard.ang += wizard.beard.vel * dt;
  }

  function copyPose(src) {
    if (!src) return null;
    const dst = { root: { x: src.root.x, y: src.root.y }, bones: {} };
    for (let k in src.bones) dst.bones[k] = src.bones[k];
    return dst;
  }

  function blendPoses(a, b, t) {
    if (!a) return b;
    if (!b) return a;
    const dst = { root: { x: 0, y: 0 }, bones: {} };
    dst.root.x = lerp(a.root.x, b.root.x, t);
    dst.root.y = lerp(a.root.y, b.root.y, t);

    const keys = new Set([...Object.keys(a.bones), ...Object.keys(b.bones)]);
    for (let k of keys) {
      const angA = a.bones[k] || b.bones[k] || 0;
      const angB = b.bones[k] || a.bones[k] || 0;
      dst.bones[k] = lerpAngle(angA, angB, t);
    }
    return dst;
  }

  G.updateWizardAnim = function (dt) {
    if (!G.player) return;
    const p = G.player;

    const prevFacing = wizard.facing || 1;
    wizard.facing = p.facing || 1;

    // Turn detection
    if (prevFacing !== wizard.facing) {
      // Dust burst at the feet when turning.
      if (p.onGround) spawnDust(p.x, p.y, { dir: prevFacing, n: 9, lift: 1.0, spread: 1.0 }, COL.dust);

      // Cape is simulated in WORLD space; do not mirror state on turn.
      // Instead we optionally add a small impulse so it swings naturally.
      if (wizard.capeSim && typeof wizard.capeSim.kickTurn === 'function') {
        wizard.capeSim.kickTurn(prevFacing, wizard.facing, Math.abs(p.vx));

        // Prevent the cape from getting "stuck" on the body when rapidly flipping.
        // In 2D, the cape would have to pass *through* the torso to swap sides;
        // we allow a short grace window where body collisions are disabled.
        const capeCfg = (G.CONF && G.CONF.CAPE) || {};
        wizard._capeNoBodyCollideT = Math.max(
          wizard._capeNoBodyCollideT || 0,
          (capeCfg.turnNoCollideTime ?? 0.12)
        );
      }
    }

    const onGround = p.onGround;
    const speed = Math.abs(p.vx);

    // ---------------------------------------------------------
    // Wizard FX (Dust) — restored + made world-space.
    // Emits small puffs on steps, jumps, landings, and hard acceleration.
    // ---------------------------------------------------------
    wizard._fx = wizard._fx || { wasGround: onGround, prevVx: p.vx, stepDist: 0, stepSide: 1 };
    const fx = wizard._fx;

    // Jump / Land detection
    if (!fx.wasGround && onGround) {
      // Land impact puff
      spawnDust(p.x, p.y, { dir: 0, n: 10, lift: 0.7, spread: 1.2, size: 2 }, COL.dust);
    } else if (fx.wasGround && !onGround && p.vy < -20) {
      // Takeoff puff
      spawnDust(p.x, p.y, { dir: Math.sign(p.vx || 0), n: 6, lift: 1.0, spread: 0.9, size: 2 }, COL.dust);
    }

    // Step dust while running on ground (distance-based)
    if (onGround && speed > 18) {
      fx.stepDist += speed * dt;
      const stride = (speed > 65) ? 7.5 : 10.5; // px per puff
      while (fx.stepDist > stride) {
        fx.stepDist -= stride;
        fx.stepSide *= -1;
        const dir = Math.sign(p.vx || 0);
        const sx = p.x - dir * 2 + fx.stepSide * 2;
        spawnDust(sx, p.y, { dir, n: 2, lift: 0.65, spread: 0.7, size: 2 }, COL.dust);
      }
    } else {
      fx.stepDist = 0;
    }

    // Acceleration dust (skid / push-off)
    if (onGround && dt > 1e-6) {
      const ax = (p.vx - fx.prevVx) / dt;
      // Only when acceleration is high AND we're moving.
      if (Math.abs(ax) > 280 && speed > 25) {
        const dir = Math.sign(p.vx || 0);
        spawnDust(p.x, p.y, { dir, n: 4, lift: 0.55, spread: 0.8, size: 2 }, COL.dust);
      }
      fx.prevVx = p.vx;
    }
    fx.wasGround = onGround;


    // State Logic with Hysteresis
    let state = 'idle';
    if (!onGround) {
      if (Math.abs(p.vy) > 20) state = 'jump';
      else state = (Math.abs(p.vx) > 5) ? 'walk' : 'idle';
    }
    else if (speed > 55) state = 'run';
    else if (speed > 5) state = 'walk';

    wizard.lastGroundedState = onGround ? state : wizard.lastGroundedState;

    if (state !== wizard.state) {
      wizard.state = state;
      wizard.time[state] = 0;
    }
    wizard.time[state] += dt;

    // Blinking
    wizard.blinkTimer -= dt;
    if (wizard.blinkTimer < 0) {
      wizard.blink = 1; // Close
      if (wizard.blinkTimer < -0.15) {
        wizard.blink = 0; // Open
        wizard.blinkTimer = 2 + Math.random() * 4;
      }
    }

    // updatePhysics(dt, p); // MOVED to after pose for anchor consistency

    // DEBUG: Auto-Reset Cape if NaN detected or key press 'h'
    if (wizard.capeSim && wizard.capeSim.points && wizard.capeSim.points.length) {
      if (Number.isNaN(wizard.capeSim.points[0].x)) {
        console.warn("Cape NaN detected! Resetting.");
        wizard.capeSim = null;
      }
    }
    // Dev hotkey: manual cape reset (use K)
    if (G.keys && G.keys.has && G.keys.has('k')) {
      wizard.capeSim = null;
      G.keys.delete('k');
      if (G.log) G.log('CAPE RESET');
    }

    const clipName = state === 'jump' ? 'jump' : state;
    const clip = G.wizardClips?.[clipName];

    let targetPose = null;
    if (clip) {
      const dur = clip.duration;
      const t = clip.loop ? (wizard.time[state] % dur) : Math.min(wizard.time[state], dur);

      const kf = clip.keyframes;
      if (kf.length) {
        let a = kf[0], b = kf[0];
        for (let i = 0; i < kf.length - 1; i++) {
          if (t >= kf[i].t && t <= kf[i + 1].t) { a = kf[i]; b = kf[i + 1]; break; }
        }
        const progress = (t - a.t) / (b.t - a.t || 1e-6);

        targetPose = { root: { x: 0, y: 0 }, bones: {} };
        targetPose.root.x = lerp(a.root.x, b.root.x, progress);
        targetPose.root.y = lerp(a.root.y, b.root.y, progress);

        for (let k in a.bones) {
          const angA = a.bones[k];
          const angB = b.bones[k] || angA;
          targetPose.bones[k] = lerpAngle(angA, angB, progress);
        }
      }
    }

    // Safe assignment
    wizard.pose = targetPose || wizard.pose;
    const pose = wizard.pose;

    // Smooth Y for rendering
    if (wizard.visualY === undefined) wizard.visualY = p.y;
    const dy = p.y - wizard.visualY;
    wizard.visualY += dy * Math.min(1, dt * 6);

    // Apply visual offset to root
    if (pose && pose.root) {
      pose.root.y += (wizard.visualY - p.y);
    }

    // STAFF AIM ("turret")
    if (pose && pose.bones) {
      const B = pose.bones;
      let targetDeg = null;

      // Ensure World Coords are available (Polyfill if missing)
      const mWorldX = (G.mouse && G.mouse.worldX !== undefined) ? G.mouse.worldX : (G.mouse ? (G.mouse.x + (G.camera ? G.camera.x : 0)) : undefined);
      const mWorldY = (G.mouse && G.mouse.worldY !== undefined) ? G.mouse.worldY : (G.mouse ? (G.mouse.y + (G.camera ? G.camera.y : 0)) : undefined);

      if (mWorldX !== undefined && mWorldY !== undefined) {
        const rx = (pose.root && pose.root.x) || 0;
        const ry = ((pose.root && pose.root.y) || 0) - 25;

        const spineRad = (B.spine || 0) * Math.PI / 180;
        const chest = { x: rx + Math.sin(spineRad) * 10, y: ry - Math.cos(spineRad) * 10 };

        // Need solveLimb to be available. If not defined in scope, we must hope it is available or define it.
        // Assuming it is defined as it is used in renderWizard? 
        // If not, we need to find it. But let's assume it is available in scope or G.
        const armR = solveLimb({ x: chest.x + 6, y: chest.y - 2 }, 70, 8, 7, B.armR_up || 0, B.armR_lo || 0);
        const hand = armR.end;

        const tx = ((mWorldX - p.x) * wizard.facing) / SCALE; // using wizard.facing to flip X
        const ty = ((mWorldY - p.y)) / SCALE;

        const vx = tx - hand.x;
        const vy = ty - hand.y;

        targetDeg = (Math.atan2(vy, vx) * 180) / Math.PI;

        // --- MANGA RETREAT SEQUENCE ---
        // Detect Retreat: Moving away from Aim direction
        const isAimingBack = vx < -15; // Local X is negative (Behind)
        const speed = Math.abs(p.vx);
        const isRetreating = isAimingBack && speed > 5;

        // Timer Logic
        if (wizard.retreatTimer === undefined) wizard.retreatTimer = 0;
        if (isRetreating) wizard.retreatTimer += dt;
        else wizard.retreatTimer = Math.max(0, wizard.retreatTimer - dt * 3); // Decay fast

        const tRetreat = wizard.retreatTimer;

        // Default Shoulder
        let shoulderX = chest.x + 6;
        let shoulderY = chest.y - 2;

        // --- PHASE 1: CROSS BODY (0.2s - 1.0s) ---
        // Character pulls arm across chest to aim back.
        if (tRetreat > 0.2) {
          const p1 = Math.min(1, (tRetreat - 0.2) * 2);
          // Exaggerated Shoulder Shift "Deep Cross"
          shoulderX += 8 * p1;
          shoulderY += 2 * p1; // Shrug up slightly
        }

        const sx = tx - shoulderX;
        const sy = ty - shoulderY;
        const shoulderDeg = (Math.atan2(sy, sx) * 180) / Math.PI;

        // Apply Right Arm
        B.armR_up = shoulderDeg;
        B.armR_lo = 10;

        // --- LEFT ARM STABILIZATION (2-frame snap + micro-inertia) ---
        // Goal: the moment retreat starts, kill the run-cycle swing on the left arm.
        {
          if (wizard.armLStab === undefined) wizard.armLStab = 0;

          const snapT = 2 / 60;     // ~2 frames to lock
          const releaseT = 4 / 60;  // a few frames to release back to run-cycle
          const stabOn = (isRetreating || tRetreat > 0);

          if (stabOn) wizard.armLStab = clamp(wizard.armLStab + dt / snapT, 0, 1);
          else wizard.armLStab = clamp(wizard.armLStab - dt / releaseT, 0, 1);

          if (wizard.armLStab > 0) {
            // Ease-out so the first frame is already strong but not a harsh pop
            const pStab = 1 - (1 - wizard.armLStab) * (1 - wizard.armLStab);

            // --- Micro-inertia (based on character accel) ---
            if (wizard._armLPrevVx === undefined) wizard._armLPrevVx = p.vx;
            if (wizard._armLPrevVy === undefined) wizard._armLPrevVy = p.vy;
            const axChar = (p.vx - wizard._armLPrevVx) / Math.max(dt, 1e-6);
            const ayChar = (p.vy - wizard._armLPrevVy) / Math.max(dt, 1e-6);
            wizard._armLPrevVx = p.vx;
            wizard._armLPrevVy = p.vy;

            // Convert world accel -> our local rig space (right-facing)
            const localAx = (axChar * wizard.facing) / SCALE;
            const localAy = (ayChar) / SCALE;

            // Small, clamped offsets (tuned for pixel-scale rig)
            const offX = clamp(-localAx * 0.003, -3.0, 3.0);
            const offY = clamp(-localAy * 0.002, -2.0, 2.0);

            // Low-pass offsets to avoid jitter (fast follow)
            if (wizard._armLReadyOffX === undefined) wizard._armLReadyOffX = 0;
            if (wizard._armLReadyOffY === undefined) wizard._armLReadyOffY = 0;
            const follow = clamp(dt * 30, 0, 1);
            wizard._armLReadyOffX = lerp(wizard._armLReadyOffX, offX, follow);
            wizard._armLReadyOffY = lerp(wizard._armLReadyOffY, offY, follow);

            // "Ready Hand" pose: tucked near chest center
            const readyX = chest.x + 2 + wizard._armLReadyOffX;
            const readyY = chest.y + 8 + wizard._armLReadyOffY;

            // Left shoulder anchor (same as renderWizard)
            const shLx = chest.x - 6;
            const shLy = chest.y - 2;

            // IK solve -> bone angles
            const armLIK = solveLimbIK(
              { x: shLx, y: shLy },
              110,  // baseAngle for left arm
              8, 7, // lengths
              readyX, readyY,
              B.armL_up || 0,
              B.armL_lo || 0
            );

            if (armLIK) {
              // CRITICAL: override aggressively (pStab ~ 1 within 2 frames)
              B.armL_up = lerpAngle(B.armL_up || 0, armLIK.up, pStab);
              B.armL_lo = lerpAngle(B.armL_lo || 0, armLIK.lo, pStab);
            }
          }
        }

        // --- PHASE 2: TWO HANDED COUNTER-BALANCE (1.0s+) ---
        // Left arm grabs staff. Body leans away.
        if (tRetreat > 1.0) {
          const p2 = Math.min(1, (tRetreat - 1.0) * 1.5); // 0 -> 1 over 0.6s

          // 1. ROOT SHIFT (Counter-Weight)
          // Move root AWAY from staff target (Lean forward relative to run)
          // Staff is Back. Root moves Forward.
          if (pose.root) {
            pose.root.x += 6 * p2;
            pose.root.y += 2 * p2; // Crouch slightly
          }

          // 2. SPINE TWIST
          // Twist spine towards staff to look at it
          const twist = (targetDeg > 0 ? -20 : 20); // Twist towards aim
          B.spine = lerpAngle(B.spine || 0, twist, p2 * 0.7);

          // 3. LEFT ARM IK (Reach for staff)
          // Target point on staff shaft (offset from Right Hand)
          const angRad = targetDeg * Math.PI / 180;
          const grabOffset = 14;
          const lhTx = hand.x + Math.cos(angRad) * grabOffset;
          const lhTy = hand.y + Math.sin(angRad) * grabOffset;

          // Left Shoulder (approx)
          const shLx = chest.x - 6;
          const shLy = chest.y - 2;

          // Solve (IK)
          const armLIK = solveLimbIK(
            { x: shLx, y: shLy },
            110,  // baseAngle for left arm
            8, 7, // lengths
            lhTx, lhTy,
            B.armL_up || 0,
            B.armL_lo || 0
          );
          if (armLIK) {
            B.armL_up = lerpAngle(B.armL_up || 0, armLIK.up, p2);
            B.armL_lo = lerpAngle(B.armL_lo || 0, armLIK.lo, p2);
          }

          // --- PHASE 3: STRUGGLE / HEAVY LOOK (2.5s Random) ---
          // Occasional weight drop
          if (tRetreat > 2.5 && Math.sin(wizard.time.idle * 3) > 0.7) {
            const heaviness = Math.sin(wizard.time.idle * 10) * 5 * p2;
            targetDeg += heaviness; // Tip dips down
            B.head = (B.head || 0) + heaviness * 0.5; // Head follows
          }
        }
      }

      if (targetDeg === null) {
        // fallback: keep clip-authored staff pose
        const rawAngle = 70 + (B.armR_up || 0) + (B.armR_lo || 0) + (B.staff || 0);
        targetDeg = rawAngle;
      }

      // Write back staff bone
      // This formula ensures the Staff World Angle is exactly 'targetDeg'
      // regardless of what we did to the arm bones above.
      B.staff = targetDeg - 70 - (B.armR_up || 0) - (B.armR_lo || 0);

      // keep for debug
      wizard.staff.ang = targetDeg;
      wizard.staff.vel = 0;
    }

    // --- UPDATE PHYSICS (Late Update) ---
    // Now that we have the final POSE, we update the cape in Local Rig Space
    updatePhysics(dt, p, pose);
  };

  G.drawWizard = function (screenX, screenY) {
    if (!G.wizard.pose) return; // safety
    renderWizard(G.wizard.pose);
    const ctx = G.ctx;
    if (!ctx) return;

    // Use floating point coordinates for smoother sub-pixel rendering
    const dx = screenX;
    const dy = screenY;

    ctx.save();
    if (G.wizard.facing < 0) {
      ctx.translate(dx + PIVOT.x, dy - PIVOT.y);
      ctx.scale(-1, 1);
    } else {
      ctx.translate(dx - PIVOT.x, dy - PIVOT.y);
    }
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  }

  


// =========================================================
// CapeChain (WORLD space)
// Stable "chain of links" cape spine using Verlet + PBD constraints.
// - World-space simulation (same space as player/world pixels)
// - Inextensible links (distance constraints)
// - Optional simple colliders (circle/capsule)
// Rendering expands the spine into a sheet using normals (see renderWizard).
// =========================================================
class CapeChain {
  constructor(opts = {}) {
    this.links = Math.max(2, opts.links ?? 14);
    this.length = (opts.length ?? 22);

    // Solver
    this.substeps = Math.max(1, opts.substeps ?? 2);
    this.iterations = Math.max(1, opts.iterations ?? 8);

    // Visual sheet widths (WORLD px)
    this.wTop = (opts.wTop ?? 2.0);
    this.wBot = (opts.wBot ?? 5.0);

    // Physics
    this.gravity = (opts.gravity ?? 900);     // px/s^2
    this.damping = (opts.damping ?? 0.995);   // 0..1 (velocity damping)

    // "Wind" is provided as a target velocity in px/s.
    // dragX/dragY describe how quickly the cape converges toward that target.
    this.dragX = (opts.dragX ?? 6.0);         // 1/s
    this.dragY = (opts.dragY ?? 3.2);         // 1/s

    // -----------------------------------------------------
    // Safety / stability knobs
    // -----------------------------------------------------
    // Large instantaneous attachment moves (turning) can cause a brief
    // "tension line" artifact. We detect sudden anchor jumps and partially
    // rebase the chain to keep slack and avoid a 1-2 frame stretch glitch.
    this.turnTeleportDist = (opts.turnTeleportDist ?? 7.5); // px
    this.turnRebase = clamp((opts.turnRebase ?? 0.85), 0, 1); // 0..1

    // Cap extreme per-substep displacement (safety net; shouldn't trigger in normal play)
    this.maxDispPerSubstep = (opts.maxDispPerSubstep ?? 10.0); // px

    // Emergency clamp to prevent rare \"rubber band\" elongation
    // during very fast motion or extreme collision corrections.
    this.maxSegStretch = (opts.maxSegStretch ?? 1.25); // ratio (e.g. 1.25 = +25%)

    // Turn kick tuning
    this.kickImpulse = (opts.kickImpulse ?? 42); // px (applied to previous positions)
    this.kickAccel = (opts.kickAccel ?? 520);    // px/s^2 (extra tail accel)

    // Bending resistance (0..1). Low values keep it cape-like (smooth, not rope-kinky).
    this.bend = (opts.bend ?? 0.10);

    // Collision
    this.thickness = (opts.thickness ?? 1.4);
    this.friction = (opts.friction ?? 0.55);  // 0..1 (0=sticky, 1=slide)

    // Start collisions a few links down to avoid a hard \"kink\" right at the anchor.
    this.collideFrom = Math.max(1, opts.collideFrom ?? 3);

    // Points: {x,y, px,py, invMass}
    this.points = new Array(this.links);
    for (let i = 0; i < this.links; i++) {
      this.points[i] = { x: 0, y: 0, px: 0, py: 0, invMass: 1 };
    }

    this._initialized = false;
    this._kick = 0;
    this._kickDir = 0;
    this._lastAnchor = null;
  }

  reset(anchor, backDir = -1) {
    const pts = this.points;
    const n = pts.length;
    const seg = this.length / Math.max(1, (n - 1));

    for (let i = 0; i < n; i++) {
      const t = (n <= 1) ? 0 : (i / (n - 1));

      // Start slightly behind, then drape mostly downward.
      const x = anchor.x + backDir * (2.0 + 1.5 * t);
      const y = anchor.y + seg * i + (t * t) * 1.2;

      const P = pts[i];
      P.x = P.px = x;
      P.y = P.py = y;

      // Slightly heavier tail helps the drape.
      P.invMass = (i === 0) ? 0 : (1.0 / (1.0 + 0.8 * t));
    }

    this._initialized = true;
    this._kick = 0;
  }

  // Optional impulse when turning so the cape swings instead of sticking.
  kickTurn(prevFacing, newFacing, speed = 0) {
    const df = (newFacing - prevFacing);
    if (!df) return;

    this._kick = Math.min(1, this._kick + 1.0);

    // Direction: push opposite to the turn direction (inertia feel)
    this._kickDir = -Math.sign(df);

    // Inject sideways velocity by shifting previous positions.
    const speed01 = clamp(speed / 80, 0, 1);
    const impulse = this.kickImpulse * (0.55 + 0.65 * speed01) * this._kickDir;
    const pts = this.points;
    for (let i = 1; i < pts.length; i++) {
      const t = i / (pts.length - 1);
      pts[i].px -= impulse * (0.05 + 0.55 * t);
    }
  }

  _solveDist(i, j, rest, stiff = 1.0) {
    const A = this.points[i];
    const B = this.points[j];

    const wA = A.invMass, wB = B.invMass;
    const w = wA + wB;
    if (w <= 0) return;

    let dx = B.x - A.x;
    let dy = B.y - A.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return;

    const diff = (d - rest) / d;
    const corrX = dx * diff * stiff;
    const corrY = dy * diff * stiff;

    A.x += corrX * (wA / w);
    A.y += corrY * (wA / w);
    B.x -= corrX * (wB / w);
    B.y -= corrY * (wB / w);
  }

  _collidePoint(P, col) {
    const thickness = this.thickness;
    const fr = clamp(this.friction, 0, 1);

    const applyFriction = () => {
      const vx = P.x - P.px;
      const vy = P.y - P.py;
      P.px = P.x - vx * fr;
      P.py = P.y - vy * fr;
    };

    if (col.type === 'circle') {
      let dx = P.x - col.x;
      let dy = P.y - col.y;
      const r = (col.r ?? 0) + thickness;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        let d = Math.sqrt(d2);
        if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
        const nx = dx / d, ny = dy / d;
        const push = r - d;
        P.x += nx * push;
        P.y += ny * push;
        applyFriction();
      }
      return;
    }

    if (col.type === 'capsule') {
      const abx = col.bx - col.ax;
      const aby = col.by - col.ay;
      const apx = P.x - col.ax;
      const apy = P.y - col.ay;
      const ab2 = abx * abx + aby * aby + 1e-6;
      const t = clamp((apx * abx + apy * aby) / ab2, 0, 1);
      const qx = col.ax + abx * t;
      const qy = col.ay + aby * t;

      let dx = P.x - qx;
      let dy = P.y - qy;
      const r = (col.r ?? 0) + thickness;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        let d = Math.sqrt(d2);
        if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
        const nx = dx / d, ny = dy / d;
        const push = r - d;
        P.x += nx * push;
        P.y += ny * push;
        applyFriction();
      }
    }
  }

  step(dt, anchor, env = {}, colliders = null, backDir = -1, timeSec = 0) {
    dt = Math.min(dt, 1 / 30);
    if (!this._initialized) this.reset(anchor, backDir);

    // -----------------------------------------------------
    // Anti-stretch on fast turns: if the anchor "teleports" (facing flip),
    // rebase upper links toward the new anchor to keep slack.
    // -----------------------------------------------------
    if (!this._lastAnchor) this._lastAnchor = { x: anchor.x, y: anchor.y };
    const adx = anchor.x - this._lastAnchor.x;
    const ady = anchor.y - this._lastAnchor.y;
    this._lastAnchor.x = anchor.x;
    this._lastAnchor.y = anchor.y;

    const aJump = Math.hypot(adx, ady);
    if (aJump > this.turnTeleportDist) {
      const pts = this.points;
      const n = pts.length;
      // Pull the top of the chain with the anchor, tail follows less.
      for (let i = 1; i < n; i++) {
        const t = i / (n - 1);
        const follow = (1 - t);
        const w = this.turnRebase * follow * follow; // stronger near root
        pts[i].x += adx * w;
        pts[i].y += ady * w;
        pts[i].px += adx * w;
        pts[i].py += ady * w;
      }
      // Also damp any kick so we don't stack energy on a teleport.
      this._kick *= 0.35;
    }

    const pts = this.points;
    const sub = this.substeps;
    const h = dt / sub;
    const h2 = h * h;

    const windX0 = env.windX || 0;
    const windY0 = env.windY || 0;
    const fall01 = clamp(env.fall01 || 0, 0, 1);

    // When turning, we temporarily disable body collisions so the cape can pass
    // "through" the torso (2D cheat). During that window, we also softly enforce
    // that the cape migrates to the "behind" side, so it doesn't get re-trapped
    // when collisions resume.
    const keepBehind01 = clamp(env.keepBehind01 || 0, 0, 1);
    const keepBehindDist = (env.keepBehindDist ?? 0.7);   // px behind anchor plane
    const keepBehindStiff = (env.keepBehindStiff ?? 0.55); // 0..1

    // Allow per-frame multipliers from the caller (e.g., stronger in fall)
    const dragX = this.dragX * (env.dragXMul ?? 1);
    const dragY = this.dragY * (env.dragYMul ?? 1);

    // decay turn kick
    this._kick *= Math.exp(-dt * 8.0);

    for (let s = 0; s < sub; s++) {
      // 1) Verlet integrate with gravity + drag-to-wind
      for (let i = 1; i < pts.length; i++) {
        const P = pts[i];
        const t = (pts.length <= 1) ? 0 : (i / (pts.length - 1));
        const aero = (0.18 + 1.20 * t) * (1.0 + 0.65 * fall01); // tail reacts more, extra in fall

        const vx = (P.x - P.px) / Math.max(h, 1e-6);
        const vy = (P.y - P.py) / Math.max(h, 1e-6);

        // Gentle turbulence (keeps cloth alive, but stays stable)
        const turbX = Math.sin(P.y * 0.03 + timeSec * 1.6) * 6.0 * aero;
        const turbY = Math.cos(P.x * 0.03 + timeSec * 1.1) * 2.5 * aero;

        const windX = windX0 + turbX;
        const windY = windY0 + turbY;

        // Drag to match velocity to wind (clamped)
        // Wider clamp so falling feels punchier while staying stable.
        const dvx = clamp(windX - vx, -520, 520);
        const dvy = clamp(windY - vy, -900, 900);

        // Gravity slightly stronger towards the tail gives a nice drape.
        // In fast falls, reduce effective gravity a bit so the cape can "plane".
        const grav = this.gravity * (0.95 + 0.15 * t) * (1.0 - 0.70 * fall01);

        // Turn kick: small sideways accel on the tail.
        const axKick = (this._kick * this.kickAccel) * (t * t) * (this._kickDir || 0);

        const ax = dvx * dragX * aero + axKick;
        const ay = grav + dvy * dragY * aero;

        // Safety clamp: cap extreme displacement per substep (prevents rare 1-2 frame glitches)
        let ddx = (P.x - P.px) * this.damping;
        let ddy = (P.y - P.py) * this.damping;

        // Include acceleration contribution in the clamp (important when wind/turn forces spike).
        let stepDx = ddx + ax * h2;
        let stepDy = ddy + ay * h2;

        const stepLen = Math.hypot(stepDx, stepDy);
        const maxD = this.maxDispPerSubstep;
        if (stepLen > maxD) {
          const s = maxD / (stepLen || 1);
          stepDx *= s; stepDy *= s;
        }

        const nx = P.x + stepDx;
        const ny = P.y + stepDy;

        P.px = P.x; P.py = P.y;
        P.x = nx;   P.y = ny;
      }

      // 2) Pin root (point 0) to anchor (keep velocity continuity)
      {
        const P0 = pts[0];
        const dx = anchor.x - P0.x;
        const dy = anchor.y - P0.y;
        P0.x = anchor.x;
        P0.y = anchor.y;
        P0.px += dx;
        P0.py += dy;
        P0.invMass = 0;
      }

      // Segment rest length (WORLD px)
      const seg = this.length / Math.max(1, (pts.length - 1));

      // 2.5) Emergency anti-stretch clamp:
      // If something (rare) separated a segment too far in one step (e.g. extreme wind/turn/collision),
      // clamp it so we never show a 1-2 frame "rubber band" line.
      if (this.maxSegStretch > 1.0001) {
        const maxSeg = seg * this.maxSegStretch;
        for (let i = 1; i < pts.length; i++) {
          const A = pts[i - 1];
          const B = pts[i];
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          const d = Math.hypot(dx, dy);
          if (d > maxSeg && d > 1e-6) {
            const s = maxSeg / d;
            const nx = A.x + dx * s;
            const ny = A.y + dy * s;
            const ox = B.x, oy = B.y;
            B.x = nx;
            B.y = ny;
            // Shift previous pos by same delta to avoid injecting energy
            B.px += (nx - ox);
            B.py += (ny - oy);
          }
        }
      }

      // 3) Constraints + collisions

      for (let it = 0; it < this.iterations; it++) {
        for (let i = 0; i < pts.length - 1; i++) {
          this._solveDist(i, i + 1, seg);
        }

        // Soft bending (distance-2) + tiny smoothing to avoid kinks
        if (this.bend > 0 && pts.length > 2) {
          const stiff = this.bend * 0.25;
          for (let i = 0; i < pts.length - 2; i++) {
            this._solveDist(i, i + 2, seg * 2.0, stiff);
          }

          const sK = this.bend * 0.06;
          for (let i = 1; i < pts.length - 1; i++) {
            const P = pts[i];
            if (P.invMass === 0) continue;
            const A = pts[i - 1];
            const B = pts[i + 1];
            const tx = (A.x + B.x) * 0.5;
            const ty = (A.y + B.y) * 0.5;
            P.x += (tx - P.x) * sK;
            P.y += (ty - P.y) * sK;
          }
        }

        if (colliders) {
          const start = Math.min(pts.length - 1, Math.max(1, this.collideFrom | 0));
          for (let i = start; i < pts.length; i++) {
            const P = pts[i];
            for (const col of colliders) this._collidePoint(P, col);
          }
        }

        // Soft "behind" constraint during turns:
        // push links to the back side of the anchor plane so the cape doesn't
        // remain folded in front and get stuck when body collisions resume.
        if (keepBehind01 > 0.001) {
          const bd = Math.sign(backDir) || -1;
          const k = clamp(keepBehindStiff * keepBehind01, 0, 1);
          for (let i = 1; i < pts.length; i++) {
            const P = pts[i];
            if (P.invMass === 0) continue;
            const t = (pts.length <= 1) ? 0 : (i / (pts.length - 1));
            const target = keepBehindDist * (0.25 + 0.75 * t);
            const signed = (P.x - anchor.x) * bd;
            if (signed < target) {
              const corr = (target - signed) * k;
              P.x += bd * corr;
              P.px += bd * corr;
            }
          }
        }
      }
    }
  }
}
// =========================================================
  // Cape physics (WORLD space)
  // A small 2-column strip simulated with Verlet + PBD constraints.
  // This is much closer to Noita's cape feel: stable, dynamic, and cheap.
  // =========================================================
  class CapeClothXPBD {
    constructor(opts = {}) {
      this.W = opts.W ?? 2;
      this.H = opts.H ?? 12;
      this.thickness = opts.thickness ?? 1.2;

      this.substeps = opts.substeps ?? 2;
      this.iterations = opts.iterations ?? 14;

      this.gravity = opts.gravity ?? 650;     // px/s^2 (y+ downward)
      this.airDrag = opts.airDrag ?? 10.0;    // 0..inf (bigger = more flutter + lift)
      this.damping = opts.damping ?? 0.992;   // 0..1 (position damping in verlet)

      // Constraint stiffness per family
      this.stretchStiffness = opts.stretchStiffness ?? 0.95;
      this.shearStiffness = opts.shearStiffness ?? 0.85;
      this.bendStiffness = opts.bendStiffness ?? 0.35;

      // Self collision (prevents the "purple column" collapse)
      this.enableSelf = opts.enableSelf ?? true;
      this.selfRadius = opts.selfRadius ?? 2.0;
      this.selfIterations = opts.selfIterations ?? 1;

      const n = this.W * this.H;
      this.p = new Array(n);
      for (let i = 0; i < n; i++) {
        this.p[i] = { x: 0, y: 0, px: 0, py: 0, invMass: 1 };
      }

      this.constraints = [];
      this._buildConstraints();
      this._recomputeRest();

      this._built = true;
      this._kick = 0;
    }

    idx(u, v) { return v * this.W + u; }

    updateAnchors(anchors) {
      // anchors: [front, back] (WORLD coords)
      this.anchors = anchors;
    }

    // Optional: a small impulse on turn to help the cape swing.
    kickTurn(prevFacing, newFacing) {
      const df = (newFacing - prevFacing);
      if (!df) return;
      this._kick = Math.max(this._kick, Math.min(1, Math.abs(df)));

      // Inject a bit of sideways velocity into the cloth by offsetting previous positions.
      // (P.x - P.px) is the implicit velocity direction.
      const impulse = 28 * df; // px/s-ish
      const h = 1 / 60;
      for (let v = 1; v < this.H; v++) {
        const tV = v / (this.H - 1);
        for (let u = 0; u < this.W; u++) {
          const P = this.p[this.idx(u, v)];
          if (P.invMass === 0) continue;
          // more impulse toward the bottom
          P.px -= impulse * h * (0.2 + 0.8 * tV);
        }
      }
    }

    resetFromAnchors(anchors, cfg = {}) {
      const length = cfg.length ?? 22; // WORLD pixels
      const flare = cfg.flare ?? 6;    // bottom widening in WORLD pixels

      const a0 = anchors[0];
      const a1 = anchors[anchors.length - 1];

      // Direction from front anchor -> back anchor (mostly horizontal)
      let dx = a1.x - a0.x;
      let dy = a1.y - a0.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d; dy /= d;

      for (let v = 0; v < this.H; v++) {
        const tV = (this.H <= 1) ? 0 : (v / (this.H - 1));

        // Drape curve: slightly more sag near the bottom
        const sag = 1.2 * tV * tV;
        const y = a0.y + tV * length + sag;

        // "Widen" the strip towards the bottom by pushing the back edge farther back.
        const extra = flare * tV;

        // Front edge (u=0) stays close to the collar.
        {
          const P = this.p[this.idx(0, v)];
          const x = a0.x + dx * (extra * 0.18);
          P.x = P.px = x;
          P.y = P.py = y;
          // mass gradient: slightly heavier bottom
          P.invMass = (v === 0) ? 0 : (1.0 / (1.0 + 0.9 * tV));
        }

        // Back edge (u=1) flares more.
        if (this.W > 1) {
          const P = this.p[this.idx(1, v)];
          const x = a1.x + dx * extra;
          P.x = P.px = x;
          P.y = P.py = y;
          P.invMass = (v === 0) ? 0 : (1.0 / (1.0 + 0.9 * tV));
        }
      }

      this._recomputeRest();
    }

    _add(i, j, stiff) {
      this.constraints.push({ i, j, rest: 0, stiff });
    }

    _buildConstraints() {
      const W = this.W, H = this.H;
      this.constraints.length = 0;

      // Vertical stretch (each column)
      for (let v = 0; v < H - 1; v++) {
        for (let u = 0; u < W; u++) {
          this._add(this.idx(u, v), this.idx(u, v + 1), this.stretchStiffness);
        }
      }

      // Horizontal stretch (width)
      for (let v = 0; v < H; v++) {
        for (let u = 0; u < W - 1; u++) {
          this._add(this.idx(u, v), this.idx(u + 1, v), this.stretchStiffness);
        }
      }

      // Shear (diagonals)
      for (let v = 0; v < H - 1; v++) {
        for (let u = 0; u < W - 1; u++) {
          this._add(this.idx(u, v), this.idx(u + 1, v + 1), this.shearStiffness);
          this._add(this.idx(u + 1, v), this.idx(u, v + 1), this.shearStiffness);
        }
      }

      // Bend (distance 2)
      for (let v = 0; v < H - 2; v++) {
        for (let u = 0; u < W; u++) {
          this._add(this.idx(u, v), this.idx(u, v + 2), this.bendStiffness);
        }
      }
    }

    _recomputeRest() {
      for (const c of this.constraints) {
        const A = this.p[c.i], B = this.p[c.j];
        c.rest = Math.hypot(B.x - A.x, B.y - A.y);
      }
    }

    _solveDist(c) {
      const A = this.p[c.i];
      const B = this.p[c.j];
      const wA = A.invMass, wB = B.invMass;
      const w = wA + wB;
      if (w <= 0) return;

      let dx = B.x - A.x;
      let dy = B.y - A.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-6) return;

      const diff = (dist - c.rest) / dist;
      const s = c.stiff;

      const corrX = dx * diff * s;
      const corrY = dy * diff * s;

      A.x += corrX * (wA / w);
      A.y += corrY * (wA / w);
      B.x -= corrX * (wB / w);
      B.y -= corrY * (wB / w);
    }

    _collideParticle(P, col) {
      if (col.type === 'circle') {
        let dx = P.x - col.x;
        let dy = P.y - col.y;
        const r = (col.r + this.thickness);
        const d2 = dx * dx + dy * dy;
        if (d2 < r * r) {
          let d = Math.sqrt(d2);
          if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
          const nx = dx / d;
          const ny = dy / d;
          const push = r - d;
          P.x += nx * push;
          P.y += ny * push;

          // friction: damp tangential motion by adjusting previous position
          const vx = (P.x - P.px);
          const vy = (P.y - P.py);
          P.px = P.x - vx * 0.82;
          P.py = P.y - vy * 0.82;
        }
      } else if (col.type === 'capsule') {
        const abx = col.bx - col.ax;
        const aby = col.by - col.ay;
        const apx = P.x - col.ax;
        const apy = P.y - col.ay;
        const t = clamp((apx * abx + apy * aby) / (abx * abx + aby * aby + 1e-6), 0, 1);
        const qx = col.ax + abx * t;
        const qy = col.ay + aby * t;
        let dx = P.x - qx;
        let dy = P.y - qy;
        const r = (col.r + this.thickness);
        const d2 = dx * dx + dy * dy;
        if (d2 < r * r) {
          let d = Math.sqrt(d2);
          if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
          const nx = dx / d;
          const ny = dy / d;
          const push = r - d;
          P.x += nx * push;
          P.y += ny * push;

          const vx = (P.x - P.px);
          const vy = (P.y - P.py);
          P.px = P.x - vx * 0.82;
          P.py = P.y - vy * 0.82;
        }
      }
    }

    step(dt, env = {}, colliders = null, timeSec = 0) {
      if (!this._built) return;
      dt = Math.min(dt, 1 / 30);

      const sub = this.substeps;
      const h = dt / sub;
      const windX0 = env.windX || 0;
      const windY0 = env.windY || 0;

      // decay turn kick
      this._kick *= Math.exp(-dt * 8);

      for (let s = 0; s < sub; s++) {
        // 1) Integrate (Verlet)
        for (let i = 0; i < this.p.length; i++) {
          const P = this.p[i];
          if (P.invMass === 0) continue;

          const row = (i / this.W) | 0;
          const tV = (this.H <= 1) ? 0 : (row / (this.H - 1));

          // Velocity in px/s
          const vx = (P.x - P.px) / Math.max(h, 1e-6);
          const vy = (P.y - P.py) / Math.max(h, 1e-6);

          // Aerodynamic response increases towards the bottom
          const aero = 0.25 + 0.75 * tV;

          // Small procedural turbulence (Noita-ish flutter)
          const turbX = Math.sin(P.y * 0.06 + timeSec * 2.1) * 10 * aero;
          const turbY = Math.cos(P.x * 0.07 + timeSec * 1.7) * 4 * aero;

          const windX = windX0 + turbX;
          const windY = windY0 + turbY;

          // Drag acceleration (tries to match velocity to wind)
          const ax = (windX - vx) * this.airDrag * aero;
          const ay = this.gravity + (windY - vy) * this.airDrag * aero;

          // Apply kick from turns as a short-lived sideways wind
          const axKick = (this._kick * 220) * (tV * tV) * Math.sign(windX0 || 1);

          const nx = P.x + (P.x - P.px) * this.damping + (ax + axKick) * h * h;
          const ny = P.y + (P.y - P.py) * this.damping + ay * h * h;

          P.px = P.x;
          P.py = P.y;
          P.x = nx;
          P.y = ny;
        }

        // 2) Apply anchors (top row)
        if (this.anchors && this.anchors.length >= 2) {
          for (let u = 0; u < this.W; u++) {
            const idx = this.idx(u, 0);
            const P = this.p[idx];
            const A = this.anchors[Math.min(u, this.anchors.length - 1)];

            const dx = A.x - P.x;
            const dy = A.y - P.y;
            P.x = A.x;
            P.y = A.y;
            // Move previous pos by same delta so we don't inject huge velocity
            P.px += dx;
            P.py += dy;
            P.invMass = 0;
          }
        }

        // 3) Solve constraints
        for (let it = 0; it < this.iterations; it++) {
          for (const c of this.constraints) this._solveDist(c);

          // Self collision (cheap, N is small)
          if (this.enableSelf && it < this.selfIterations) {
            const rad = this.selfRadius;
            const rad2 = rad * rad;
            for (let i = 0; i < this.p.length; i++) {
              for (let j = i + 1; j < this.p.length; j++) {
                const A = this.p[i];
                const B = this.p[j];
                const dx = B.x - A.x;
                const dy = B.y - A.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < rad2 && d2 > 1e-6) {
                  const d = Math.sqrt(d2);
                  const nx = dx / d;
                  const ny = dy / d;
                  const pen = rad - d;
                  const wA = A.invMass;
                  const wB = B.invMass;
                  const w = wA + wB;
                  if (w > 0) {
                    const s = (pen / w) * 0.5;
                    A.x -= nx * s * wA;
                    A.y -= ny * s * wA;
                    B.x += nx * s * wB;
                    B.y += ny * s * wB;
                  }
                }
              }
            }
          }

          // Colliders
          if (colliders) {
            for (const P of this.p) {
              if (P.invMass === 0) continue;
              for (const col of colliders) this._collideParticle(P, col);
            }
          }
        }
      }
    }
  }

  G.CapeClothXPBD = CapeClothXPBD; // Export
  // Also export the chain cape so other renderers (ex: character ports) can reuse
  // the stable world-space simulation without depending on internal closure scope.
  G.CapeChain = CapeChain;
})();
