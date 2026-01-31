# Falling Sand Reforge — Dev Notes

This build introduces a **Noita-inspired architecture tweak** that makes the project easier to extend while staying in a simple “no-build” workflow (plain `<script>` tags, file:// friendly).

## Big idea: two simulations

The world is still a **single-buffer cellular sim** (`world.js` + `simulation.js`).

On top of that, we now have a second lightweight sim:

### 1) Grid sim (cellular)
- `G.mat[]`, `G.life[]`, `G.temp[]` are the authoritative world.
- `simulation.js` updates only “active” chunks.

### 2) Material Particles sim (ballistic)
- New: `material_particles.js`
- It temporarily “pulls” a cell **out of the grid**, simulates it with inertia (velocity + gravity + drag), then **reinserts it into the grid** on impact.

This is exactly the technique described in the Noita tech talk:
> take a pixel out of the falling-sand simulation, run a particle sim, then put it back.

### Why this helps
- Liquid spells no longer look like they “teleport” into place.
- Running/turning now kicks actual sand/snow pixels into the air (dust chunks).
- The system is optional and fails safely (if absent, spells fall back to the old fill method).

## Input + UI cleanup

- `config.js` now contains `G.KEYBINDS` (AZERTY-friendly).
- `input.js` uses those binds and ignores key-repeat for stable toggles.
- `log.js` adds an in-game message feed (`G.log(...)`) for systemic feedback.
- `ui.js` renders:
  - status icons (wet/oil/acid/burning/cold)
  - a message log panel

## Update order

`main.js` tick order (fixed dt):
1. `updateInput()`
2. wand casting
3. `updateProjectiles()`
4. `updateMatParticles()` (new)
5. brush painting
6. `stepSimulationActive()`
7. `movePlayer()`
8. `updateParticles()`
9. `updateLog()`
10. camera + wizard anim

## Where to tune things

- Cape size: `G.CONF.CAPE.length / flare`
- Material particles: `G.CONF.MAT_PARTICLES` + per-material params in `material_particles.js`
- Liquid “spray feel”: `depositLiquid()` in `spells.js`

