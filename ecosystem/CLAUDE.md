# EcoSim — Evolutionary Ecosystem Simulator

## Project Overview
EcoSim is a fully interactive, browser-based artificial life simulation where digital creatures with neural network brains evolve, hunt, eat, reproduce, and die in a 2D world. It runs as a standalone HTML file with no build tools or dependencies — just open `index.html` in a browser.

**Created**: Feb 2026
**Tech**: Vanilla JS, HTML5 Canvas, no frameworks or build tools
**Total**: ~5,200 lines across 12 files (v2.2 with file-based saves)

## Architecture

### File Structure
```
ecosystem/
├── index.html              # Page layout, loads all scripts in order
├── server.py               # Python HTTP server with REST API for file-based saves
├── saves/                  # Universe save files (JSON) — created automatically
├── css/
│   └── style.css           # Dark-themed UI (~700 lines)
└── js/
    ├── config.js            # Shared constants, event bus, ID generator (~110 lines)
    ├── neural.js            # Feedforward neural network with Float32Arrays (307 lines)
    ├── serialization.js     # Multi-universe save system, server API + localStorage fallback (~415 lines)
    ├── creature.js          # Creature class: brain, body genes, lifecycle (519 lines)
    ├── world.js             # Simulation engine: spatial grid, physics, food (851 lines)
    ├── renderer.js          # Canvas rendering: creatures, food, particles, brain viz (600+ lines)
    ├── stats.js             # Population/species charts, statistics tracking (419 lines)
    ├── ui.js                # Controls, click interaction, universe panel (450+ lines)
    └── main.js              # Game loop, initialization, auto-save hook (113 lines)
```

### Load Order (Critical)
Scripts load via `<script>` tags in index.html in dependency order:
1. config.js → 2. neural.js → 3. serialization.js → 4. creature.js → 5. world.js → 6. renderer.js → 7. stats.js → 8. ui.js → 9. main.js

Note: serialization.js loads early and runs `init()` immediately to detect whether the server API is available.

All modules use IIFEs and attach to `window.EcoSim` namespace.

### Module Dependencies
```
config.js ← (everything depends on this)
neural.js ← creature.js
creature.js ← world.js
world.js ← renderer.js, stats.js, ui.js
renderer.js ← main.js
stats.js ← main.js
ui.js ← main.js
```

## Core Systems

### Neural Network (neural.js)
- **Architecture**: 12 inputs → 10 hidden (tanh) → 8 hidden (tanh) → 4 outputs (tanh)
- **Storage**: Float32Arrays for all weights/biases (performance)
- **Pre-allocated** intermediate activation arrays to avoid GC in hot path
- **Total params**: 120 + 10 + 80 + 8 + 32 + 4 = 254 parameters per brain
- **Key class**: `EcoSim.NeuralNetwork`
  - `forward(inputs)` — hot path, called per creature per tick
  - `mutate(rate, strength)` — gaussian-ish noise, clamps to [-2,2]
  - `static crossover(parent1, parent2)` — single-point crossover for weights
  - `getGenome()` / `static fromGenome(genome)` — serialization

### Creature System (creature.js)
- **Key class**: `EcoSim.Creature`
- **Body Genes**: `{ size, maxSpeed, turnSpeed, hue, saturation, aggression, efficiency }`
  - Each gene has a defined range in `GENE_RANGES`
  - Hue wraps around 0-360
- **Species ID**: Quantized `hue_size` (hue to nearest 30°, size to nearest 3)
- **Neural inputs** (12): food direction/distance, creature direction/distance/relative size, own energy, 4 wall proximities
- **Neural outputs** (4): turn, speed, eat/attack desire, reproduce desire
- **Lifecycle**: energy drains per tick based on speed + size / efficiency. Dies at energy ≤ 0.
- **Reproduction**: requires energy > 160, age > 200, cooldown expired. Asexual by default, sexual if nearby compatible partner (5% chance).
- **Events emitted**: `creature:eat`, `creature:attack`, `creature:reproduce`, `creature:die`
  - ALL use `{ creature: this }` as the data shape (standardized during bug fix)

