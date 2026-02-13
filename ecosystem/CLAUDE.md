# EcoSim — Evolutionary Ecosystem Simulator

## Project Overview
EcoSim is a fully interactive, browser-based artificial life simulation where digital creatures with neural network brains evolve, hunt, eat, reproduce, and die in a 2D world. It runs as a standalone HTML file with no build tools or dependencies — just open `index.html` in a browser.

**Created**: Feb 2026
**Tech**: Vanilla JS, HTML5 Canvas, no frameworks or build tools
**Total**: ~9,000 lines across 13 files (v3.3 with island system)

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
    ├── config.js            # Shared constants, event bus, ID generator (111 lines)
    ├── neural.js            # Feedforward neural network with Float32Arrays (311 lines)
    ├── serialization.js     # Multi-universe save system, server API + localStorage fallback (440 lines)
    ├── creature.js          # Creature class: brain, body genes, lifecycle (527 lines)
    ├── world.js             # Simulation engine: spatial grid, physics, food (944 lines)
    ├── renderer.js          # Canvas rendering: creatures, food, camera, brain viz (763 lines)
    ├── stats.js             # Population/species charts, statistics tracking (419 lines)
    ├── sound.js             # WebAudio creature sound system, ambient drone (250 lines)
    ├── ui.js                # Controls, camera, universe panel, screenshot (694 lines)
    └── main.js              # Game loop, initialization, auto-save hook (120 lines)
