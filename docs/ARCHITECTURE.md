# Architecture

## Vue generale

Le projet fonctionne en scripts globaux, chargees dans `index.html` sans build.
Le namespace global est `window.G`, qui porte l'etat du jeu.

## Boucle principale

`main.js` gere un tick fixe :
1. `updateInput()`
2. wand casting
3. `updateProjectiles()`
4. `updateMatParticles()`
5. brush painting
6. `stepSimulationActive()`
7. `movePlayer()`
8. `updateParticles()`
9. `updateLog()`
10. camera + anim

Le rendu (`render()`) est fait une fois par RAF.

## Simulation

- Buffers monde dans `world.js` : `G.mat`, `G.life`, `G.temp`.
- Simulation cellulaire dans `simulation.js`.
- Chunks actifs autour de la camera (perf) : `G.chunkTTL`, `G.chunkAlways`.
- Temperature et transitions de phase : diffusion locale + probabilites.

## Materiaux et reactions

`materials.js` definit :
- categories (solide, poudre, liquide, gaz)
- densite
- conduction thermique
- transitions de phase (melt/boil/freeze/ignite)

`reactions.js` ajoute une table data-driven pour les reactions entre materiaux.

## Worldgen

`world.js` construit :
- surface + biomes + caves (macro layout)
- decorations de fond (bgDeco)
- caches visuels (render)

## Rendu

`renderer.js` gere :
- caches sky / montagnes / fog
- AO air + overlays (neige, icicles)
- rendu des materiaux (palettes + shading)

## Input + UI

- `input.js` mappe les keybinds depuis `config.js`.
- `ui.js` render HUD, help, debug, log.

## Fichiers principaux

- `index.html` : boot + scripts
- `main.js` : loop
- `world.js` : buffers + generation + chunk meta
- `simulation.js` : step + temperature + reactions
- `renderer.js` : rendu
