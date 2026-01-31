'use strict';
(() => {
  const G = (window.G = window.G || {});
  const C = G.CONF;
  const { WORLD_W: W, WORLD_H: H, VIEW_W, VIEW_H } = C;
  const { MAT } = G;

  // ------------------------------
  // Player (bottom-center anchored)
  // ------------------------------
  G.player = {
    x: W * 0.5,
    y: 40,
    vx: 0,
    vy: 0,
    w: 8,      // Slightly thinner (was 10)
    h: 20,     // Slightly shorter (was 22)

    onGround: false,
    facing: 1,
    animT: 0,
    castT: 0,

    hp: 100,
    hpMax: 100,
    mana: 100,
    manaMax: 100,

    coyote: 0,
    jumpBuf: 0,

    airJumps: 1,

    // damage smoothing
    hurtCD: 0,
  };

  function cellBlocksPlayer(x, y) {
    if (!G.inb(x, y)) return true;
    return G.blocksPlayer(G.mat[G.idx(x, y)]);
  }

  function rectCollides(cx, cy) {
    const p = G.player;
    const halfW = p.w * 0.5;
    const left = Math.floor(cx - halfW);
    const right = Math.floor(cx + halfW);
    const top = Math.floor(cy - p.h);
    const bottom = Math.floor(cy);

    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        if (cellBlocksPlayer(x, y)) return true;
      }
    }
    return false;
  }
  G.rectCollides = rectCollides;

  function sampleBodyMaterial() {
    const p = G.player;
    const cx = p.x | 0;
    const cy = (p.y - p.h * 0.55) | 0;
    return G.safeGet(cx, cy, MAT.ROCK);
  }

  function applyHazards(dt) {
    const p = G.player;
    const m = sampleBodyMaterial();

    // ------------------------------------------------------
    // Status communication (Noita-style)
    // This does NOT need to be perfectly realistic yet; the main goal is:
    // - show the player what system is affecting them
    // - make deaths feel fair ("I was wet", "I was burning", etc.)
    // ------------------------------------------------------
    p.status = p.status || { wet: 0, oily: 0, corrosive: 0, burning: 0, frozen: 0 };
    const S = p.status;
    const setStat = (key, on, tOn, msg) => {
      const had = S[key] > 0;
      if (on) S[key] = Math.max(S[key], tOn);
      else S[key] = Math.max(0, S[key] - dt);
      const has = S[key] > 0;
      if (!had && has && G.log) G.log(msg);
    };
    setStat('wet', (m === MAT.WATER), 0.60, 'WET');
    setStat('oily', (m === MAT.OIL), 0.60, 'OILED');
    setStat('corrosive', (m === MAT.ACID), 0.60, 'CORROSIVE');
    setStat('burning', (m === MAT.FIRE || m === MAT.LAVA), 0.45, 'BURNING');
    setStat('frozen', (m === MAT.ICE || m === MAT.SNOW || m === MAT.PACKED_SNOW), 0.60, 'COLD');

    if (p.hurtCD > 0) p.hurtCD = Math.max(0, p.hurtCD - dt);

    let dps = 0;
    if (m === MAT.FIRE) dps = 40;
    else if (m === MAT.LAVA) dps = 120;
    else if (m === MAT.ACID) dps = 65;

    if (dps > 0 && p.hurtCD <= 0) {
      p.hp -= dps * dt;
      p.hurtCD = 0.06; // reduces “machine-gun” damage on edges
      // little feedback
      if ((G.frameId & 3) === 0) G.burst(p.x, p.y - p.h * 0.7, 2, 0xffffb13b, 0xffd94a2a, 40);
    }

    if (p.hp <= 0) {
      respawnPlayer(true);
    }
  }

  function inSwimmableLiquid() {
    const p = G.player;
    const cx = p.x | 0;
    const cy = (p.y - p.h * 0.45) | 0;
    const m = G.safeGet(cx, cy, MAT.ROCK);
    return G.isLiquidSwimmable(m);
  }

  function movePlayer(dt, input) {
    const p = G.player;

    // ------------------------------
    // Movement constants
    // ------------------------------
    const accel = 280;           // Faster acceleration (was 190)
    // Strong braking when reversing direction on the ground.
    // This makes demi-tours feel less "floaty / gliding" while keeping
    // the air control unchanged.
    const brakeAccel = 900;
    const friction = 0.88;       // More momentum (was 0.80)
    const gravity = 280;         // Slightly heavier feel
    const jumpV = 145;           // Higher jump (was 112)

    // Swimming tuning
    const swimming = inSwimmableLiquid();
    const sprintIntent = !!input.sprintHeld || !!input.sprintToggle;
    const sprinting = !swimming && sprintIntent;
    const baseMaxSpeed = C.PLAYER_MAX_SPEED;
    const runMul = 1.45;
    const walkMul = 0.78;
    const maxSpeed = baseMaxSpeed * (sprinting ? runMul : walkMul);
    const swimDrag = 0.40;
    const swimGravity = 100;
    const swimJump = 95;         // Stronger swim kick

    // ------------------------------
    // Jump buffer + coyote time (more forgiving)
    // ------------------------------
    if (input.jumpPressed) p.jumpBuf = 0.15;   // was 0.11
    else p.jumpBuf = Math.max(0, p.jumpBuf - dt);

    if (p.onGround) p.coyote = 0.12;           // was 0.09
    else p.coyote = Math.max(0, p.coyote - dt);

    if (p.onGround) p.airJumps = 1;

    // ------------------------------
    // Horizontal
    // ------------------------------
    // Use a stronger decel when the player inputs the opposite direction.
    // This reduces the visual "skating" during fast direction changes.
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir !== 0) {
      const reversing = (!swimming && p.onGround && (p.vx * dir < 0) && (Math.abs(p.vx) > 2));
      const a = reversing ? brakeAccel : (sprinting ? accel * 1.15 : accel);
      p.vx += a * dir * dt;
      // Snap to 0 when braking would overshoot; gives a crisp pivot.
      if (reversing && (p.vx * dir > 0)) p.vx = 0;
    } else {
      p.vx *= friction;
    }

    if (swimming) p.vx *= (1 - swimDrag * dt);

    p.vx = G.clamp(p.vx, -maxSpeed, maxSpeed);

    // ------------------------------
    // Jump / swim kick
    // ------------------------------
    if (!swimming) {
      if (p.jumpBuf > 0 && p.coyote > 0) {
        p.vy = -jumpV;
        p.onGround = false;
        p.coyote = 0;
        p.jumpBuf = 0;
      } else if (p.jumpBuf > 0 && !p.onGround && p.airJumps > 0) {
        p.vy = -jumpV * 0.85;
        p.airJumps -= 1;
        p.jumpBuf = 0;
        if (G.burst) G.burst(p.x, p.y - p.h * 0.7, 2, 0xffc8f7ff, 0xff6db8ff, 36);
      }
    } else {
      // In liquid: if jump pressed, give an upward kick
      if (p.jumpBuf > 0) {
        p.vy = Math.min(p.vy, 0);
        p.vy -= swimJump;
        p.jumpBuf = 0;
      }
    }

    // ------------------------------
    // Gravity
    // ------------------------------
    p.vy += (swimming ? swimGravity : gravity) * dt;
    p.vy = Math.min(p.vy, 380);

    // Facing with Hysteresis to prevent jitter
    if (Math.abs(p.vx) > 10) {
      p.facing = (p.vx > 0) ? 1 : -1;
    } else if (G.mouse) {
      const dx = G.mouse.worldX - p.x;
      // Buffer of 4px before flipping to avoid "strobe" effect
      if (Math.abs(dx) > 4) {
        p.facing = (dx > 0) ? 1 : -1;
      }
    }

    // ------------------------------
    // X collision (with iteration cap)
    // ------------------------------
    let nx = p.x + p.vx * dt;
    // Step up logic for sand terrain
    if (!rectCollides(nx, p.y)) {
      p.x = nx;
    } else {
      // Try stepping up (slope handling)
      let stepped = false;
      for (let i = 1; i <= 3; i++) {
        if (!rectCollides(nx, p.y - i)) {
          p.x = nx;
          p.y -= i;
          stepped = true;
          break;
        }
      }

      if (!stepped) {
        // Standard collision slide if step up failed
        const step = Math.sign(p.vx || 1) * 0.25;
        let guard = 0;
        while (guard++ < 64 && Math.abs(nx - p.x) > 0.001) {
          const tx = p.x + step;
          if (!rectCollides(tx, p.y)) p.x = tx;
          else break;
          if (Math.abs(tx - nx) < 0.25) break;
        }
        p.vx = 0;
      }
    }

    // ------------------------------
    // Y collision
    // ------------------------------
    let ny = p.y + p.vy * dt;
    if (!rectCollides(p.x, ny)) {
      p.y = ny;
      p.onGround = false;
    } else {
      if (p.vy > 0) p.onGround = true;
      const step = Math.sign(p.vy || 1) * 0.25;
      let guard = 0;
      while (guard++ < 96 && Math.abs(ny - p.y) > 0.001) {
        const ty = p.y + step;
        if (!rectCollides(p.x, ty)) p.y = ty;
        else break;
        if (Math.abs(ty - ny) < 0.25) break;
      }
      p.vy = 0;
    }

    // World bounds
    p.x = G.clamp(p.x, 6, W - 7);
    p.y = G.clamp(p.y, p.h + 2, H - 2);

    // Emergency unstuck (rare but prevents softlocks)
    if (rectCollides(p.x, p.y)) {
      unstuckPlayer();
    }

    // Animation time
    const speed01 = G.clamp(Math.abs(p.vx) / maxSpeed, 0, 1);
    if (p.onGround) {
      const animMul = sprinting ? 1.18 : 1.0;
      p.animT += dt * (2 + 12 * speed01) * animMul;
    }
    else p.animT += dt * 7;

    // cast animation timer
    if (p.castT > 0) p.castT = Math.max(0, p.castT - dt);

    // mana regen
    p.mana = Math.min(p.manaMax, p.mana + (swimming ? 16 : 22) * dt);

    // hazards
    applyHazards(dt);

    // Expose sprint intent to render/FX
    p.sprinting = sprintIntent;
  }

  function unstuckPlayer() {
    const p = G.player;

    // Try to move up a bit first (most common case)
    for (let dy = 1; dy <= 24; dy++) {
      if (!rectCollides(p.x, p.y - dy)) {
        p.y -= dy;
        return;
      }
    }

    // Spiral search around current position
    const baseX = p.x;
    const baseY = p.y;
    for (let r = 1; r <= 20; r++) {
      for (let a = 0; a < 16; a++) {
        const t = (a / 16) * Math.PI * 2;
        const tx = baseX + Math.cos(t) * r;
        const ty = baseY + Math.sin(t) * r;
        if (!rectCollides(tx, ty)) {
          p.x = tx;
          p.y = ty;
          return;
        }
      }
    }

    // Last resort: carve a small safety bubble
    G.carveCircle(p.x | 0, (p.y - p.h * 0.5) | 0, 6);
  }

  function respawnPlayer(fullHeal = false) {
    const p = G.player;

    let px = (W * 0.5) | 0;
    let py = 30;

    // Find first solid down, then place player just above it.
    for (let y = 10; y < H - 20; y++) {
      const m = G.safeGet(px, y, MAT.ROCK);
      if (G.isSolid(m)) {
        py = y - 2;
        break;
      }
    }

    // Ensure spawn pocket is empty.
    G.carveCircle(px, (py - p.h * 0.5) | 0, 10);

    p.x = px;
    p.y = py;
    p.vx = 0;
    p.vy = 0;
    p.castT = 0;
    p.mana = p.manaMax;
    if (fullHeal) p.hp = p.hpMax;

    // Center camera immediately on respawn to avoid sim-region lag.
    if (G.camera) {
      G.camera.x = G.clamp(p.x - VIEW_W / 2, 0, W - VIEW_W);
      G.camera.y = G.clamp(p.y - VIEW_H / 2, 0, H - VIEW_H);
    }
  }

  G.movePlayer = movePlayer;
  G.respawnPlayer = respawnPlayer;
})();
