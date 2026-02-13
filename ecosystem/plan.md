# EcoSim — Enhancement Plan

## Current State: v3.0 (Alien Bioluminescent Visual Overhaul)
The core simulation is fully functional with all planned enhancements: day/night cycle, food types, death animation, predator/prey specialization, creature memory, terrain zones, minimap, settings panel, multi-universe file-based save system with auto-save, genome viewer with population averages, lineage tracking with family tree visualization, creature sound system, evolution timeline, NN weight heatmap, creature export/import, and viewport culling. ~6,800 lines across 13 files.

---

## Phase 2: Polish & Bug Fixes (Priority: HIGH) -- COMPLETED

### 2.1 Fix lastAction Reset -- DONE
**File**: `creature.js`
**Fix applied**: Reset `this.lastAction = 'idle'` at the START of `update()`. Simplified the end-of-update check.

### 2.2 Fix Action Button Active State for Add Food -- DONE
**Fix applied**: Added `.action-btn.active` CSS rule with cyan highlight.

### 2.3 Improve Info Overlay
**File**: `ui.js` around line 230
**Issue**: `textContent` on `#info-overlay` destroys child `<span>` elements.
**Fix**: Either parse the overlay text into the three span elements, or simplify the HTML to a single container (simpler).

### 2.4 Creature Death Cleanup
**File**: `world.js` update loop
**Issue**: When creatures die from energy drain during `creature.update()`, the death event fires correctly via `creature.die()`. But there's a second check at line 244 that removes dead creatures — this is correct for cleanup but make sure no double-remove happens.
**Status**: Already fixed during integration review. Verify it works in practice.

---

## Phase 3: Visual Enhancements (Priority: MEDIUM) -- MOSTLY COMPLETED

### 3.1 Ambient Background Particles -- DONE
40 slowly drifting blue particles with 0.02-0.05 alpha, drawn before food, wrap around edges.

### 3.2 Creature Size-Based Rendering Detail -- DONE
Size>10: extra tail segment behind body. Size<6: skip eyes for simpler circle rendering.

### 3.3 Food Spawn Animation -- DONE
Food fades in over first 10 ticks using `spawnFade = min(1, f.age / 10)` in renderer.

### 3.4 Death Animation -- DONE
`world.dyingCreatures` array holds {x,y,size,hue,sat,ticksLeft:20}. Renderer draws them fading/shrinking.

### 3.5 Day/Night Cycle -- DONE
Config: `DAY_CYCLE_LENGTH: 3000`, `DAY_FOOD_MULTIPLIER: 0.5`. World modulates food spawn rate. Renderer modulates background RGB brightness (10-18 range).

### 3.6 Minimap -- DONE
160x90 canvas in top-left corner. Shows colored creature dots, green/red food pixels, zone highlights, selected creature marker. Rendered each frame in `renderer.renderMinimap()`.

---

## Phase 4: Simulation Depth (Priority: MEDIUM-HIGH) -- PARTIALLY COMPLETED

### 4.1 Predator/Prey Specialization -- DONE
- Aggression > 0.7: red tint overlay + attack range bonus (up to +30%)
- Aggression < 0.3: speed bonus (up to +15%)
- Implemented in world.js (_checkAttacking), creature.js (speed calc), renderer.js (red overlay)

### 4.2 Creature Memory / Recurrence -- DONE
NN_INPUT_SIZE: 12→16. Inputs 12-15 are brain.lastOutputs from previous tick. Updated config.js, world.js (buildSensoryInputs), renderer.js (INPUT_LABELS).

### 4.3 Food Types -- DONE
- Food objects have `type: 'plant'|'meat'` field
- Config: `MEAT_ENERGY: 60`, `MEAT_SPAWN_CHANCE: 0.7`
- Meat spawns at death locations via creature:die event listener
- Renderer: plants=green glow, meat=red glow, different core colors
- Meat is slightly larger (FOOD_SIZE + 1.5)

### 4.4 Terrain / Zones -- DONE
2-3 fertile zones with radii 120-200px, 2-4x food spawn boost. 40% chance food spawns in a zone. Zones drift slowly and bounce off edges. Rendered as faint green radial gradients. Visible on minimap.

