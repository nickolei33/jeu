'use strict';
(() => {
  // =========================================================
  // 5LOC CHARACTER PORT (HI-DEF + CAPE)
  // - Keeps Falling Sand physics/hitbox untouched
  // - Imports the procedural player animation feel from 5loc
  // - Renders larger + more detailed (outline + shading)
  // - Re-uses the stable cape simulation (CapeChain) from wizard_sdf.js
  // =========================================================

  const G = (window.G = window.G || {});

  // ---------------------------------------------------------
  // State
  // ---------------------------------------------------------
  const A = (G.char5loc = G.char5loc || {
    t: 0,
    walkCycle: 0,
    walkRate: 0,
    // Separate phase for airborne legs (longer, playful loop)
    airPhase: 0,
    rig: null,
    // Animation smoothing: time spent off the ground (seconds).
    // This is purely visual (prevents pose flicker on tiny slopes/steps).
    offGroundT: 0,

    // Smoothed kinematics (visual only)
    prevVx: 0,
    ax: 0,

    // Foot planting (visual-only) to reduce foot sliding.
    // We keep world-space pins for each foot during the stance phase.
    footNear: null,
    footFar: null,

    // For detecting contact transitions per leg
    _phaseNearPrev: 0,
    _phaseFarPrev: 0,

    // Hard-turn / pivot animation (visual only)
    // When the facing flips at speed, we briefly plant a pivot foot so the
    // character doesn't look like it's "ice skating" during demi-tours.
    turnT: 0,
    turnPivot: 'near',

    // Dust FX state (ported from wizard_sdf.js so we don't lose particles
    // when overriding G.updateWizardAnim)
    fx: null,
  });

  // ---------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, f) => a + (b - a) * f;
  const smoothstep01 = (t) => t * t * (3 - 2 * t);
  const expS = (dt, k) => 1 - Math.exp(-dt * k);

  // ---------------------------------------------------------
  // Dust FX
  // ---------------------------------------------------------
  // The original sandbox wizard (wizard_sdf.js) spawns dust in
  // G.updateWizardAnim(). Since this file overrides that function, we
  // re-implement the same dust cues here (run steps, turns, jumps, landings).
  const COL_DUST = 0xffa0a090;

  function spawnDust(wx, wy, opt = null, color = COL_DUST) {
    // World-space dust emitter.
    // wx/wy are WORLD coordinates (same space as G.player.x/y).
    if (!G.spawnParticle) return;

    const o = opt || {};
    const dir = (o.dir === undefined) ? 0 : o.dir; // -1..1
    const n = (o.n === undefined) ? 6 : o.n;
    const lift = (o.lift === undefined) ? 1.0 : o.lift;
    const spread = (o.spread === undefined) ? 1.0 : o.spread;
    const size = (o.size === undefined) ? 2 : o.size;

    for (let i = 0; i < n; i++) {
      const jitterX = (Math.random() - 0.5) * 6 * spread;
      const jitterY = (Math.random() - 0.5) * 3;

      // Kick slightly opposite the direction of movement (dir)
      const vx = (-dir * (22 + Math.random() * 34)) + (Math.random() - 0.5) * 28;
      const vy = (-(26 + Math.random() * 48) * lift) + (Math.random() - 0.5) * 14;

      const life = 0.14 + Math.random() * 0.22;
      G.spawnParticle(wx + jitterX, wy + jitterY, vx, vy, life, color, size);

      // Occasionally eject a real pixel from the ground and let it fly as a
      // material particle (Noita-style bridge), then reinsert on impact.
      if (G.ejectCellAsParticle && Math.random() < 0.12) {
        const ex = (wx + jitterX) | 0;
        const ey = ((wy | 0) + 1) | 0;
        const evx = vx * 0.25 + (Math.random() - 0.5) * 18;
        const evy = vy * 0.25;
        G.ejectCellAsParticle(ex, ey, evx, evy, 0.55);
      }
    }
  }

  function normPhase01(rad) {
    const tau = Math.PI * 2;
    let p = rad / tau;
    p = p - Math.floor(p);
    return p;
  }

  // Point (0, len) rotated by angle (canvas coords, +y down)
  function rotDownVec(angleRad, len) {
    return { x: -Math.sin(angleRad) * len, y: Math.cos(angleRad) * len };
  }

  // Pixel-safe stamping
  function drawThickPoint(ctx, x, y, t) {
    const ix = x | 0;
    const iy = y | 0;
    const s = Math.max(1, t | 0);
    const h = (s / 2) | 0;
    ctx.fillRect(ix - h, iy - h, s, s);
  }

  // Bresenham with stamped squares (pixel-ish, stable)
  function drawLineThick(ctx, x0, y0, x1, y1, t) {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const xEnd = Math.round(x1);
    const yEnd = Math.round(y1);

    const dx = Math.abs(xEnd - x);
    const dy = -Math.abs(yEnd - y);
    const sx = x < xEnd ? 1 : -1;
    const sy = y < yEnd ? 1 : -1;
    let err = dx + dy;

    for (;;) {
      drawThickPoint(ctx, x, y, t);
      if (x === xEnd && y === yEnd) break;
      const e2 = err << 1;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  function limb(ctx, x0, y0, x1, y1, w, fill, outline) {
    ctx.fillStyle = outline;
    drawLineThick(ctx, x0, y0, x1, y1, w + 2);
    ctx.fillStyle = fill;
    drawLineThick(ctx, x0, y0, x1, y1, w);
  }

  function rectWithOutline(ctx, x, y, w, h, fill, outline) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    const iw = Math.round(w);
    const ih = Math.round(h);
    ctx.fillStyle = outline;
    ctx.fillRect(ix - 1, iy - 1, iw + 2, ih + 2);
    ctx.fillStyle = fill;
    ctx.fillRect(ix, iy, iw, ih);
  }

  // ---------------------------------------------------------
  // 5loc pose (ported)
  // ---------------------------------------------------------
  const ANIM = {
    WALK_SPEED: 45,
    RUN_SPEED: 85,
    STRIDE_FACTOR: 0.12,
  };

  function getWalkPose(t, speed) {
    const wFactor = Math.min(1.0, Math.abs(speed) / ANIM.WALK_SPEED);
    const hip = Math.sin(t) * (0.18 + wFactor * 0.28);

    const swingPhase = Math.max(0, -Math.cos(t - 0.35));
    const knee = swingPhase * (0.12 + wFactor * 0.55);

    let foot = 0;
    // Gentle heel strike then toe-off (distinct from run)
    if (swingPhase > 0.55) foot = 0.22 + 0.08 * wFactor;
    if (Math.cos(t) > 0.82) foot = -0.12;

    const shoulder = -hip * 0.45;
    const elbow = 0.08 + 0.18 * wFactor;

    return { hip, knee, foot, shoulder, elbow };
  }

  function getRunPose(t) {
    const hip = Math.sin(t) * 1.2 - 0.5;

    const swingPhase = Math.max(0, -Math.cos(t));
    let knee = Math.pow(swingPhase, 0.8) * 2.2;
    if (swingPhase <= 0.1) knee = 0.3;

    let foot = 0;
    if (hip < -0.8) {
      if (knee > 1.0) foot = -0.5;
      else foot = 0.5;
    } else {
      foot = 0.0;
    }

    const shoulder = -Math.sin(t) * 1.6;
    const elbow = 1.9;

    return { hip, knee, foot, shoulder, elbow };
  }

  function blendedPose(t, speed, speedFactor01, isRunning, isJumping, isFalling, offset) {
    const tt = t + offset;
    const walk = getWalkPose(tt, speed);
    const run = getRunPose(tt);

    // Jump/Fall overrides (5loc)
    // IMPORTANT:
    // - Jump uses an explicit pose.
    // - "Falling" (dramatic arms up) should only trigger on *long* falls.
    //   Short airtime on tiny slopes/bumps should keep walk/run arm swing.
    if (isJumping) {
      if (offset === 0) return { hip: -1.5, knee: 2.0, foot: 0.5, shoulder: -2.5, elbow: 0.5 };
      return { hip: 0.5, knee: 0.2, foot: 0.5, shoulder: -0.5, elbow: 0.5 };
    }
    if (isFalling) {
      return { hip: 0, knee: 0.1, foot: -0.2, shoulder: -3.0, elbow: 0.1 };
    }

    // Idle breathing (subtle)
    if (!isRunning) {
      const cfg = (G.CONF && G.CONF.CHAR5LOC) || {};
      const amp = (cfg.idleBreathAmp ?? 0.65);
      // ~0.8 Hz + a tiny harmonic to avoid robotic motion
      const b = (Math.sin(A.t * (Math.PI * 2 * 0.80)) + 0.33 * Math.sin(A.t * (Math.PI * 2 * 1.60))) * amp;
      return { hip: 0, knee: 0, foot: 0, shoulder: -0.08 * b, elbow: 0.06 * b };
    }

    const b = Math.pow(speedFactor01, 1.5);
    return {
      hip: lerp(walk.hip, run.hip, b),
      knee: lerp(walk.knee, run.knee, b),
      foot: lerp(walk.foot, run.foot, b),
      shoulder: lerp(walk.shoulder, run.shoulder, b),
      elbow: lerp(walk.elbow, run.elbow, b),
    };
  }

  function solveLeg(start, pose, thighL, shinL, footL) {
    const hip = pose.hip;
    const kneeAng = pose.knee;
    const footAng = pose.foot;

    const knee = rotDownVec(hip, thighL);
    const ankle = rotDownVec(hip + kneeAng, shinL);
    const foot = rotDownVec(hip + kneeAng + footAng, footL);

    const kneeP = { x: start.x + knee.x, y: start.y + knee.y };
    const ankleP = { x: kneeP.x + ankle.x, y: kneeP.y + ankle.y };
    const footP = { x: ankleP.x + foot.x, y: ankleP.y + foot.y };

    return { knee: kneeP, ankle: ankleP, foot: footP };
  }

  function solveArm(start, pose, armL, foreL) {
    const sh = pose.shoulder;
    const el = pose.elbow;
    const elbow = rotDownVec(sh, armL);
    const hand = rotDownVec(sh - el, foreL);

    const elbowP = { x: start.x + elbow.x, y: start.y + elbow.y };
    const handP = { x: elbowP.x + hand.x, y: elbowP.y + hand.y };

    return { elbow: elbowP, hand: handP };
  }

    // ---------------------------------------------------------
  // Air legs (no "running in the void")
  // ---------------------------------------------------------
  // When airborne, we don't keep cycling the gait. Instead we switch to a
  // dedicated air pose that blends in quickly after takeoff. This avoids the
  // "zombie gliding / running mid-air" look.
  function airLegPose(rig, which) {
    const p = G.player || {};
    const cfg = (G.CONF && G.CONF.CHAR5LOC) || {};

    const vxLocal = (p.vx || 0) * (rig.facing || 1);
    const vy = (p.vy || 0);
    const tAir = (rig.airT || 0);

    // Blend quickly into the air pose after leaving ground (avoid pop)
    const airBlend = smoothstep01(clamp(tAir / 0.08, 0, 1));

    // "Air cycle": longer, playful loop (NOT a run cycle)
    const phase = (A.airPhase || 0) + (which === 'near' ? 0 : Math.PI);
    const scissorAmp = (cfg.airLegScissorAmp ?? 0.22);

    const vx01 = clamp(Math.abs(vxLocal) / 95, 0, 1);
    const trail = clamp(vxLocal / 140, -1, 1);
    const trailAng = trail * 0.28;

    // Time-based tuck (jump) -> release (fall)
    const tuckU = smoothstep01(clamp((tAir - 0.03) / 0.22, 0, 1));
    const extendU = smoothstep01(clamp((vy - 50) / 220, 0, 1));

    // A single "kick" window right after takeoff to make jumps feel animated
    const kick = Math.sin(Math.PI * clamp(tAir / 0.24, 0, 1));

    // Base: start slightly trailing, then tuck forward (anime knee drive),
    // and finally release into a fall/dangle.
    const jumpTuck = (cfg.airJumpTuck ?? 1.0);

    // Negative hip = thigh swings forward (knee up) for facing=1
    let hip = lerp(0.18 + 0.10 * vx01 + 0.40 * trailAng, -0.92 - 0.10 * vx01, tuckU);
    let knee = lerp(0.30, (1.75 + 0.35 * vx01) * jumpTuck, tuckU);
    let foot = lerp(0.10, -0.18, tuckU);

    // Per-leg flavor: near leg tucks more, far leg trails a bit more.
    if (which === 'near') {
      hip -= 0.18;
      knee += 0.22;
      foot -= 0.04;
    } else {
      hip += 0.14;
      knee -= 0.12;
      foot += 0.04;
    }

    // Takeoff kick: quick scissor that reads as "push" instead of mid-air run.
    hip += (which === 'near' ? -1 : 1) * 0.12 * kick;
    knee += 0.18 * kick;

    // In fall, release the tuck and let legs dangle/trail with inertia.
    hip = lerp(hip, 0.24 + 0.08 * vx01 + 0.40 * trailAng, extendU);
    knee = lerp(knee, 0.60, extendU);
    foot = lerp(foot, 0.04, extendU);

    // Long fall: slightly more dangle (but still animated)
    if (rig.isLongFall) {
      hip = lerp(hip, 0.10 + 0.06 * trailAng, 0.55);
      knee = lerp(knee, 0.78, 0.55);
      foot = lerp(foot, -0.06, 0.55);
    }

    // Small scissor motion while falling (longer loop, funny, anime-ish)
    // - very small during ascent
    // - stronger during fall
    const fallSwing = (0.20 + 0.90 * extendU) * (0.35 + 0.65 * vx01);
    const sc = Math.sin(phase) * scissorAmp * fallSwing;
    const sc2 = Math.sin(phase * 0.5 + 1.4) * scissorAmp * 0.35 * fallSwing;
    hip += sc + 0.45 * sc2;
    knee += (-sc) * 0.65 + 0.18 * sc2;
    foot += sc * 0.12;

    // Ensure we don't completely lock the legs straight (keeps life)
    knee = clamp(knee, 0.15, 2.4);

    // Blend from a "frozen" stance at takeoff into the air pose
    const hip0 = 0.0;
    const knee0 = 0.12;
    const foot0 = 0.0;

    return {
      hip: lerp(hip0, hip, airBlend),
      knee: lerp(knee0, knee, airBlend),
      foot: lerp(foot0, foot, airBlend),
    };
  }

  // ---------------------------------------------------------
  // Improved gait (foot plant + IK)
  // ---------------------------------------------------------
  function getGait(rig) {
    const cfg = (G.CONF && G.CONF.CHAR5LOC) || {};

    const absSpeed = rig.absSpeed || 0;
    const runIntent = !!rig.runIntent;
    let run01Raw = clamp((absSpeed - ANIM.WALK_SPEED) / Math.max(1e-6, (ANIM.RUN_SPEED - ANIM.WALK_SPEED)), 0, 1);
    if (!runIntent) run01Raw = 0;
    const run01 = smoothstep01(run01Raw);

    // Speed normalization (used for stride/lift scaling)
    const speedRef = (cfg.runSpeedRef ?? ANIM.RUN_SPEED);
    const speed01 = clamp(absSpeed / Math.max(1e-6, speedRef), 0, 1);

    // Stride length (local units).
    // NOTE: this is multiplied by rig.scale during draw, so values may look large.
    const strideMin = (cfg.strideMin ?? 0.0);
    const strideMax = (cfg.strideMax ?? 12.0);
    // Stride grows fairly quickly with speed so we don't get the
    // "dead legs / gliding" look at medium-high speeds.
    let stride = lerp(strideMin, strideMax, Math.pow(speed01, 0.60));
    // A bit more stride when we're in run territory (anime readability).
    stride *= (1.0 + 0.16 * run01);

    const strideFwd = stride * (0.58 + 0.06 * run01);
    const strideBack = stride * (0.42 - 0.04 * run01);

    // Foot lift during swing (local units)
    const liftMin = (cfg.liftMin ?? 1.2);
    const liftMax = (cfg.liftMax ?? 7.8);
    // Lift: more aggressive in run to get that "anime" knee drive,
    // while foot-plant keeps contact stable.
    const lift = lerp(liftMin, liftMax, Math.pow(speed01, 0.52)) * (0.92 + 0.45 * run01);

    // Stance fraction of the gait cycle (0..1)
    const stanceWalk = (cfg.stanceWalk ?? 0.63);
    const stanceRun = (cfg.stanceRun ?? 0.48);
    const stanceFrac = lerp(stanceWalk, stanceRun, run01);

    // Tiny asymmetry helps the run feel less "robotic"
    const phaseBias = (cfg.phaseBias ?? 0.10) * run01;

    // Mid-swing overshoot (anime readability). Keep it tweakable because
    // too much overshoot makes the far (back) leg look like it "cuts" through
    // the torso silhouette.
    const swingOvershoot = (cfg.swingOvershoot ?? 0.8);

    return {
      speed01,
      run01,
      strideFwd,
      strideBack,
      lift,
      stanceFrac,
      phaseBias,
      swingOvershoot,
    };
  }

  // Apply small per-leg tuning (mainly for the far/back leg)
  // to improve depth readability.
  function gaitForLeg(baseGait, which) {
    if (!baseGait) return baseGait;
    if (which !== 'far') return baseGait;
    const cfg = (G.CONF && G.CONF.CHAR5LOC) || {};
    const strideMul = (cfg.farStrideMul ?? 0.98);
    const liftMul = (cfg.farLiftMul ?? 0.98);
    const overMul = (cfg.farOvershootMul ?? 0.90);
    return {
      ...baseGait,
      strideFwd: baseGait.strideFwd * strideMul,
      strideBack: baseGait.strideBack * strideMul,
      lift: baseGait.lift * liftMul,
      swingOvershoot: (baseGait.swingOvershoot ?? 0.8) * overMul,
    };
  }

  // Balanced phases so any phase bias is distributed symmetrically
  // (prevents one leg from looking "off" relative to the arms).
  function getLegPhases01(tRad, gait) {
    const bias = (gait && gait.phaseBias) ? gait.phaseBias : 0;
    return {
      near01: normPhase01(tRad - bias * 0.5),
      far01: normPhase01(tRad + Math.PI + bias * 0.5),
    };
  }

  function footTargetFromPhase(hipX, phase01, gait, groundY) {
    const s = gait.stanceFrac;
    if (phase01 < s) {
      const u = phase01 / Math.max(1e-6, s);
      // Ease-in/out so stance doesn't look like a perfectly linear slider.
      const e = smoothstep01(clamp(u, 0, 1));
      const stepX = lerp(gait.strideFwd, -gait.strideBack, e);
      return { x: hipX + stepX, y: groundY, contact: true, u };
    }
    const u = (phase01 - s) / Math.max(1e-6, (1 - s));
    const e = smoothstep01(clamp(u, 0, 1));
    // Swing goes forward a bit faster (anime-ish), with a tiny mid-swing overshoot.
    let stepX = lerp(-gait.strideBack, gait.strideFwd, e);
    const over = (gait.swingOvershoot == null) ? 0.8 : gait.swingOvershoot;
    stepX += gait.run01 * over * Math.sin(Math.PI * clamp(u, 0, 1));

    const su = clamp(u, 0, 1);
    const liftShape = Math.pow(Math.sin(Math.PI * su), 0.62);
    const lift = gait.lift * (0.90 + 0.25 * gait.run01) * liftShape;
    return { x: hipX + stepX, y: groundY - lift, contact: false, u };
  }

  function ensureFootPins() {
    if (!A.footNear) A.footNear = { active: false, x: 0, y: 0 };
    if (!A.footFar) A.footFar = { active: false, x: 0, y: 0 };
  }

  function updateFootPins(dt, rig) {
    const p = G.player;
    if (!p || !rig) return;
    ensureFootPins();

    // Leg reach padding: keep a small margin to avoid IK singularities,
    // but not so large that we collapse the reachable X range to ~0.
    // If hip->ground distance is close to full leg length and we clamp
    // too aggressively, the solver forces the foot under the hip and
    // the character appears to "glide" without moving the legs.
    const charCfg = (G.CONF && G.CONF.CHAR5LOC) || {};
    const reachPad = (charCfg.legReachPad ?? 0.25);

    const gait = getGait(rig);
    A._gait = gait;
    const gaitFar = gaitForLeg(gait, 'far');
    const phases = getLegPhases01(A.walkCycle, gait);

    // Hard turn state: keep a pivot foot planted briefly to avoid
    // the "ice skating" look during abrupt direction changes.
    const turnCfg = (G.CONF && G.CONF.CHAR5LOC) || {};
    const turnAnimTime = (turnCfg.turnAnimTime ?? 0.12);
    const turning = (A.turnT || 0) > 0 && rig.onGroundAnim;
    const pivot = turning ? (A.turnPivot || 'near') : null;

    // 0..1 progression inside the turn window (used to force a decisive step)
    const turn01 = turning ? clamp((A.turnT || 0) / Math.max(1e-6, turnAnimTime), 0, 1) : 0;
    const turnU = turning ? (1 - turn01) : 0;
    const turnStepPlantU = (turnCfg.turnStepPlantU ?? 0.58);

    // Only plant feet when truly grounded and moving, OR when we're in a
    // short pivot window.
    const moving = (rig.onGroundAnim && rig.absSpeed > 2.5) || turning;
    if (!moving) {
      A.footNear.active = false;
      A.footFar.active = false;
      return;
    }

    const groundWorldY = p.y;
    const groundLocalY = (groundWorldY - rig.originY) / Math.max(1e-6, rig.scale);

    const phaseNear01 = phases.near01;
    const phaseFar01 = phases.far01;

    // Helpers
    const clampPinReach = (pin, hipLocalX) => {
      const hipXw = rig.originX + hipLocalX * rig.scale * rig.facing;
      const hipYw = rig.originY;
      const dy = pin.y - hipYw;
      const maxReach = (rig.thighL + rig.shinL + rig.footL - reachPad) * rig.scale;
      const maxDx = Math.sqrt(Math.max(0, (maxReach * maxReach) - (dy * dy)));
      const dx = pin.x - hipXw;
      if (Math.abs(dx) > maxDx) {
        pin.x = hipXw + clamp(dx, -maxDx, maxDx);
      }
    };

    const updateLegPin = (pin, hipLocalX, phase01, prevPhase01, gaitUsed) => {
      // If this is the pivot leg during a turn, keep it planted and don't
      // recapture/clear it based on gait phase.
      const isPivot = turning && ((pivot === 'near' && pin === A.footNear) || (pivot === 'far' && pin === A.footFar));
      if (isPivot && pin.active) {
        pin.y = groundWorldY;
        clampPinReach(pin, hipLocalX);
        return;
      }

      // During a hard turn, force the non-pivot leg to perform a fast, decisive
      // step and then plant (prevents the "mou / gliding" demi-tour look).
      if (turning) {
        if (turnU < turnStepPlantU) {
          pin.active = false;
          return;
        }
        // Plant once (at the same target used by draw override).
        if (!pin.active) {
          const stepX = hipLocalX + gaitUsed.strideFwd * 1.25;
          pin.x = rig.originX + stepX * rig.scale * rig.facing;
          pin.y = groundWorldY;
          pin.active = true;
        } else {
          pin.y = groundWorldY;
        }
        clampPinReach(pin, hipLocalX);
        return;
      }

      const contact = phase01 < gaitUsed.stanceFrac;

      if (!contact) {
        pin.active = false;
        return;
      }

      // On (re)contact, capture the nominal touchdown position.
      if (!pin.active || (prevPhase01 > gait.stanceFrac && phase01 < gait.stanceFrac)) {
        const nom = footTargetFromPhase(hipLocalX, phase01, gaitUsed, groundLocalY);
        pin.x = rig.originX + nom.x * rig.scale * rig.facing;
        pin.y = groundWorldY;
        pin.active = true;
      }

      // Always follow the player's ground y (slopes/steps).
      pin.y = groundWorldY;

      // Prevent extreme over-stretch (causes 1-2 frame "rubber band" glitches).
      clampPinReach(pin, hipLocalX);
    };

    updateLegPin(A.footNear, 1.5, phaseNear01, A._phaseNearPrev || 0, gait);
    updateLegPin(A.footFar, -1.5, phaseFar01, A._phaseFarPrev || 0, gaitFar);

    A._phaseNearPrev = phaseNear01;
    A._phaseFarPrev = phaseFar01;
  }

  // 2-bone IK in local character space (x right, y down)
  function solveTwoBoneIK(hip, ankle, L1, L2) {
    let dx = ankle.x - hip.x;
    let dy = ankle.y - hip.y;
    let d = Math.hypot(dx, dy);

    // Avoid singularities
    const eps = 1e-4;
    if (d < eps) {
      d = eps;
      dx = eps;
      dy = 0;
    }

    // Clamp distance to reachable range
    const minD = Math.abs(L1 - L2) + eps;
    const maxD = (L1 + L2) - eps;
    const dc = clamp(d, minD, maxD);

    const ux = dx / d;
    const uy = dy / d;

    // Point along the line from hip to ankle
    const a = (L1 * L1 - L2 * L2 + dc * dc) / (2 * dc);
    const h2 = Math.max(0, (L1 * L1) - (a * a));
    const h = Math.sqrt(h2);

    const px = hip.x + ux * a;
    const py = hip.y + uy * a;

    // Perpendicular
    const perpX = -uy;
    const perpY = ux;

    // Two candidates (pick the one that bends "forward" i.e. +x)
    const k1 = { x: px + perpX * h, y: py + perpY * h };
    const k2 = { x: px - perpX * h, y: py - perpY * h };
    return (k1.x >= k2.x) ? k1 : k2;
  }

  function solveLegGait(hip, pin, phase01, gait, groundLocalY, thighL, shinL, footL, rig, override) {
    // Foot target in local space
    let foot = null;
    let contact = false;
    let swingU = 0;

    // Optional override (used for snappy demi-turn step)
    if (override && override.enabled) {
      foot = { x: override.x, y: override.y };
      contact = !!override.contact;
      swingU = override.swingU || 0;
    }

    const moving = rig.onGroundAnim && rig.absSpeed > 2.5;
    if (!foot && moving && pin && pin.active) {
      // Use planted world pin (converted to local)
      foot = {
        x: (pin.x - rig.originX) / (Math.max(1e-6, rig.scale) * rig.facing),
        y: groundLocalY,
      };
      contact = true;
    } else if (!foot) {
      const t = footTargetFromPhase(hip.x, phase01, gait, groundLocalY);
      foot = { x: t.x, y: t.y };
      contact = moving ? t.contact : true;
      swingU = t.u;
    }

    // Clamp foot target to reachable range (safety, also removes glitchy spikes).
    // IMPORTANT: keep the padding small; if maxReach < hip->ground distance,
    // the clamp collapses stride to ~0 and the character "slides".
    {
      const charCfg = (G.CONF && G.CONF.CHAR5LOC) || {};
      const reachPad = (charCfg.legReachPad ?? 0.25);
      const maxReach = (thighL + shinL + footL - reachPad);
      const dx = foot.x - hip.x;
      const dy = foot.y - hip.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > maxReach) {
        const s = maxReach / d;
        foot.x = hip.x + dx * s;
        foot.y = hip.y + dy * s;
      }
    }

    // Foot orientation (heel->toe roll on stance, toe dip on swing)
    let footVecX = footL;
    let footVecY = 0;
    if (!contact) {
      // Toe dips slightly during swing, and flattens near landing
      const land01 = 1 - clamp((1 - swingU) * 3.0, 0, 1);
      footVecX = footL * lerp(0.72, 1.00, land01);
      footVecY = footL * lerp(0.30, 0.00, land01);
    } else if (moving) {
      // Stance roll: heel strike (toe up) -> flat -> push off (toe down)
      const s = Math.max(1e-6, gait.stanceFrac);
      const u = clamp(phase01 / s, 0, 1);
      if (u < 0.35) {
        const k = u / 0.35;
        const toeUp = lerp(0.30, 0.00, smoothstep01(k));
        footVecY = -footL * toeUp;
        footVecX = footL * lerp(0.86, 1.00, k);
      } else {
        const k = (u - 0.35) / 0.65;
        const toeDown = lerp(0.00, 0.18, smoothstep01(k));
        footVecY = footL * toeDown;
      }
    }

    const ankle = { x: foot.x - footVecX, y: foot.y - footVecY };
    const knee = solveTwoBoneIK(hip, ankle, thighL, shinL);

    return { knee, ankle, foot };
  }

  // ---------------------------------------------------------
  // Rig compute (WORLD)
  // ---------------------------------------------------------
  function computeRigWorld(p) {
    const w = (G.wizard || {});
    const facing = ((w.facing === undefined || w.facing === null) ? (p.facing || 1) : w.facing) >= 0 ? 1 : -1;
    const speed = (p.vx || 0);
    const absSpeed = Math.abs(speed);
    const onGroundPhys = !!p.onGround;
    const vy = (p.vy || 0);

    // -----------------------------------------------------
    // Visual hysteresis (anti-flicker): keep "grounded" poses
    // for a short grace window after leaving the ground.
    // Prevents blinking into the fall pose when moving across
    // tiny slopes/steps where onGround can toggle for 1 frame.
    // -----------------------------------------------------
    const charCfg = (G.CONF && G.CONF.CHAR5LOC) || {};
    const fallAnimDelay = (charCfg.fallAnimDelay ?? 0.10); // seconds
    const fallImmediateVy = (charCfg.fallImmediateVy ?? 220); // px/s (bypass grace when really falling)
    const groundGraceVy = (charCfg.groundGraceVy ?? -25); // don't apply grace if strongly moving upward

    const airT = (A.offGroundT || 0);
    const onGroundAnim = onGroundPhys || (!A.jumpLock &&
      airT < fallAnimDelay &&
      vy > groundGraceVy &&
      vy < fallImmediateVy
    );

    // Two-stage fall logic:
    // - short airtime (bumps/slopes/steps) keeps walk/run arm swing
    // - "long fall" triggers the dramatic arms-up fall pose
    const longFallDelay = (charCfg.longFallDelay ?? 0.28);
    const longFallVy = (charCfg.longFallVy ?? 320);
    const isJumping = !onGroundAnim && vy < -10;
    const isFalling = !onGroundAnim && vy > 10;
    const isLongFall = isFalling && (vy > 60) && (airT > longFallDelay || vy > longFallVy);

    // Keep move-arm animation briefly after leaving the ground.
    // This removes the recurrent "arms pop" when traversing small slopes.
    const airMoveGrace = (charCfg.airMoveGrace ?? 0.20);
    const moveArms = (absSpeed > 3) && (onGroundAnim || airT < airMoveGrace);

    const runIntent = !!p.sprinting;
    const isRunning = (onGroundAnim && absSpeed > 8 && runIntent);

    let blend = 0;
    if (runIntent && absSpeed > ANIM.WALK_SPEED) {
      blend = (absSpeed - ANIM.WALK_SPEED) / Math.max(1e-6, (ANIM.RUN_SPEED - ANIM.WALK_SPEED));
    }
    blend = clamp(blend, 0, 1);

    // 5loc body metrics (units)
    const thighL = 11, shinL = 11;
    const armL = 10, foreL = 10;
    const torsoH = 16, headS = 10;
    const footL = 4;

    // Make the character larger than the hitbox (like the original wizard)
    // while keeping physics untouched.
    const figureH = 52;
    const VIS_MUL = 1.60; // larger + higher definition
    const scale = Math.max(0.25, (p.h / figureH) * VIS_MUL);

    const t = A.walkCycle;

    // Hip bounce (ported)
    let hipYOffset = 0;
    if (onGroundAnim && absSpeed > 10) {
      const walkBounce = -Math.abs(Math.sin(t)) * 2.0 + 1.0;
      const runBounce = Math.abs(Math.sin(t)) * -3.0;
      const bodyBounce = (walkBounce * (1 - blend)) + (runBounce * blend);
      hipYOffset += bodyBounce;
    }

    // WORLD origin (hip/root)
    // IMPORTANT:
    // If the hip is placed exactly at full leg extension (hip->ground == legLen),
    // the reachable X range collapses to ~0 (maxDx ≈ 0). That makes the gait look
    // like the character is "gliding" with "dead" legs.
    //
    // To get a believable walk/run, we keep a small amount of "slack" (hipDrop)
    // so the knees stay slightly bent, allowing real stride + foot planting.
    const legLen = (thighL + shinL + footL);
    const runSpeedRef = (charCfg.runSpeedRef ?? 90);
    const speed01 = clamp(absSpeed / Math.max(1e-6, runSpeedRef), 0, 1);

    const hipDropIdle = (charCfg.hipDropIdle ?? 1.2); // local units
    const hipDropRun = (charCfg.hipDropRun ?? 4.2);   // local units
    let hipDrop = lerp(hipDropIdle, hipDropRun, Math.pow(speed01, 0.75));
    if (!onGroundAnim) hipDrop = hipDropIdle; // keep straighter in the air

    let originY = p.y - legLen * scale + hipDrop * scale;

    // Keep some bounce, but don't let it fully remove the slack.
    const hipBounceScale = (charCfg.hipBounceScale ?? 0.35);
    originY += hipYOffset * scale * hipBounceScale;

    // Idle breathing: subtle up/down motion when standing still.
    // (Also helps the cape feel alive.)
    const idle01 = (onGroundAnim && absSpeed < 2.5) ? clamp(1 - (absSpeed / 2.5), 0, 1) : 0;
    if (idle01 > 0) {
      const amp = (charCfg.idleBreathAmp ?? 0.65);
      const breath = (Math.sin(A.t * (Math.PI * 2 * 0.80)) + 0.33 * Math.sin(A.t * (Math.PI * 2 * 1.60))) * amp * idle01;
      originY += breath * scale;
    }

    return {
      facing,
      speed,
      absSpeed,
      onGround: onGroundPhys,
      onGroundAnim,
      isJumping,
      isFalling,
      isLongFall,
      isRunning,
      runIntent,
      moveArms,
      airT,
      blend,
      scale,
      originX: p.x,
      originY,
      // metrics for anchor/colliders
      thighL,
      shinL,
      armL,
      foreL,
      torsoH,
      headS,
      footL,
    };
  }

  // ---------------------------------------------------------
  // Cape helpers
  // ---------------------------------------------------------
  function ensureCapeSim() {
    const w = (G.wizard = G.wizard || {});
    if (w.capeSim) return w.capeSim;

    const C = (G.CONF && G.CONF.CAPE) || {};
    if (!G.CapeChain) {
      // wizard_sdf.js should export G.CapeChain; if not, we silently skip.
      return null;
    }

    w.capeSim = new G.CapeChain({
      length: (C.length ?? 22),
      links: (C.links ?? 14),

      wTop: (C.wTop ?? 2.0),
      wBot: (C.wBot ?? 5.0),

      substeps: (C.substeps ?? 2),
      iterations: (C.iterations ?? 8),
      gravity: (C.gravity ?? 900),
      damping: (C.damping ?? 0.995),
      dragX: (C.dragX ?? 6.0),
      dragY: (C.dragY ?? 3.2),
      bend: (C.bend ?? 0.10),

      thickness: (C.thickness ?? 1.4),
      friction: (C.friction ?? 0.55),
      collideFrom: (C.collideFrom ?? 3),

      turnTeleportDist: (C.turnTeleportDist ?? 7.5),
      turnRebase: (C.turnRebase ?? 0.85),
      maxDispPerSubstep: (C.maxDispPerSubstep ?? 10.0),
      maxSegStretch: (C.maxSegStretch ?? 1.25),

      kickImpulse: (C.kickImpulse ?? 42),
      kickAccel: (C.kickAccel ?? 520),
    });

    return w.capeSim;
  }

  function stepCape(dt, rig) {
    const p = G.player;
    if (!p || !rig) return;

    const w = (G.wizard = G.wizard || {});
    const capeSim = ensureCapeSim();
    if (!capeSim) return;

    // Turn grace timer
    if (w._capeNoBodyCollideT) w._capeNoBodyCollideT = Math.max(0, w._capeNoBodyCollideT - dt);

    const capeCfg = (G.CONF && G.CONF.CAPE) || {};

    const frontDir = rig.facing;
    const backDir = -frontDir;
    const speed01 = clamp(rig.absSpeed / 80, 0, 1);
    const fall01 = clamp(((p.vy || 0) - 8) / 180, 0, 1);

    // Anchor: upper-back, behind the torso, based on the same rig coords as drawing.
    // Local coordinates are in 5loc units (hip at 0,0; torso goes to -torsoH).
    const axLocal = -3.8;
    const ayLocal = -rig.torsoH + 4.2;
    const anchor = {
      x: rig.originX + axLocal * rig.scale * frontDir + backDir * 0.5,
      y: rig.originY + ayLocal * rig.scale,
    };

    // Relative wind (WORLD px/s)
    const tNoise = A.t;
    const windX = (-p.vx * 1.05)
      + backDir * (0.25 + 38.0 * speed01 + 240.0 * fall01)
      + Math.sin(tNoise * 0.9) * 2.0;
    const windY = (-p.vy * (1.05 + 1.15 * fall01))
      + Math.cos(tNoise * 1.3) * 1.2;

    const dragXMul = 1.0 + 0.20 * speed01 + 0.95 * fall01;
    const dragYMul = 1.0 + 3.2 * fall01;

    // Colliders (WORLD)
    const colliders = [];
    const noBody = (w._capeNoBodyCollideT || 0) > 0;
    if (!noBody) {
      const torsoHalfW = 6 * rig.scale;
      const torsoR = Math.max(3.0, torsoHalfW * 0.95);
      const headR = Math.max(2.8, (rig.headS * rig.scale) * 0.45);

      const bias = frontDir * (1.3 + torsoHalfW * 0.25);

      const headY = rig.originY + (-rig.torsoH - rig.headS * 0.55) * rig.scale;
      const torsoTopY = rig.originY + (-rig.torsoH + 2.0) * rig.scale;
      const torsoBotY = rig.originY + (-2.0) * rig.scale;

      colliders.push(
        { type: 'circle', x: rig.originX + bias, y: headY, r: headR },
        { type: 'capsule', ax: rig.originX + bias, ay: torsoTopY, bx: rig.originX + bias, by: torsoBotY, r: torsoR },
        { type: 'circle', x: anchor.x + frontDir * 1.0, y: anchor.y + 2.0, r: Math.max(2.2, 3.2 * rig.scale) },
      );
    }

    if (rig.onGround) {
      colliders.push({ type: 'capsule', ax: p.x - 200, ay: p.y + 1, bx: p.x + 200, by: p.y + 1, r: 1.0 });
    }

    // Turn helper (same as wizard_sdf)
    const turnNoCollideTime = (capeCfg.turnNoCollideTime ?? 0.12);
    const keepBehind01 = (noBody && turnNoCollideTime > 1e-6)
      ? clamp((w._capeNoBodyCollideT || 0) / turnNoCollideTime, 0, 1)
      : 0;

    capeSim.step(
      dt,
      anchor,
      {
        windX,
        windY,
        fall01,
        dragXMul,
        dragYMul,
        keepBehind01,
        keepBehindDist: (capeCfg.keepBehindDist ?? 0.8),
        keepBehindStiff: (capeCfg.keepBehindStiff ?? 0.42),
      },
      colliders,
      backDir,
      tNoise
    );
  }

  function drawCape(screenX, screenY) {
    const ctx = G.ctx;
    const p = G.player;
    const w = G.wizard;
    if (!ctx || !p || !w || !w.capeSim || !w.capeSim.points || w.capeSim.points.length < 2) return;

    const pts = w.capeSim.points;

    // Project WORLD -> screen
    const project = (P) => {
      return {
        x: Math.round(screenX + (P.x - p.x)),
        y: Math.round(screenY + (P.y - p.y)),
      };
    };

    // Palette (matches wizard cape)
    const cDark = '#4a1570';
    const cMid = '#6a2590';
    const cLit = '#8a45b0';
    const cOut = '#0b0710';

    const facing = (((G.wizard && G.wizard.facing !== undefined) ? G.wizard.facing : (p.facing || 1)) >= 0) ? 1 : -1;
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
      tx /= tl;
      ty /= tl;

      // Normal
      let nx = -ty;
      let ny = tx;

      // Force normal toward "back" side
      if (nx * bSign < 0) {
        nx = -nx;
        ny = -ny;
      }

      const tV = (pts.length <= 1) ? 0 : (i / (pts.length - 1));
      let wBack = lerp(w.capeSim.wTop, w.capeSim.wBot, tV);
      let wFront = wBack * 0.28;

      // Taper at root to avoid hard top fold
      const taper = 0.65 + 0.35 * tV;
      wBack *= taper;
      wFront *= taper;

      backEdge[i] = { x: P.x + nx * wBack, y: P.y + ny * wBack };
      frontEdge[i] = { x: P.x - nx * wFront, y: P.y - ny * wFront };
    }

    // Draw quads per segment
    for (let i = 0; i < pts.length - 1; i++) {
      const b0 = project(backEdge[i]);
      const b1 = project(backEdge[i + 1]);
      const f1 = project(frontEdge[i + 1]);
      const f0 = project(frontEdge[i]);

      // Curvature shading hint
      const dx0 = pts[i + 1].x - pts[i].x;
      const dy0 = pts[i + 1].y - pts[i].y;
      const dx1 = (i < pts.length - 2) ? (pts[i + 2].x - pts[i + 1].x) : dx0;
      const dy1 = (i < pts.length - 2) ? (pts[i + 2].y - pts[i + 1].y) : dy0;
      const l0 = Math.hypot(dx0, dy0) || 1;
      const l1 = Math.hypot(dx1, dy1) || 1;
      const t0x = dx0 / l0, t0y = dy0 / l0;
      const t1x = dx1 / l1, t1y = dy1 / l1;
      const bend = Math.abs(t0x * t1y - t0y * t1x);

      const tSeg = (pts.length <= 2) ? 0 : (i / (pts.length - 2));
      let shade = 0.56 - 0.22 * tSeg + 0.30 * bend;
      if (((i + (G.frameId || 0)) % 5) === 0) shade += 0.05;

      let col = cDark;
      if (shade > 0.73) col = cLit;
      else if (shade > 0.50) col = cMid;

      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(b0.x, b0.y);
      ctx.lineTo(b1.x, b1.y);
      ctx.lineTo(f1.x, f1.y);
      ctx.lineTo(f0.x, f0.y);
      ctx.closePath();
      ctx.fill();
    }

    // Simple outline on the back edge (helps readability)
    ctx.fillStyle = cOut;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = project(backEdge[i]);
      const b = project(backEdge[i + 1]);
      drawLineThick(ctx, a.x, a.y, b.x, b.y, 2);
    }
  }

  // ---------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------
  G.updateWizardAnim = function updateChar5loc(dt) {
    const p = G.player;
    if (!p) return;

    A.t += dt;

        // -----------------------------------------------------
    // Grounded hysteresis timer
    // (used by pose selection AND to stop running in mid-air)
    // -----------------------------------------------------
    if (p.onGround) A.offGroundT = 0;
    else A.offGroundT = Math.min(1.0, (A.offGroundT || 0) + dt);

    // Air leg phase: a slower, dedicated cycle so jump/fall legs feel
    // animated (longer loop) without looking like "running" mid-air.
    if (p.onGround) {
      A.airPhase = 0;
    } else {
      const cfg = (G.CONF && G.CONF.CHAR5LOC) || {};
      const hz = (cfg.airLegCycleHz ?? 1.35);
      const tau = Math.PI * 2;
      A.airPhase = ((A.airPhase || 0) + dt * tau * hz) % tau;
    }

    // Jump lock: if we left the ground with an upward impulse, don't apply
    // the grounded grace during the airtime (prevents "running in air" along the arc).
    if (A._wasGround === undefined) A._wasGround = !!p.onGround;
    if (A._wasGround && !p.onGround && (p.vy || 0) < -20) A.jumpLock = true;
    if (p.onGround) A.jumpLock = false;
    A._wasGround = !!p.onGround;

    // -----------------------------------------------------
    // Facing / turn detection (cape, dust, pivot)
    // -----------------------------------------------------
    const w = (G.wizard = G.wizard || {});

    const charCfg = (G.CONF && G.CONF.CHAR5LOC) || {};
    const turnAnimTime = (charCfg.turnAnimTime ?? 0.14);
    const turnMinSpeed = (charCfg.turnMinSpeed ?? 12);
    const turnCycleMul = (charCfg.turnCycleMul ?? 0.10);
    const turnFaceFlipU = (charCfg.turnFaceFlipU ?? 0.55);

    // Velocity-based facing (matches player.js hysteresis)
    const velFacing = ((p.facing || 1) >= 0) ? 1 : -1;

    // Intent direction from input: lets us start the skid/pivot earlier than
    // the vx sign flip, so demi-tours read as animated instead of "mou".
    const inp = G.input || {};
    const intentDir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const intentFacing = (intentDir !== 0) ? intentDir : velFacing;

    // Tick down existing turn timer (visual-only)
    A.turnT = Math.max(0, (A.turnT || 0) - dt);

    // Speed up the end of the visual turn when the physics has already
    // finished braking / re-accelerating. This removes the remaining
    // "floating / gliding" frames.
    if ((A.turnT || 0) > 0 && p.onGround) {
      const vxNow = (p.vx || 0);
      const to = (A.turnToFacing || intentFacing);

      // If we are nearly stopped, progress the turn faster so the pivot
      // doesn't linger.
      if (Math.abs(vxNow) < 2.2) {
        A.turnT = Math.max(0, (A.turnT || 0) - dt * 2.6);
      }

      // If we're already moving in the new direction, snap out faster.
      if (to && (vxNow * to > 0) && Math.abs(vxNow) > (turnMinSpeed * 0.55)) {
        A.turnT = Math.max(0, (A.turnT || 0) - dt * 4.0);
      }
    }

    // Detect a hard turn when intent opposes current velocity while grounded.
    let turnStart = false;
    const wantTurn = p.onGround && intentDir !== 0 && intentFacing !== velFacing && Math.abs(p.vx || 0) > turnMinSpeed;

    if ((A.turnT || 0) <= 0 && wantTurn) {
      A.turnT = turnAnimTime;
      A.turnFromFacing = velFacing;
      A.turnToFacing = intentFacing;
      A.turnVx0 = (p.vx || 0);
      turnStart = true;

      // Dust burst at the feet when starting the skid.
      spawnDust(p.x, p.y, { dir: velFacing, n: 12, lift: 0.95, spread: 1.05, size: 2 }, COL_DUST);

      // Cape turn kick + brief collision grace so it can swap sides smoothly.
      const capeSim = ensureCapeSim();
      if (capeSim && typeof capeSim.kickTurn === 'function') {
        capeSim.kickTurn(velFacing, intentFacing, Math.abs(p.vx || 0));
      }
      const capeCfg = (G.CONF && G.CONF.CAPE) || {};
      w._capeNoBodyCollideT = Math.max(w._capeNoBodyCollideT || 0, (capeCfg.turnNoCollideTime ?? 0.12));
    }

    // Also handle "passive" facing flips (e.g., bounce / friction sign change)
    // by kicking the cape and a small dust puff.
    const prevVelFacing = w._prevVelFacing || velFacing;
    if (prevVelFacing !== velFacing && p.onGround) {
      spawnDust(p.x, p.y, { dir: prevVelFacing, n: 8, lift: 0.85, spread: 0.95, size: 2 }, COL_DUST);
      const capeSim = ensureCapeSim();
      if (capeSim && typeof capeSim.kickTurn === 'function') {
        capeSim.kickTurn(prevVelFacing, velFacing, Math.abs(p.vx || 0));
      }
      const capeCfg = (G.CONF && G.CONF.CAPE) || {};
      w._capeNoBodyCollideT = Math.max(w._capeNoBodyCollideT || 0, (capeCfg.turnNoCollideTime ?? 0.12));
    }
    w._prevVelFacing = velFacing;

    // Visual facing: during a turn, keep the old facing for a short moment,
    // then snap to the new facing. This makes the demi-tour feel animated.
    let visualFacing = velFacing;
    if ((A.turnT || 0) > 0 && p.onGround) {
      const u = 1 - clamp((A.turnT || 0) / Math.max(1e-6, turnAnimTime), 0, 1);
      visualFacing = (u < turnFaceFlipU) ? (A.turnFromFacing || velFacing) : (A.turnToFacing || velFacing);
    }
    w.facing = visualFacing;

    // -----------------------------------------------------
    // Visual grounded flag for animation decisions
    // (same logic as computeRigWorld; used here to stop gait in-air)
    // -----------------------------------------------------
    const fallAnimDelay = (charCfg.fallAnimDelay ?? 0.10);
    const fallImmediateVy = (charCfg.fallImmediateVy ?? 220);
    const groundGraceVy = (charCfg.groundGraceVy ?? -25);
    const airT = (A.offGroundT || 0);
    const onGroundAnim = !!p.onGround || (!A.jumpLock &&
      airT < fallAnimDelay &&
      (p.vy || 0) > groundGraceVy &&
      (p.vy || 0) < fallImmediateVy
    );

// -----------------------------------------------------
    // Smoothed velocity-driven gait cycle
    // - reduces "moulin à jambes" at high speed
    // - keeps continuity when stopping/starting (less popping)
    // -----------------------------------------------------
    {
      const speed = Math.abs(p.vx || 0);
      const runIntent = !!p.sprinting;
      const eff = runIntent
        ? Math.min(speed, ANIM.RUN_SPEED * 1.25)
        : Math.min(speed, ANIM.WALK_SPEED);
      const speed01 = clamp(eff / Math.max(1e-6, ANIM.RUN_SPEED), 0, 1);

      // Cadence tuning:
      // We *slightly* compress cadence at very high speed to avoid the
      // "moulin à jambes" look, but we keep it high enough so the stride
      // doesn't turn into zombie-like gliding.
      const freqMul = lerp(1.05, 0.95, speed01);
      const baseRate = eff * ANIM.STRIDE_FACTOR * freqMul * (runIntent ? 1.0 : 0.60);

      // Blend toward a more physically-consistent cadence at higher speeds
      // so the planted foot doesn't have to "slide" to keep up.
      // (Low speeds keep the calmer base cadence.)
      let desiredRate = baseRate;
      if (eff > 2.0) {
        // Same visual scale as computeRigWorld (keep in sync).
        const figureH = 52;
        const VIS_MUL = 1.60;
        const scl = Math.max(0.25, (p.h / figureH) * VIS_MUL);

        const gait = getGait({ absSpeed: eff, runIntent: !!p.sprinting });
        const strideTotalWorld = (gait.strideFwd + gait.strideBack) * scl;
        if (strideTotalWorld > 1e-3) {
          const physRate = (Math.PI * 2) * eff * gait.stanceFrac / strideTotalWorld;
          const cfg = (G.CONF && G.CONF.CHAR5LOC) || {};
          const speedRef2 = (cfg.runSpeedRef ?? 78);
          const wPhys = smoothstep01(clamp(eff / Math.max(1e-6, speedRef2), 0, 1));
          desiredRate = lerp(baseRate, physRate, 0.75 * wPhys);
        }
      }

      A.walkRate = lerp(A.walkRate || 0, desiredRate, expS(dt, 12));
      // During a hard turn, freeze the cycle very briefly (plant reads), then
      // allow a slow advance. This makes demi-tours feel "snappy" instead of
      // "mou / skating".
      let cycleMul = 1.0;
      if ((A.turnT || 0) > 0 && p.onGround) {
        const cfg = (G.CONF && G.CONF.CHAR5LOC) || {};
        const tt = (cfg.turnAnimTime ?? turnAnimTime);
        const tu = 1 - clamp((A.turnT || 0) / Math.max(1e-6, tt), 0, 1);
        cycleMul = (tu < 0.35) ? 0.02 : (turnCycleMul ?? 0.10);
      }
      if (speed > 1.5 && onGroundAnim) A.walkCycle += dt * A.walkRate * cycleMul;
      else A.walkRate *= 0.90;
    }

    // Smoothed horizontal acceleration (for upper-body lag)
    {
      const vx = (p.vx || 0);
      const axNow = (vx - (A.prevVx || 0)) / Math.max(1e-6, dt);
      A.prevVx = vx;
      A.ax = lerp(A.ax || 0, axNow, expS(dt, 10));
    }

    // Compute rig once per tick so draw and cape share the same anchor logic
    const rig = (A.rig = computeRigWorld(p));

    // If a turn just started, select a pivot foot and (re)plant it so the
    // demi-tour reads as a real pivot rather than sliding.
    if (turnStart && rig.onGroundAnim) {
      const gaitBase = getGait(rig);
      A._gait = gaitBase;
      const gaitFar = gaitForLeg(gaitBase, 'far');
      const phases = getLegPhases01(A.walkCycle, gaitBase);
      const cNear = phases.near01 < gaitBase.stanceFrac;
      const cFar = phases.far01 < gaitBase.stanceFrac;

      // Choose pivot: prefer the leg that is currently in stance.
      let pivot = 'near';
      if (cFar && !cNear) pivot = 'far';
      else if (cNear && cFar) {
        // If both are in stance, pick the one closer to mid-stance (more stable).
        const mid = gaitBase.stanceFrac * 0.5;
        pivot = (Math.abs(phases.near01 - mid) <= Math.abs(phases.far01 - mid)) ? 'near' : 'far';
      } else if (!cNear && !cFar) {
        // If both are in swing (rare), pivot whichever will land sooner.
        pivot = (phases.near01 <= phases.far01) ? 'near' : 'far';
      }

      A.turnPivot = pivot;
      ensureFootPins();
      const pivotPin = (pivot === 'near') ? A.footNear : A.footFar;
      const otherPin = (pivot === 'near') ? A.footFar : A.footNear;
      otherPin.active = false; // allow the other leg to step into the new direction

      // Keep existing pivot pin if already planted (best continuity).
      pivotPin.y = p.y;
      if (!pivotPin.active) {
        const hipX = (pivot === 'near') ? 1.5 : -1.5;
        const groundLocalY = (p.y - rig.originY) / Math.max(1e-6, rig.scale);
        const phase01 = (pivot === 'near') ? phases.near01 : phases.far01;
        const gaitUsed = (pivot === 'near') ? gaitBase : gaitFar;
        const nom = footTargetFromPhase(hipX, phase01, gaitUsed, groundLocalY);
        // IMPORTANT: compute world X using the *previous* facing so the pinned
        // foot doesn't "teleport" when the sprite flips.
        pivotPin.x = rig.originX + nom.x * rig.scale * (A.turnFromFacing || velFacing);
        pivotPin.active = true;
      }
    }

    // ---------------------------------------------------------
    // Dust FX (run steps, jumps, landings, hard acceleration)
    // ---------------------------------------------------------
    {
      const onGround = !!p.onGround;
      const speed = Math.abs(p.vx || 0);
      A.fx = A.fx || { wasGround: onGround, prevVx: p.vx || 0, stepDist: 0, stepSide: 1 };
      const fx = A.fx;

      // Jump / Land detection
      if (!fx.wasGround && onGround) {
        // Land impact puff
        spawnDust(p.x, p.y, { dir: 0, n: 10, lift: 0.7, spread: 1.2, size: 2 }, COL_DUST);
      } else if (fx.wasGround && !onGround && (p.vy || 0) < -20) {
        // Takeoff puff
        spawnDust(p.x, p.y, { dir: Math.sign(p.vx || 0), n: 6, lift: 1.0, spread: 0.9, size: 2 }, COL_DUST);
      }

      // Step dust while running on ground (distance-based)
      if (onGround && speed > 18 && p.sprinting) {
        fx.stepDist += speed * dt;
        const stride = (speed > 65) ? 7.5 : 10.5; // px per puff
        while (fx.stepDist > stride) {
          fx.stepDist -= stride;
          fx.stepSide *= -1;
          const dir = Math.sign(p.vx || 0);
          const sx = p.x - dir * 2 + fx.stepSide * 2;
          spawnDust(sx, p.y, { dir, n: 2, lift: 0.65, spread: 0.7, size: 2 }, COL_DUST);
        }
      } else {
        fx.stepDist = 0;
      }

      // Acceleration dust (skid / push-off)
      if (onGround && dt > 1e-6) {
        const ax = ((p.vx || 0) - (fx.prevVx || 0)) / dt;
        if (Math.abs(ax) > 280 && speed > 25) {
          const dir = Math.sign(p.vx || 0);
          spawnDust(p.x, p.y, { dir, n: 4, lift: 0.55, spread: 0.8, size: 2 }, COL_DUST);
        }
        fx.prevVx = (p.vx || 0);
      }
      fx.wasGround = onGround;
    }

    // Foot planting + gait state (visual only)
    updateFootPins(dt, rig);

    // Cape simulation
    stepCape(dt, rig);
  };

  // ---------------------------------------------------------
  // DRAW
  // ---------------------------------------------------------
  G.drawWizard = function drawChar5loc(screenX, screenY) {
    const ctx = G.ctx;
    const p = G.player;
    if (!ctx || !p) return;

    const rig = A.rig || computeRigWorld(p);

    // 1) Cape (behind)
    drawCape(screenX, screenY);

    // 2) Character
    const facing = rig.facing;
    const scale = rig.scale;

    // Screen-space origin for hip
    const originY = (rig.originY - (G.camera ? G.camera.y : 0));
    const baseX = screenX;

    const toX = (lx) => baseX + lx * scale * facing;
    const toY = (ly) => originY + ly * scale;
    // Helpers: draw local-space rects correctly when facing flips (avoid torso/head drifting)
    const rectLocalWithOutline = (lx, ly, lw, lh, fill, outline) => {
      const x0 = toX(lx);
      const x1 = toX(lx + lw);
      const y0 = toY(ly);
      const y1 = toY(ly + lh);
      rectWithOutline(ctx, Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0), fill, outline);
    };

    const fillRectLocal = (lx, ly, lw, lh, fill) => {
      const x0 = toX(lx);
      const x1 = toX(lx + lw);
      const y0 = toY(ly);
      const y1 = toY(ly + lh);
      ctx.fillStyle = fill;
      ctx.fillRect(
        Math.round(Math.min(x0, x1)),
        Math.round(Math.min(y0, y1)),
        Math.round(Math.abs(x1 - x0)),
        Math.round(Math.abs(y1 - y0)),
      );
    };


    const speed = rig.speed;
    const absSpeed = rig.absSpeed;
    const t = A.walkCycle;
    const blend = rig.blend;
    // Use the visual grounded flag for pose selection (prevents 1-frame fall flicker on slopes).
    const onGround = rig.onGroundAnim;
    const isJumping = rig.isJumping;
    const isLongFall = rig.isLongFall;
    const isRunning = rig.isRunning;
    const moveArms = !!rig.moveArms;

    const charCfg = (G.CONF && G.CONF.CHAR5LOC) || {};

    // Colors (slightly richer than the base 5loc)
    const OUT = '#0b0710';
    const shirt = '#f3f3f3';
    const shirtS = '#d7d7d7';
    const pants = '#2a2a2a';
    const pantsS = '#1b1b1b';
    const skin = '#ffcec5';
    const skinS = '#e3b5ad';
    const hair = '#5a3a1f';
    const shoe = '#0f0f10';

    const thighL = rig.thighL;
    const shinL = rig.shinL;
    const armL = rig.armL;
    const foreL = rig.foreL;
    const torsoH = rig.torsoH;
    const headS = rig.headS;
    const footL = rig.footL;

    // Thickness
    const limbT = Math.max(1, Math.round(4 * scale)); // thinner limbs
    const limbT2 = Math.max(1, Math.round(3 * scale));
    const shoeT = Math.max(1, Math.round(4 * scale));

    // Poses
    // Arms: keep walk/run swing during short airtime, and only raise arms
    // in the dramatic fall pose on *long* falls.
    const farPose = blendedPose(t, speed, blend, moveArms, isJumping, isLongFall, Math.PI);
    const nearPose = blendedPose(t, speed, blend, moveArms, isJumping, isLongFall, 0);

    // Roots (local)
    const shoulderRootFar = { x: -1.2, y: -torsoH + 2 };
    const shoulderRootNear = { x: 1.2, y: -torsoH + 2 };
    const hipFar = { x: -1.5, y: 0 };
    const hipNear = { x: 1.5, y: 0 };

        // Solve joints (legs: gait on ground, dedicated pose in the air)
    // -------------------------------------------------------------
    // Turn vars are computed here (also used later for body tilt).
    const turnAnimTime = (charCfg.turnAnimTime ?? 0.14);
    const turn01 = clamp((A.turnT || 0) / Math.max(1e-6, turnAnimTime), 0, 1);
    const turning = (turn01 > 0) && onGround;
    const turnU = turning ? (1 - turn01) : 0;
    const turnPivot = turning ? (A.turnPivot || 'near') : null;

    // Landing timing inside the turn window (0..1).
    // Earlier landing => crisper demi-tours (less "mou / skating").
    const stepPlantU = (charCfg.turnStepPlantU ?? 0.50);

    let legFar, legNear;

    if (onGround) {
      // Improved: foot plant + IK gait
      const gaitBase = A._gait || getGait(rig);
      const gaitFar = gaitForLeg(gaitBase, 'far');
      const groundLocalY = (p.y - rig.originY) / Math.max(1e-6, rig.scale);
      const phases = getLegPhases01(A.walkCycle, gaitBase);
      const phaseNear01 = phases.near01;
      const phaseFar01 = phases.far01;

      // Hard demi-turn: the non-pivot leg gets a forced step path and
      // plants decisively (prevents the "mou / gliding" look).
      const mkTurnOverride = (hipX, gaitUsed) => {
        const u = clamp(turnU / Math.max(1e-6, stepPlantU), 0, 1);
        const e = smoothstep01(u);

        // Wider, more "anime" turn step: push the foot back first, then
        // snap it forward to catch the new direction.
        const startX = hipX - gaitUsed.strideBack * (0.85 + 0.10 * gaitUsed.run01);
        const endX = hipX + gaitUsed.strideFwd * (1.65 + 0.10 * gaitUsed.run01);

        const lift = gaitUsed.lift * (1.60 + 0.40 * gaitUsed.run01);
        const y = (turnU < stepPlantU)
          ? (groundLocalY - lift * Math.pow(Math.sin(Math.PI * u), 0.48))
          : groundLocalY;

        return { enabled: true, x: lerp(startX, endX, e), y, contact: (turnU >= stepPlantU), swingU: u };
      };

      const overNear = (turning && turnPivot !== 'near') ? mkTurnOverride(hipNear.x, gaitBase) : null;
      const overFar = (turning && turnPivot !== 'far') ? mkTurnOverride(hipFar.x, gaitFar) : null;

      legFar = solveLegGait(hipFar, A.footFar, phaseFar01, gaitFar, groundLocalY, thighL, shinL, footL, rig, overFar);
      legNear = solveLegGait(hipNear, A.footNear, phaseNear01, gaitBase, groundLocalY, thighL, shinL, footL, rig, overNear);
    } else {
      // Air pose: don't keep "running" mid-air.
      legFar = solveLeg(hipFar, airLegPose(rig, 'far'), thighL, shinL, footL);
      legNear = solveLeg(hipNear, airLegPose(rig, 'near'), thighL, shinL, footL);
    }

    const armFar = solveArm(shoulderRootFar, farPose, armL, foreL);
    const armNear = solveArm(shoulderRootNear, nearPose, armL, foreL);

    // Body tilt + acceleration lag (more natural run/stop/start)
    const vx = (p.vx || 0);
    const ax = (A.ax || 0);

    // During abrupt demi-tours we allow a bit more acceleration-driven lean,
    // making the pivot feel more "snappy" instead of "mou / gliding".
    // (charCfg + turn01 already computed above)

    // Base lean into motion (reduced during demi-turns so the braking pose reads).
    const leanMul = rig.runIntent ? 1.30 : 0.03;
    const tiltBase = vx * 0.012 * (1.0 - 0.60 * turn01) * leanMul;

    // Accel-based lag adds weight, but slope collisions can create short spikes.
    // Apply a deadzone to prevent recurrent arm popping on bumps.
    const axDz = (charCfg.axDeadzone ?? 140);
    const axUse = (Math.abs(ax) < axDz) ? 0 : (ax - Math.sign(ax) * axDz);
    const tiltLag = clamp(
      -axUse * 0.00035 * (1.0 + 1.15 * turn01) * leanMul,
      -0.06 - 0.10 * turn01,
      0.06 + 0.10 * turn01
    );

    // Demi-turn braking lean: use the direction we were facing before the flip
    // (momentum direction) so the pivot feels crisp.
    const turnFrom = (A.turnFromFacing || facing);
    const turnLean = turning ? (-turnFrom * 0.42 * Math.pow(turn01, 0.65) * leanMul) : 0;

    const tiltLimit = rig.runIntent ? 0.40 : 0.05;
    const tilt = clamp(tiltBase + tiltLag + turnLean, -(tiltLimit + 0.03 * turn01), tiltLimit + 0.03 * turn01);
    // Use the *visual* grounded flag here (same as poses), otherwise on small
    // bumps/slopes the physics onGround can toggle for 1 frame and the whole
    // body (and arms) "pops".
    const squashX = 1.0 + clamp((onGround ? 0 : (p.vy || 0) * 0.002), -0.08, 0.08);
    const squashY = 1.0 - (squashX - 1.0);

    ctx.save();
    ctx.translate(baseX, originY);
    ctx.scale(squashX, squashY);
    ctx.rotate(tilt);
    ctx.translate(-baseX, -originY);

    // Far arm
    limb(ctx, toX(shoulderRootFar.x), toY(shoulderRootFar.y), toX(armFar.elbow.x), toY(armFar.elbow.y), limbT2, shirtS, OUT);
    limb(ctx, toX(armFar.elbow.x), toY(armFar.elbow.y), toX(armFar.hand.x), toY(armFar.hand.y), limbT2 - 1, skinS, OUT);

    // Far leg
    limb(ctx, toX(hipFar.x), toY(hipFar.y), toX(legFar.knee.x), toY(legFar.knee.y), limbT, pantsS, OUT);
    limb(ctx, toX(legFar.knee.x), toY(legFar.knee.y), toX(legFar.ankle.x), toY(legFar.ankle.y), limbT, pantsS, OUT);
    limb(ctx, toX(legFar.ankle.x), toY(legFar.ankle.y), toX(legFar.foot.x), toY(legFar.foot.y), shoeT, shoe, OUT);

    // Torso
    {
      // Main torso (mirrors correctly when facing flips)
      rectLocalWithOutline(-7, -torsoH, 14, torsoH, shirt, OUT);

      // Shade on back side
      const backSide = (facing > 0) ? -7 : 3;
      const tx0 = toX(backSide);
      const tx1 = toX(backSide + 4);
      const ty = toY(-torsoH);
      const th = torsoH * scale;
      ctx.fillStyle = shirtS;
      ctx.fillRect(
        Math.round(Math.min(tx0, tx1)),
        Math.round(ty + 2),
        Math.round(Math.abs(tx1 - tx0)),
        Math.round(th - 4),
      );

      // Belt
      const bx0 = toX(-7);
      const bx1 = toX(7);
      ctx.fillStyle = OUT;
      ctx.fillRect(
        Math.round(Math.min(bx0, bx1)),
        Math.round(toY(-3)),
        Math.round(Math.abs(bx1 - bx0)),
        Math.round(2 * scale),
      );
    }

    // Head
    {
      // Main head (mirrors correctly when facing flips)
      rectLocalWithOutline(-6, -torsoH - headS, 12, headS, skin, OUT);

      // Hair band
      const bandHpx = Math.max(2, Math.round(4 * scale));
      rectLocalWithOutline(-6, -torsoH - headS, 12, bandHpx / scale, hair, OUT);

      // Eye (front side)
      fillRectLocal(2, -torsoH - headS + 3, 2, 2, OUT);

      // Cheek shade (subtle, back side)
      const backFace = (facing > 0) ? -6 : 3;
      fillRectLocal(backFace, -torsoH - headS + (5 / scale), 3, headS - (6 / scale), skinS);
    }

    // Near leg
    limb(ctx, toX(hipNear.x), toY(hipNear.y), toX(legNear.knee.x), toY(legNear.knee.y), limbT, pants, OUT);
    limb(ctx, toX(legNear.knee.x), toY(legNear.knee.y), toX(legNear.ankle.x), toY(legNear.ankle.y), limbT, pants, OUT);
    limb(ctx, toX(legNear.ankle.x), toY(legNear.ankle.y), toX(legNear.foot.x), toY(legNear.foot.y), shoeT, shoe, OUT);

    // Near arm
    limb(ctx, toX(shoulderRootNear.x), toY(shoulderRootNear.y), toX(armNear.elbow.x), toY(armNear.elbow.y), limbT2, shirt, OUT);
    limb(ctx, toX(armNear.elbow.x), toY(armNear.elbow.y), toX(armNear.hand.x), toY(armNear.hand.y), limbT2 - 1, skin, OUT);

    ctx.restore();
  };
})();
