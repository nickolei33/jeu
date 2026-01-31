# Audit rapide (tech)

## Points forts

- No-build simple : lancement direct `index.html`.
- Simulation robuste : tick fixe, chunks actifs, temperature locale.
- Data-driven : materiaux, reactions, phases.
- Rendu pixel-art riche (caches, AO, sky, overlays).

## Risques / dettes

- Fichiers monolithiques (ex: `renderer.js`, `world.js`) : difficile a maintenir.
- Namespace global `G` : collisions possibles, testabilite faible.
- Peu d'infra (pas de README, scripts, conventions) -> freine le dev a plusieurs.
- Rendu lourd : caches W*H multiples -> usage memoire important.

## Performances

- Simulation chunked ok, mais la generation + caches peuvent etre lourds au reset.
- Rendu par pixel + postFX : ok desktop, peut etre limite sur mobile.

## Qualite / stabilite

- Bonne separation logique (simulation vs rendu), mais dependances globales.
- Pas de tests automatises.

## Recommendations (priorite)

1. Documentation et scripts de dev (fait).
2. Refactor leger : extraire les blocs "utilitaires" et "debug".
3. A terme : modulariser (ESM ou bundler) + split `renderer.js` / `world.js`.

## Prochaines etapes proposees

- Ajouter un systeme de sauvegarde seed + config.
- Ajouter un petit menu in-game (qualite, toggles, seed).
