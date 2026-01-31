'use strict';
(() => {
  const G = (window.G = window.G || {});
  const { WORLD_W: W, WORLD_H: H } = G.CONF;
  const { MAT } = G;

  // ------------------------------
  // Brush painting (debug/sandbox tool)
  // RMB = paint
  // Wheel = radius
  // Shift+Wheel = brush selection
  // ------------------------------
  G.BRUSHES = [
    { name: 'Rock', mat: MAT.ROCK },
    { name: 'Dark Rock', mat: MAT.DARK_ROCK },
    { name: 'Sandstone', mat: MAT.SANDSTONE },
    { name: 'Dirt', mat: MAT.DIRT },
    { name: 'Sand', mat: MAT.SAND },
    { name: 'Snow', mat: MAT.SNOW },
    { name: 'Ice', mat: MAT.ICE },
    { name: 'Packed Snow', mat: MAT.PACKED_SNOW },
    { name: 'Wood', mat: MAT.WOOD },
    { name: 'Water', mat: MAT.WATER },
    { name: 'Oil', mat: MAT.OIL },
    { name: 'Acid', mat: MAT.ACID },
    { name: 'Lava', mat: MAT.LAVA },
    { name: 'Fire', mat: MAT.FIRE },
    { name: 'Steam', mat: MAT.STEAM },
    { name: 'Erase', mat: MAT.EMPTY },
  ];

  G.brushIndex = 2;
  G.paintRadius = 6;

  function defaultLifeFor(m) {
    if (m === MAT.FIRE) return 22 + G.randi(40);
    if (m === MAT.STEAM) return 50 + G.randi(80);
    if (m === MAT.LAVA) return 220 + G.randi(200);
    return 0;
  }

  function applyPainting() {
    const mouse = G.mouse;
    if (!mouse || !mouse.right) return;

    const cx = mouse.worldX | 0;
    const cy = mouse.worldY | 0;
    if (!G.inb(cx, cy)) return;

    const b = G.BRUSHES[G.brushIndex];
    const r = G.paintRadius | 0;
    const life0 = defaultLifeFor(b.mat);

    // If you paint through yourself, it's easy to soft-lock.
    // So we carve a tiny bubble around the player's body, always.
    const p = G.player;
    if (p) {
      const dx = cx - p.x;
      const dy = cy - (p.y - p.h * 0.5);
      if (dx * dx + dy * dy < (p.w * p.w)) {
        return;
      }
    }

    if (b.mat === MAT.EMPTY) {
      G.fillCircle(cx, cy, r, MAT.EMPTY, 0, () => true);
    } else {
      // Painting replaces anything except the immutable world border.
      G.fillCircle(cx, cy, r, b.mat, life0, (_cur, x, y) => {
        return (x > 0 && x < W - 1 && y > 0 && y < H - 1);
      });
    }
  }

  G.applyPainting = applyPainting;
})();
