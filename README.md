# Falling Sand Reforge

Jeu de simulation "falling sand" sans build (scripts globaux + `index.html`).
Lancement rapide, modifiable facilement, et extensible par data (matériaux, réactions, sorts).

## Demarrage rapide

Option 1 (direct) :
- Ouvrir `index.html` dans Chrome/Firefox.

Option 2 (serveur local) :
```bash
./serve.sh
```
puis ouvrir `http://localhost:8000`.

## Controles

- ZQSD / WASD / fleches : deplacement
- Shift : courir (maintenir)
- Verr Maj : sprint toggle
- Espace / Z / W / fleche haut : sauter (ou nager)
- Saut double : appuie encore en l'air
- Clic gauche : lancer un sort (wand)
- Clic droit : peindre (brush)
- Molette : rayon brush
- Shift + Molette : brush suivant
- Ctrl + Molette : wand suivante
- 1..7 : selection wand
- Tab : wand suivante
- R : regen monde (meme seed)
- Shift+R : seed aleatoire
- N : seed suivante
- P / Echap : pause
- H : HUD
- T : aide
- M : menu rapide
- F1 : debug HUD
- F2 : debug worldgen
- F3 : qualite rendu
- G : postFX

Debug log (optionnel) :
- Ajouter `?debug=1` a l'URL pour activer le panneau debug.

## Architecture (high-level)

- `index.html` : point d'entree (chargement des scripts)
- `main.js` : boucle de jeu (tick fixe + rendu)
- `world.js` : buffers monde + generation + chunks
- `simulation.js` : pas de simulation + temperature + reactions
- `materials.js` : definitions data-driven
- `renderer.js` : rendu (caches, sky, AO, overlays)
- `input.js` / `ui.js` : controls + HUD
- `spells.js` / `material_particles.js` : sorts + particules

Documentation detaillee :
- `docs/ARCHITECTURE.md`
- `docs/AUDIT.md`

## Dev notes

Le projet est volontairement "no-build". Si tu veux modulariser plus tard,
on peut migrer vers un bundler (Vite, esbuild) ou ESM natif.