### 4.5 Creature Communication -- DONE
- NN_INPUT_SIZE: 16→17, NN_OUTPUT_SIZE: 4→5
- Output[4] = signal broadcast (-1 to 1)
- Input[16] = nearest creature's signal
- Positive signals rendered as yellow rings, negative as purple
- Backwards-compatible: old saves auto-pad genome arrays

### 4.6 Improved Genetics / Genome Viewer -- DONE
- Visual gene bars in inspector showing 6 body genes (size, maxSpeed, turnSpeed, hue, saturation, aggression) as colored horizontal bars
- Population average markers displayed on each bar for comparative reference
- Efficiency is shown as a separate row below genes
- Implemented in: `ui.js` (visual rendering), `world.js` (getPopulationGeneAverages), `style.css` (bar styling), `index.html` (gene bar HTML)

---

## Phase 5: UI & Quality of Life (Priority: MEDIUM) -- PARTIALLY COMPLETED

### 5.1 Creature Lineage Tracking -- DONE
- Added `childIds` array to Creature class (populated during reproduction)
- `getCreatureById()` helper in world.js for fast family lookups
- "Show Family" button in inspector (keyboard shortcut: g) toggles lineage visualization
- Renderer draws connection lines: dashed cyan lines to children, dashed orange line to parent
- Backwards-compatible serialization — old saves load without childIds field
- Implemented in: `creature.js` (childIds array), `world.js` (getCreatureById, getPopulationGeneAverages), `renderer.js` (family line rendering), `ui.js` (Show Family button)

### 5.2 Population Graph Improvements -- DONE
- Birth rate (orange) and death rate (red) lines overlaid on population chart with secondary Y axis
- Rates computed as delta between consecutive samples per interval
- Species count overlay text on species chart (top-right corner)
- Added tick counter to stats panel
- Legend updated with birth/death rate values
- Population chart height increased to 130px to fit expanded legend

### 5.3 Settings Panel -- DONE
- Collapsible section in sidebar (click title to toggle)
- 5 live sliders: Mutation Rate, Mutation Strength, Food Spawn Rate, Energy Drain, Day Cycle Length
- Updates Config values directly on input change
- Implemented in index.html (HTML), style.css (slider styles), ui.js (initSettings method)

### 5.4 Save/Load State -- DONE (v2.2: Multi-Universe + File-Based)
Complete rewrite to multi-universe system with auto-save:
- `serialization.js` (~415 lines) — server API + localStorage fallback
- `server.py` (~199 lines) — Python HTTP server with REST API for file-based saves
- `saves/` directory — JSON universe files on disk
- Universe panel in sidebar: Save, New, Export, Import buttons + clickable universe list
- Auto-save every 3000 ticks with visual indicator
- Auto-saves current universe before switching to another

### 5.5 Screenshot Export -- DONE
Press 'p' or click Screenshot button. Downloads canvas as PNG with tick/generation in filename.

### 5.6 Fullscreen Mode -- DONE
Double-click canvas to toggle fullscreen. Minimap, zoom indicator, and info overlay all visible in fullscreen.

---

## Phase 6: Performance Optimization (Priority: LOW — only if needed)

### 6.1 Offscreen Trail Canvas
**File**: `renderer.js`
**Description**: Trails are expensive because they draw many small line segments. Use an offscreen canvas that persists between frames and slowly fades (multiply by 0.95 alpha each frame), then draw new trail points on top. Dramatically reduces draw calls.

### 6.2 Creature Draw Batching
**File**: `renderer.js`
**Description**: Batch creatures by similar hue/saturation and draw in groups to reduce canvas state changes. Pre-compute colors as hex strings.

### 6.3 Web Worker Simulation
**File**: New `worker.js`
**Description**: Move the simulation (world.update) to a Web Worker. Renderer stays on main thread. Communicate via postMessage with creature positions/states.
**Complexity**: HIGH — requires serializing world state each frame.

### 6.4 Viewport Culling -- DONE
- `getViewBounds()` computes visible world area from camera transform with 50px margin
- Bounds passed to drawFood, drawCreatureTrails, drawCreatures, drawParticles
- Each draw method skips entities outside bounds with simple AABB check
- Only active when zoomed in (camera.zoom > 1.0) — zero overhead at default zoom
- Null-check pattern: `bounds && (x < left || ...)` short-circuits when bounds is null