### World Simulation (world.js)
- **Key class**: `EcoSim.World`
- **Spatial partitioning**: Hash grid with 50px cells for O(1) neighbor lookups
- **Food system**: Probabilistic spawning (0.6/tick), clustering near existing food (30% chance), max 250
- **Tick order**: rebuild spatial grid → spawn food → for each creature (build inputs → update → check eat → check attack → check reproduce → remove dead) → cap population → update particles → enforce minimum population
- **Population cap**: MAX_CREATURES=350, kills lowest-energy creatures if exceeded
- **Minimum population**: If < 5, spawns 10 new random creatures
- **Particle system**: Visual effects for eat (green sparkles), attack (orange flash), reproduce (cyan ring), die (red fade). Max 200 particles.
- **Event listeners**: Spawns particles on creature events, tracks totalBirths/totalDeaths

### Renderer (renderer.js)
- **Key class**: `EcoSim.Renderer`
- **High-DPI**: Uses devicePixelRatio for crisp rendering on Retina displays
- **Aspect-ratio correct**: Uses `min(scaleX, scaleY)` with centering offsets
- **Creature rendering**: Radial gradient body, directional bump (nose), white eyes with dark pupils, reproduction glow ring, attack/eat flash rings
- **Food rendering**: Radial gradient glow, pulsing via sin(age)
- **Trails**: Per-segment lines with alpha fade and width taper
- **Selection**: Animated dashed circle, info label ("Gen X | E:Y")
- **Brain visualization**: 4-column node layout, weighted connections (cyan=positive, orange=negative), activation-colored nodes, input/output labels

### Statistics (stats.js)
- **Key class**: `EcoSim.Stats`
- **Population chart** (300x120): Dual smooth lines (population=cyan, food=green) with filled areas, auto-scaling Y, smooth curves via quadraticCurveTo
- **Species chart** (300x100): Stacked area chart colored by species hue, showing speciation over time
- **Stats panel**: 11 stat rows updated via innerHTML (only when values change)
- **FPS tracking**: Rolling average of last 30 frame timestamps
- **Throttled**: Charts every 3 frames, stats panel every 10 frames

### UI Controls (ui.js)
- **Key class**: `EcoSim.UI`
- **Speed**: Pause/1x/2x/5x/10x via buttons or keyboard (Space, 1-4)
- **Toggles**: Trails (t), Vision ranges (v)
- **Actions**: Add Food mode (f) — click adds cluster of 5, Spawn Creature, Reset
- **Click interaction**: Correct coordinate mapping accounting for renderer's aspect-ratio scaling
- **Creature inspector**: Shows ID, gen, age, energy, size, speed, food eaten, kills, children, species, efficiency, aggression
- **Keyboard shortcuts**: Space=pause, 1-4=speed, f=food, t=trails, v=vision, Esc=deselect

### Main Loop (main.js)
- DOMContentLoaded → create World, Renderer, Stats, UI → requestAnimationFrame loop
- Per frame: N simulation ticks (based on TICKS_PER_FRAME) → render → brain viz (every 3rd) → stats → UI
- Error overlay on initialization failure
- Debug access: `EcoSim.world`, `EcoSim.renderer`, `EcoSim.stats` in browser console

## Configuration (config.js)
Key tunable values:
```
WORLD: 1600x900, 50px grid cells
CREATURES: 60 initial, 350 max, 4-14 size, 3.5 max speed
ENERGY: 100 initial, 250 max, 0.08 drain/tick, reproduction threshold 160, reproduction cost 70
NEURAL NET: 12→10→8→4 with tanh activations
FOOD: 0.6 spawn rate, 250 max, 35 energy, 30% cluster chance
GENETICS: 15% mutation rate, 0.25 mutation strength, 5% crossover rate
RENDERING: 8-position trails, 200 max particles
```

## Event System
`EcoSim.Events` — simple pub/sub: `on(event, fn)`, `emit(event, data)`, `off(event, fn)`

Events (all emitted by creature.js methods only — world.js just listens):
- `creature:eat` → `{ creature }` — when creature eats food
- `creature:attack` → `{ creature, target }` — when creature attacks another
- `creature:reproduce` → `{ creature, offspring }` — when creature reproduces
- `creature:die` → `{ creature }` — when creature dies
- `food:add` → `{ food }` — when food is manually added

## Bug Fixes Applied (During Build)
1. **Duplicate event emissions**: Removed redundant event emits from world.js (_checkEating, _checkAttacking, _checkReproduction, update dead handling). Creature.js is now the sole event emitter.
2. **Event data shape mismatch**: Standardized creature.js to use `{ creature: this }` instead of `{ attacker: this }` / `{ parent: this }`.
3. **Click coordinate mapping**: Fixed ui.js to use same aspect-ratio scaling as renderer (min(scaleX, scaleY) with offsets).
4. **Missing CSS classes**: Added `.inspector-row` and `.inspector-panel.visible` styles.

