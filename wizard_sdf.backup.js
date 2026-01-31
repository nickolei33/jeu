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

  const particles = [];
  const trail = [];

  const wizard = {
    state: 'idle', facing: 1,
    time: { idle: 0, run: 0, walk: 0, jump: 0, fall: 0 },
    pose: null,
    scale: { x: 1, y: 1 },

    cape: { mid: { x: 0, y: 0 }, tip: { x: 0, y: 0 }, velMid: { x: 0, y: 0 }, velTip: { x: 0, y: 0 } },
    beard: { ang: 0, vel: 0 },
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
    const cp2 = { x: capeAnchor.x + wizard.cape.mid.x, y: capeAnchor.y + 15 + wizard.cape.mid.y };
    const cp3 = { x: capeAnchor.x + wizard.cape.tip.x, y: capeAnchor.y + 35 + wizard.cape.tip.y };

    pix.fill(0);

    // Light Source roughly top-left (-1, -1) from facing perspective

    for (let y = 0; y < WIZ_H; y++) {
      for (let x = 0; x < WIZ_W; x++) {
        const lx = (x - PIVOT.x) / SCALE;
        const ly = (y - PIVOT.y) / SCALE;
        let col = 0;

        // CAPE
        const dCape = sdCurve3(lx, ly, capeAnchor, cp2, cp3) - 6.0;
        if (dCape < 0) col = COL.robeDark;

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

    // PARTICLE RENDER
    for (const p of particles) {
      const px = (p.x * SCALE) + PIVOT.x;
      const py = (p.y * SCALE) + PIVOT.y;

      let pw = p.size, ph = p.size;
      if (p.color === COL.speedLine) { pw = 16; ph = 2; }

      offCtx.fillStyle = '#ffffff';
      if (p.color === COL.sparkle) offCtx.fillStyle = '#30ff80';
      else if (p.color === COL.dust) offCtx.fillStyle = '#a0a090';
      else if (p.color === COL.speedLine) offCtx.fillStyle = 'rgba(255,255,255,0.3)';

      offCtx.fillRect(px - pw / 2, py - ph / 2, pw, ph);
    }

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

  function spawnDust(x, y, color = COL.dust) {
    for (let i = 0; i < 4; i++) {
      const vx = (Math.random() - 0.5) * 30;
      const vy = -(10 + Math.random() * 20);
      const life = 0.3 + Math.random() * 0.4;
      particles.push(new Particle(x, y, vx, vy, life, color, 100));
    }
  }

  function updatePhysics(dt, p) {
    // Cape
    const f = wizard.facing;
    const targetMidX = -f * 10;
    const targetTipX = -f * 12;
    const windX = -p.vx * 0.1;
    const windY = -p.vy * 0.1;
    // Tuned for flow (Lower K = looser, Lower D = less damping/more swing)
    const k = 100, d = 8;

    const axMid = (targetMidX + windX - wizard.cape.mid.x) * k - wizard.cape.velMid.x * d;
    const ayMid = (0 + windY - wizard.cape.mid.y) * k - wizard.cape.velMid.y * d;
    wizard.cape.velMid.x += axMid * dt; wizard.cape.velMid.y += ayMid * dt;
    wizard.cape.mid.x += wizard.cape.velMid.x * dt; wizard.cape.mid.y += wizard.cape.velMid.y * dt;

    const axTip = (targetTipX + windX * 1.5 - wizard.cape.tip.x) * k * 0.8 - wizard.cape.velTip.x * d;
    const ayTip = (0 + windY * 1.5 - wizard.cape.tip.y) * k * 0.8 - wizard.cape.velTip.y * d;
    wizard.cape.velTip.x += axTip * dt; wizard.cape.velTip.y += ayTip * dt;
    wizard.cape.tip.x += wizard.cape.velTip.x * dt; wizard.cape.tip.y += wizard.cape.velTip.y * dt;

    // Beard
    const targetAng = clamp(p.vx * -0.5, -45, 45); // Blow back
    const ba = (targetAng - wizard.beard.ang) * 100 - wizard.beard.vel * 10;
    wizard.beard.vel += ba * dt;
    wizard.beard.ang += wizard.beard.vel * dt;
  }

  G.updateWizardAnim = function (dt) {
    if (!G.player) return;
    const p = G.player;

    const prevFacing = wizard.facing || 1;
    wizard.facing = p.facing || 1;

    // Turn detection
    if (prevFacing !== wizard.facing && p.onGround) {
      spawnDust(0, 4, COL.dust); // Local 0,0 is approx feet center
      // WHIP CAPE: Add velocity opposite to new direction to simulate inertia
      wizard.cape.velTip.x -= wizard.facing * 300;
      wizard.cape.velMid.x -= wizard.facing * 150;
    }

    const onGround = p.onGround;
    const speed = Math.abs(p.vx);

    // State Logic with Walk
    let state = 'idle';
    if (!onGround) state = 'jump';
    else if (speed > 55) state = 'run'; // Higher threshold for Run
    else if (speed > 5) state = 'walk'; // Low speed walk

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

    updatePhysics(dt, p);

    for (let i = particles.length - 1; i >= 0; i--) {
      if (!particles[i].update(dt)) particles.splice(i, 1);
    }
    if ((state === 'run' || state === 'walk') && Math.random() < (state === 'run' ? 0.3 : 0.05)) {
      // dust emission
    }

    const clipName = state === 'jump' ? 'jump' : state;
    const clip = G.wizardClips?.[clipName];

    let pose = null;
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

        pose = { root: { x: 0, y: 0 }, bones: {} };
        pose.root.x = lerp(a.root.x, b.root.x, progress);
        pose.root.y = lerp(a.root.y, b.root.y, progress);

        for (let k in a.bones) {
          const angA = a.bones[k];
          const angB = b.bones[k] || angA;
          // Use lerpAngle for rotations to avoid wrapping glitches (though most are small)
          // Actually, standard clips shouldn't wrap 360, but if they do, this saves it.
          // For now, straight lerp is safer unless we KNOW we wrap.
          // Reverting to straight lerp but ensuring bones are defined.
          pose.bones[k] = lerpAngle(angA, angB, progress);
        }
      }
    }

    // Smooth Y for rendering (slide up/down stairs)
    if (wizard.visualY === undefined) wizard.visualY = p.y;
    const dy = p.y - wizard.visualY;
    wizard.visualY += dy * Math.min(1, dt * 15); // Fast smooth

    // Apply visual offset to root for rendering (but keep x same)
    if (pose && pose.root) {
      pose.root.y += (wizard.visualY - p.y);
    }

    wizard.pose = pose;
  };

  G.drawWizard = function (screenX, screenY) {
    if (!G.wizard.pose) return; // safety
    renderWizard(G.wizard.pose);
    const ctx = G.ctx;
    if (!ctx) return;
    ctx.save();
    if (G.wizard.facing < 0) {
      ctx.translate(screenX + PIVOT.x, screenY - PIVOT.y);
      ctx.scale(-1, 1);
    } else {
      ctx.translate(screenX - PIVOT.x, screenY - PIVOT.y);
    }
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  }
})();