---

## Phase 7: Advanced Features (Priority: LOW — stretch goals)

### 7.1 Camera Pan/Zoom -- DONE
- Scroll wheel zooms toward cursor (0.5x to 12x range)
- Right-click drag pans the camera
- WASD keyboard movement, +/- to zoom, Home to reset
- Auto-follows selected creature when zoomed in (smooth lerp)
- 'C' key or Follow button centers camera on selected creature and zooms to 3x
- Camera viewport shown on minimap when zoomed in
- Zoom indicator displays in top-left when zoomed

### 7.2 Multiple Worlds / Islands
**Description**: Split the world into 2-4 separate islands with occasional migration between them. Creates isolated evolutionary paths that occasionally mix.

### 7.3 Creature Sound -- DONE
- WebAudio API ambient soundscape: quiet drone modulated by population size
- Event-driven sounds: eat (blip), attack (buzz), reproduce (chime), death (descending tone)
- All sounds very quiet (master gain 0.08), throttled to prevent audio spam
- Toggle button in UI, AudioContext created on first user gesture
- New file: `sound.js`

### 7.4 Evolution Timeline -- DONE
- New "Evolution" chart in sidebar tracking population-average traits over time
- 4 trait lines: Size (cyan), Speed (green), Aggression (red), Efficiency (orange)
- Each normalized to 0-1 within its gene range, smooth quadratic curves
- Sampled every 10 ticks alongside population history
- New canvas `evo-chart` (300x100) in sidebar between species chart and stats

### 7.5 Neural Network Weight Heatmap -- DONE
- Weight matrix heatmap visualization below brain network diagram
- 3 matrices drawn as colored grids (W1: 17x10, W2: 10x8, W3: 8x5)
- Positive weights = cyan, negative = orange, intensity = magnitude
- New canvas `heatmap-canvas` (300x60) in inspector chart-wrapper
- Rendered every 3rd frame alongside brain viz

### 7.6 Export Creature -- DONE
- Export selected creature as JSON file with full genome, body genes, and stats
- Import creature from JSON file into simulation at random position
- Export/Import buttons in inspector actions panel
- File format includes version, type validation, brain genome arrays
- Backwards-compatible with genome format

---

## Implementation Strategy

When continuing development:
1. **Read CLAUDE.md first** — it has complete architecture documentation
2. **Test in browser** — open `ecosystem/index.html`, check console for errors
3. **Use agents for large features** — spawn Opus agents for independent components
4. **Keep it vanilla** — no build tools, no npm, no frameworks. ES5 `var` style.
5. **Test after each change** — refresh browser, check console, verify visuals
6. **Performance matters** — the simulation runs 60fps with hundreds of creatures. Profile before/after changes to render/update loops.

### Recommended Build Order (Updated)
~~1. Phase 2 (bug fixes)~~ DONE
~~2. Phase 4.1, 4.3 (predator/prey, food types)~~ DONE
~~3. Phase 3.1-3.6 (all visual enhancements)~~ DONE
~~4. Phase 5.3 (settings panel)~~ DONE
~~5. Phase 4.2 (creature memory)~~ DONE
~~6. Phase 5.4 (save/load)~~ DONE
~~7. Phase 4.4 (terrain zones)~~ DONE
~~8. Phase 4.5 (creature communication) — signal output/input~~ DONE
~~9. Phase 5.5 (screenshot) + Phase 5.6 (fullscreen)~~ DONE
~~10. Phase 7.1 (camera pan/zoom + follow-cam)~~ DONE
~~11. Phase 4.6 (genome viewer) + Phase 5.1 (lineage tracking)~~ DONE
~~12. Phase 5.2 (graph improvements)~~ DONE
~~13. Phase 7.3 (creature sound) + Phase 7.4 (evolution timeline) + Phase 7.5 (NN heatmap) + Phase 7.6 (export creature) + Phase 6.4 (viewport culling)~~ DONE
~~14. Phase 8 (Full Visual Overhaul — Alien Bioluminescent)~~ DONE
15. **NEXT**: Phase 7.2 (multiple worlds/islands)

---