## v2 Enhancements (Feb 2026)
1. **Day/Night Cycle**: Background brightness and food spawn rate modulate on a sin wave cycle (config: DAY_CYCLE_LENGTH=3000 ticks). Darker nights, brighter days. Food spawns faster during day.
2. **Food Types**: Plants (green, 35 energy) and Meat (red, 60 energy). Meat drops at creature death locations (70% chance). Different renderer colors/glows.
3. **Food Spawn Animation**: Food fades in over 10 ticks instead of popping in instantly.
4. **Death Animation**: Dead creatures fade out and shrink over 20 ticks via `world.dyingCreatures` array.
5. **Predator/Prey Specialization**: High aggression (>0.7) creatures get red tint overlay + larger attack range. Low aggression (<0.3) get up to 15% speed bonus. Creates evolutionary pressure.
6. **Ambient Background Particles**: 40 slowly drifting faint blue particles for atmospheric feel. Wrap around edges.
7. **Settings Panel**: Collapsible panel with live sliders for Mutation Rate, Mutation Strength, Food Spawn Rate, Energy Drain, Day Cycle Length. Updates `Config` values in real time.
8. **Bug Fixes**: lastAction now resets at start of update(); added .action-btn.active CSS.
9. **Creature Memory (Recurrence)**: NN inputs expanded from 12→16. Inputs 12-15 are previous tick's outputs, fed back as memory. Creatures can now form simple temporal behaviors.
10. **Terrain Fertile Zones**: 2-3 circular zones where food spawns 2-4x faster. Rendered as faint green radial gradients. Slowly drift and bounce off edges.
11. **Minimap**: 160x90 canvas in top-left corner showing all creatures (colored dots), food (green/red pixels), zones, and selected creature marker.
12. **Size-Based Creature Detail**: Creatures with size>10 get a tail segment. Creatures with size<6 skip eyes for simpler rendering.
13. **Save/Load System**: New `serialization.js` module. Quick Save/Load to localStorage, Download as .json, Load from file. Serializes all creatures (position, genes, brain genome, stats), food, zones, counters.
14. **Multi-Universe Save System (v2.2)**: Complete rewrite of serialization.js. Multiple named universes with auto-save every 3000 ticks. Universe panel in sidebar with Save/New/Export/Import buttons and clickable universe list.
15. **File-Based Saving**: New `server.py` Python HTTP server with REST API (`/api/universes`). Saves universes as JSON files in `ecosystem/saves/` directory. Falls back to localStorage when server unavailable (e.g., file:// protocol).

### Save System Architecture
- **Server mode**: `python3 server.py` → serves app at `http://localhost:8000` + provides REST API for CRUD operations on universe files
- **API endpoints**: `GET /api/universes` (list), `GET/POST/DELETE /api/universes/<name>` (load/save/delete)
- **localStorage fallback**: Automatically detected at init — if server API returns 200, use files; otherwise use `localStorage`
- **Auto-save**: Every 3000 ticks, saves current universe. Visual indicator flashes in sidebar.
- **Universe switching**: Auto-saves current universe before loading a different one to prevent data loss.
- **File format**: JSON with version field, all creatures (position, genes, full brain genome), food, zones, tick counter, stats

## Current State
- **Status**: FUNCTIONAL v2.2 — 12 files, ~5,200 lines
- **Known minor issues**:
  - Info overlay `textContent` replaces child spans (cosmetic — works fine as plain text)
  - Stats panel innerHTML replaces HTML-defined stat rows (functional — stats.js takes over)

## How to Run
```bash
# Option 1: With file-based saving (recommended)
cd ecosystem && python3 server.py
# Then visit http://localhost:8000
# Saves go to ecosystem/saves/ as JSON files

# Option 2: Without server (localStorage fallback)
open ecosystem/index.html
# Saves go to browser localStorage instead of files
```

## Development Notes
- No build tools, no npm, no modules. Just script tags.
- All code uses `var` (ES5 compatible) for max browser compat.
- Hot paths (neural.forward, world.update) are performance-optimized with local variable caching, Float32Arrays, and spatial partitioning.
- The project was built by spawning 6+ Opus 4.6 agents in parallel, each building a different module to a shared interface spec.