```

### Load Order (Critical)
Scripts load via `<script>` tags in index.html in dependency order:
1. config.js → 2. neural.js → 3. creature.js → 4. world.js → 5. serialization.js → 6. renderer.js → 7. stats.js → 8. sound.js → 9. ui.js → 10. main.js

Note: serialization.js loads early and runs `init()` immediately to detect whether the server API is available.

All modules use IIFEs and attach to `window.EcoSim` namespace.

### Module Dependencies
```
config.js ← (everything depends on this)
neural.js ← creature.js
creature.js ← world.js
sound.js ← ui.js, main.js (event-driven via EcoSim.Events)
world.js ← renderer.js, stats.js, ui.js
renderer.js ← main.js
stats.js ← main.js
ui.js ← main.js
```

## Core Systems

### Neural Network (neural.js)
- **Architecture**: 17 inputs → 10 hidden (tanh) → 8 hidden (tanh) → 5 outputs (tanh)
- **Storage**: Float32Arrays for all weights/biases (performance)
- **Pre-allocated** intermediate activation arrays to avoid GC in hot path
- **Total params**: 170 + 10 + 80 + 8 + 40 + 5 = 313 parameters per brain
- **Key class**: `EcoSim.NeuralNetwork`
  - `forward(inputs)` — hot path, called per creature per tick
  - `mutate(rate, strength)` — gaussian-ish noise, clamps to [-2,2]
  - `static crossover(parent1, parent2)` — single-point crossover for weights
  - `getGenome()` / `static fromGenome(genome)` — serialization

### Creature System (creature.js)
- **Key class**: `EcoSim.Creature`
- **Body Genes**: `{ size, maxSpeed, turnSpeed, hue, saturation, aggression, efficiency, luminosity }`
  - Each gene has a defined range in `GENE_RANGES`
  - Hue wraps around 0-360
- **Species ID**: Quantized `hue_size` (hue to nearest 30°, size to nearest 3)
- **Neural inputs** (17): food direction/distance, creature direction/distance/relative size, own energy, 4 wall proximities, 4 memory (prev outputs), nearest creature's signal
- **Neural outputs** (5): turn, speed, eat/attack desire, reproduce desire, signal broadcast
- **Lifecycle**: energy drains per tick based on speed + size / efficiency. Dies at energy ≤ 0.
- **Reproduction**: requires energy > 160, age > 200, cooldown expired. Asexual by default, sexual if nearby compatible partner (5% chance).
- **Events emitted**: `creature:eat`, `creature:attack`, `creature:reproduce`, `creature:die`
  - ALL use `{ creature: this }` as the data shape (standardized during bug fix)

### World Simulation (world.js)
- **Key class**: `EcoSim.World`
- **Spatial partitioning**: Hash grid with 50px cells for O(1) neighbor lookups
- **Food system**: Probabilistic spawning (6.0/tick), clustering near existing food (30% chance), max 2500
- **Tick order**: rebuild spatial grid → spawn food → apply mutation storm boost → for each creature (build inputs → update → check eat → check attack → check reproduce → remove dead) → restore mutation rate → cap population → check/trigger world events → apply active events → update particles → enforce minimum population
- **Population cap**: MAX_CREATURES=800, kills lowest-energy creatures if exceeded
- **Minimum population**: If < 30, spawns 50 new random creatures
- **World events**: Random events every 2000-4000 ticks. 4 types: bloom (100 food burst), plague (area energy drain, efficiency-resistant), meteor (area kill + new zone), mutation storm (4x mutation rate). `activeEvents` array tracks ongoing events for renderer. `_checkWorldEvents()`, `_triggerWorldEvent(type)`, `_applyActiveEvents()`.
- **Particle system**: Visual effects for eat (green sparkles), attack (orange flash), reproduce (cyan ring), die (red fade). Max 400 particles.
- **Event listeners**: Spawns particles on creature events, tracks totalBirths/totalDeaths. Emits `world:event` for UI notifications.

### Renderer (renderer.js)
- **Key class**: `EcoSim.Renderer`
- **Camera system**: `this.camera = {x, y, zoom}`. Default: centered on world, zoom=1. `screenToWorld(sx, sy)`, `zoomAt(sx, sy, factor)`, `resetCamera()`
- **Transform**: `finalScale = baseScale * camera.zoom`, offsetX/Y computed from camera center. Stored as `_scale`, `_offsetX`, `_offsetY` for inverse mapping
- **High-DPI**: Uses devicePixelRatio for crisp rendering on Retina displays
- **Creature rendering (v3.0 Bioluminescent)**: Semi-transparent membrane body with wobble, pulsing inner core glow (brightness = energy * luminosity), 2-5 bioluminescent spots, 2-4 trailing tendrils (bezier curves with wave motion), aggression aura (spiky membrane + red glow), reproduction heartbeat pulse rings, signal visualization (concentric expanding rings, gold/violet), action indicators (green core flash = eating, red energy flare = attacking)
- **Food rendering**: Plant spores with 3 radiating tendrils + glow, meat as irregular organic blobs (3 overlapping circles)
- **Trails**: Ethereal particle dots (2 per trail point with random offset, fading alpha)
- **Selection**: Animated dashed circle, info label ("Gen X | E:Y")
- **Minimap**: Shows creatures, food, zones, selection marker, and camera viewport rect (when zoomed)
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
- **Actions**: Add Food mode (f) — click adds cluster of 5, Spawn Creature, Screenshot (p), Reset
- **Camera**: Scroll=zoom toward cursor, Right-click drag=pan, WASD=move, +/-=zoom, Home=reset view, c=follow selected creature (zooms to 3x)
- **Follow-cam**: When zoomed > 1.2x with creature selected, camera auto-follows with smooth lerp (0.08 factor)
- **Click interaction**: Uses renderer.screenToWorld() for camera-aware coordinate mapping
- **Fullscreen**: Double-click canvas to toggle fullscreen (minimap/overlay visible in fullscreen)
- **Creature inspector**: Shows ID, gen, age, energy, size, speed, food eaten, kills, children, species, efficiency, aggression, signal. Includes genome viewer (color-coded gene bars) and "Show Family" toggle button for lineage visualization.
- **Keyboard shortcuts**: Space=pause, 1-4=speed, f=food, t=trails, v=vision, g=family view, m=sound toggle, Esc=deselect, WASD=camera pan, +/-=zoom, Home=reset camera, c=follow creature, p=screenshot

### Sound System (sound.js)
- **Key object**: `EcoSim.Sound` (singleton, not a class)
- **WebAudio API**: Uses oscillator nodes (no audio files). AudioContext created lazily on first user toggle (browser autoplay policy).
- **Ambient drone**: Two slightly detuned sine oscillators at ~55Hz with LFO gain modulation (0.08Hz breathing). Population modulates pitch (55-85Hz) and gain.
- **Creature sounds**: Event-driven via EcoSim.Events:
  - `creature:eat` → high-pitched sine blip (800-1200Hz, 80ms, gain 0.04)
  - `creature:attack` → sawtooth buzz (200-350Hz, 60ms, gain 0.06)
  - `creature:reproduce` → two-tone chime in perfect fifth (523-783Hz, 250ms, gain 0.08)
  - `creature:die` → descending sine tone (220Hz dropping to 88Hz, 300ms, gain 0.05)
- **Throttling**: Each sound type limited to one play per 100ms to prevent audio spam
- **Volume**: Master gain 0.08, individual sound gains 0.03-0.08. Very subtle.
- **Toggle**: `Sound.toggle()` / `Sound.enable()` / `Sound.disable()`, keyboard 'm'
- **Ambient update**: `Sound.updateAmbient(population)` called every 30 frames from main loop

### Main Loop (main.js)
- DOMContentLoaded → create World, Renderer, Stats, UI → requestAnimationFrame loop
- Per frame: N simulation ticks (based on TICKS_PER_FRAME) → render → brain viz (every 3rd) → stats → UI
- Error overlay on initialization failure
- Debug access: `EcoSim.world`, `EcoSim.renderer`, `EcoSim.stats` in browser console

## Configuration (config.js)
Key tunable values:
```
WORLD: 4800x2700, 50px grid cells
CREATURES: 150 initial, 800 max, 4-14 size, 3.5 max speed, 180 vision range
ENERGY: 100 initial, 250 max, 0.08 drain/tick, reproduction threshold 160, reproduction cost 70
NEURAL NET: 17→10→8→5 with tanh activations (313 params/brain)
FOOD: 6.0 spawn rate, 2500 max, 35 energy, 30% cluster chance
GENETICS: 15% mutation rate, 0.25 mutation strength, 5% crossover rate
RENDERING: 8-position trails, 400 max particles
EVENTS: 2000-4000 tick intervals, bloom(350px/100food), plague(500px/300ticks), meteor(250px kill), mutation storm(600ticks/4x)
ISLANDS: 2 islands (vertical split), 150px ocean gap, 0.03% migration chance/tick, 500 tick min interval
```

## Event System
`EcoSim.Events` — simple pub/sub: `on(event, fn)`, `emit(event, data)`, `off(event, fn)`

Events:
- `creature:eat` → `{ creature }` — when creature eats food
- `creature:attack` → `{ creature, target }` — when creature attacks another
- `creature:reproduce` → `{ creature, offspring }` — when creature reproduces
- `creature:die` → `{ creature }` — when creature dies
- `food:add` → `{ food }` — when food is manually added
- `world:event` → `{ type, label }` — when a world event triggers (bloom/plague/meteor/mutationStorm)
- `creature:migrate` → `{ creature, fromIsland, toIsland }` — when a creature migrates between islands

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

## v2.3 Enhancements (Feb 2026)
16. **Creature Communication (Signals)**: NN expanded to 17 inputs, 5 outputs. Output[4] = broadcast signal (-1 to 1). Input[16] = nearest creature's signal. Positive signals show as yellow rings, negative as purple. Enables emergent communication between creatures.
17. **Camera Pan/Zoom**: Scroll wheel zooms toward cursor. Right-click drag pans. WASD keyboard movement. Camera auto-follows selected creature when zoomed in (smooth lerp). Home key resets view. Zoom indicator in top-left.
18. **Screenshot Export**: Press 'p' or click button to download canvas as PNG with tick/generation in filename.
19. **Fullscreen Mode**: Double-click canvas to toggle fullscreen. Minimap, zoom indicator, and info overlay all visible in fullscreen.
20. **Backwards-Compatible Save Migration**: Old saves (v2, 16-input/4-output NN) automatically pad genome arrays with small random values when loaded, preserving evolved behaviors while adding new capabilities.

## v2.4 Enhancements (Feb 2026)
21. **Genome Viewer**: New visual gene bars in the creature inspector panel showing color-coded horizontal bars for 6 body genes (Size, Speed, Turn, Aggression, Efficiency, Saturation). Each bar displays the creature's value relative to its gene range. A white marker shows the population average for comparison. Gene colors: Size=#00d4ff (cyan), Speed=#7cff6b (bright green), Turn=#50e8d0 (teal), Aggression=#ff4757 (red), Efficiency=#ffa502 (orange), Saturation=#a55eea (purple). Configuration and ranges defined in ui.js with population averages calculated via `world.getPopulationGeneAverages()` which uses circular mean for hue.
22. **Lineage Tracking**: Added `childIds` array to Creature class, populated during reproduction. Creatures now track their direct offspring. Inspector displays parent ID (if parent is alive) in the children row. "Show Family" toggle button (keyboard: g) enables visual lineage display in the renderer. When active, dashed cyan lines connect selected creature to living children with cyan highlight rings around children. Dashed orange lines connect to parent (if alive) with orange highlight ring. `world.getCreatureById(id)` provides O(n) lookup. Serialization system saves and loads childIds with backwards compatibility (defaults to empty array for old saves).

## v2.5 Enhancements (Feb 2026)
23. **Creature Sound System (WebAudio)**: New `sound.js` module providing an ambient soundscape. Quiet background drone (two detuned sine oscillators at ~55Hz with LFO modulation) that shifts pitch with population size. Event-driven creature sounds: eating blip, attack buzz, reproduction chime, death descending tone. All sounds use one-shot oscillator nodes — no audio files. Throttled to max one sound per type per 100ms. Master gain 0.08, individual gains 0.03-0.08. Toggle via 'm' key or Sound button in Controls panel. AudioContext created lazily on first user gesture (browser autoplay policy compliant).

## v3.0 Visual Overhaul — Alien Bioluminescent Aesthetic (Feb 2026)
24. **Bioluminescent Creature Redesign**: Complete replacement of creature rendering. Creatures now have semi-transparent wobbling membranes, pulsing inner core glows (brightness tied to energy and luminosity gene), 2-5 bioluminescent spots, and 2-4 trailing tendrils with organic wave motion. High-aggression creatures get spiky membrane distortion and red glow auras. Reproduction creates heartbeat pulse rings. Signals show as concentric expanding rings (gold positive, violet negative). Actions create core flashes (green=eat, red=attack).
25. **New Luminosity Gene**: Added `luminosity` (range 0.3-1.0) to body genes. Controls creature base brightness. Mutates and evolves like other genes. Visible in genome viewer with teal color bar. New methods: `getGlowColor(alpha)` for bright inner core, `getMembraneColor(alpha)` for translucent outer membrane.
26. **Ethereal Trail & Death Effects**: Trails are now particle dots (2 per trail point with slight random offset) instead of line segments. Death animation features bright flash → expanding dissolving membrane → 8-12 drifting luminous particles.
27. **World Environment Overhaul**: Deep-sea radial gradient background, organic dot grid (no straight lines), organic membrane border with wobble and edge glow gradients, bioluminescent nebula zones (teal/cyan/violet with orbiting spore particles), enhanced food (plant spores with radiating tendrils, meat as irregular organic blobs), 3 types of ambient particles (120 total: spores with glow halos, drifters elongated/slow, sparks tiny/bright), 30 depth blobs for organic background noise.
28. **Enhanced Particle Effects**: Eat=burst of green-teal luminous sparks, Attack=orange-red energy flash with lightning bolt lines, Reproduction=double-ring with inner glow fill, Death=creature-colored particles drifting outward.
29. **CSS Bioluminescent Theme**: New accent colors (--teal, --violet), alternating panel title bar colors, panel hover glow, animated chart border gradient, speed button active pulse, header title pulse animation, subtitle shimmer gradient text, minimap teal glow border, stat value transition animation.

## v3.1 World Events + Camera + Balance (Feb 2026)
30. **World Events System**: Random events trigger every 2000-4000 ticks (configurable). 4 event types: **Food Bloom** (100 food in 350px radius, green glow effect), **Plague** (energy drain in 500px radius for 300 ticks, high-efficiency creatures resist), **Meteor Impact** (kills creatures in 250px blast, creates new fertile zone), **Mutation Storm** (4x mutation rate for 600 ticks). Visual effects rendered in world space. Events emit `world:event` on event bus.
31. **Event Notification Banner**: Floating banner at top of canvas showing event type name. Color-coded per event type (green/violet/orange/purple). Slides in, auto-hides after 3 seconds. CSS animations with backdrop blur.
32. **Left-Click Drag Camera**: Left mouse drag now pans camera (5px threshold distinguishes click from drag). Click still selects creatures. Cursor shows `grab`/`grabbing`. Right-click drag also still works.
33. **Population Balance**: Rebalanced for 4800x2700 world — food spawn rate 1.5→6.0, food max 600→2500, vision range 120→180, min population check 15/25→30/50.

## v3.2 Performance Optimization (Feb 2026)
34. **Gradient Sprite Caching**: Pre-rendered 12 hue-bucketed creature glow sprites + 2 food glow sprites + aggression aura sprite as 64x64 offscreen canvases. `drawImage()` replaces ~4,500 `createRadialGradient()` calls per frame. Background gradient cached per dayPhase.
35. **Level-of-Detail (LOD) Rendering**: 3 LOD tiers based on apparent pixel size (`creature.size * finalScale`). LOD 0 (<3px): single filled circle, 1 draw call. LOD 1 (3-8px): circle + glow sprite only. LOD 2 (>8px): full detail. Same tiers for food. Trails skipped for LOD 0 creatures.
36. **Simulation Tick Budgeting**: `SIM_BUDGET_MS=12` time-budgeted while loop replaces fixed for loop. At 10x speed: runs as many ticks as fit in 12ms. Rendering always gets its frame time. Smooth 60 FPS instead of 8 FPS stuttering.
37. **Spatial Grid Optimization**: Flat array grid (`col * GRID_ROWS + row`) replaces string-keyed hash. Bitwise truncation `(x/50)|0`. Bounds-clamped queries. Food grid dirty flag — only rebuild when food changes. Plague uses spatial query. NN `forward()` returns pre-allocated Float32Array directly.
38. **Grid Pattern Optimization**: `createPattern()` from 50x50 tile canvas. Single `fillRect()` replaces ~5,184 individual `arc()` calls.

## v3.3 Island System (Feb 2026)
39. **Multiple Islands**: World divided into 2-4 rectangular island regions separated by 150px "deep ocean" gaps. `ISLAND_COUNT` config: 1=disabled, 2=vertical split, 4=2x2 grid. Creatures confined to their island via boundary enforcement. Wall proximity NN inputs use island bounds. Food/zones/events all constrained to islands. Per-island minimum population. Rare migration events teleport creatures between islands with portal animation. Offspring inherit parent's island. Ocean rendered with dark fill, drifting bioluminescent particles, and glowing island edges. Minimap shows island boundaries. Inspector shows island assignment. Migration notification banner. Serialization preserves island state with backwards-compatible loading.

## Current State
- **Status**: FUNCTIONAL v3.3 — 13 files, ~9,000 lines
- **Latest features**: Island system (isolated evolution, migration events, ocean rendering)
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