## Phase 8: Full Visual Overhaul — Alien Bioluminescent Aesthetic -- DONE

### 8.1 Creature Redesign -- DONE
- Replaced circle+eyes+nose with bioluminescent organisms
- Outer membrane: semi-transparent elliptical body with subtle wobble
- Inner core glow: pulsing radial gradient, brightness scales with energy
- Bioluminescent spots: 2-5 glowing dots on membrane (deterministic per creature)
- Trailing tendrils: 2-4 quadratic bezier curves with organic wave motion
- Aggression aura: spiky membrane distortion + red glow for high-aggression creatures
- Reproduction heartbeat: expanding pulse rings when above threshold
- Signal visualization: concentric expanding rings (gold/violet)
- Action indicators: green core flash (eating), red energy flare (attacking)
- New `luminosity` body gene controls base brightness (0.3-1.0, evolvable)

### 8.2 Trail & Death Effects -- DONE
- Ethereal particle trails: glowing dots with slight random offset, not line segments
- Death animation: bright flash → expanding dissolving membrane → 8-12 drifting luminous particles

### 8.3 World Environment -- DONE
- Deep-sea radial gradient background (day/night modulated)
- Organic dot grid instead of straight lines
- Organic membrane border with wobble and edge glow gradients
- Bioluminescent nebula zones (teal/cyan/violet colors, orbiting spore particles)
- Enhanced food: plant spores with radiating tendrils, meat as irregular organic blobs
- 3 types of ambient particles: spores (glow halos), drifters (elongated), sparks (tiny/bright)
- 30 depth blobs for organic background noise

### 8.4 Particle Effects -- DONE
- Eat: burst of green-teal luminous sparks with central glow
- Attack: orange-red energy flash with lightning bolt lines
- Reproduction ring: double-ring with inner glow fill
- Death: burst of creature-colored particles with fading central glow

### 8.5 CSS Overhaul -- DONE
- New accent colors: --teal (#00e5c8) and --violet (#b464ff)
- Panel title bars alternate cyan/teal/violet
- Panel hover glow, chart wrapper animated border gradient
- Speed button pulsing active glow, action button enhanced hover
- Header title pulse animation, subtitle shimmer gradient
- Minimap teal glow border, stat value transition

### 8.6 Creature System Updates -- DONE
- New `luminosity` body gene (range 0.3-1.0, mutates, serialized)
- `getGlowColor(alpha)` — bright/saturated for inner core
- `getMembraneColor(alpha)` — desaturated for outer membrane
- `tendrilCount`, `tendrilSeeds`, `spotSeeds` per creature (deterministic from ID)
- Backwards-compatible: old saves default luminosity to 0.7

---

## Quick Reference: Key Classes & Methods

```
EcoSim.NeuralNetwork(genome?)
  .forward(inputs[17]) → outputs[5]
  .mutate(rate, strength)
  .getGenome() → {weights1,biases1,...}
  static .crossover(nn1, nn2) → nn

EcoSim.Creature(options?)
  .update(inputs[17])    — brain + movement + energy + signal
  .eat(energy)           — gain food energy
  .attack(other)         — damage other creature
  .reproduce(partner?)   → offspring Creature
  .die()                 — mark dead, emit event
  .getColor(alpha) → 'hsla(...)'
  .getInfo() → {...all stats}
  static .mutateBodyGenes(genes, rate, str) → genes

EcoSim.World()
  .init()                — reset and populate
  .update()              — one simulation tick
  .buildSensoryInputs(creature) → inputs[12]
  .getNearbyCreatures(x, y, range) → [creatures]
  .getNearbyFood(x, y, range) → [food]
  .addFood(x, y)
  .addCreature(x, y)
  .selectCreature(x, y) → creature|null
  .getStats() → {tick, population, foodCount, ...}

EcoSim.Renderer(worldCanvas, brainCanvas)
  .render(world)         — main frame render
  .renderBrain(world)    — neural net visualization
  .resize()              — fit to container

EcoSim.Stats(popCanvas, speciesCanvas, statsPanel)
  .update(world)         — sample data
  .render()              — draw charts + panel

EcoSim.UI(world, renderer, stats)
  .update()              — per-frame UI update
  .updateCreatureInspector()
```
