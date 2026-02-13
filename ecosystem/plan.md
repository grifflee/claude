# EcoSim — Enhancement Plan

## Current State: v1 Complete
The core simulation is functional: creatures with neural network brains evolve in a 2D world with food, predation, reproduction, and speciation. All UI controls, charts, and creature inspection work. ~3,800 lines across 10 files.

---

## Phase 2: Polish & Bug Fixes (Priority: HIGH)

### 2.1 Fix lastAction Reset
**File**: `creature.js` line 260-263
**Issue**: `lastAction` ('eating', 'attacking', 'reproducing') doesn't reset to 'idle'/'moving' quickly enough, causing flash effects to persist.
**Fix**: At the START of `Creature.prototype.update()`, reset `this.lastAction = 'idle'` before processing brain outputs. The action will be set again if the creature actually eats/attacks/reproduces this tick.

### 2.2 Fix Action Button Active State for Add Food
**File**: `ui.js`, `style.css`
**Issue**: The "Add Food (click)" button uses `.active` class but the `.action-btn.active` style may not be defined.
**Fix**: Add CSS rule for `.action-btn.active` with cyan highlight, similar to toggle buttons.

### 2.3 Improve Info Overlay
**File**: `ui.js` around line 230
**Issue**: `textContent` on `#info-overlay` destroys child `<span>` elements.
**Fix**: Either parse the overlay text into the three span elements, or simplify the HTML to a single container (simpler).

### 2.4 Creature Death Cleanup
**File**: `world.js` update loop
**Issue**: When creatures die from energy drain during `creature.update()`, the death event fires correctly via `creature.die()`. But there's a second check at line 244 that removes dead creatures — this is correct for cleanup but make sure no double-remove happens.
**Status**: Already fixed during integration review. Verify it works in practice.

---

## Phase 3: Visual Enhancements (Priority: MEDIUM)

### 3.1 Ambient Background Particles
**File**: `renderer.js`
**Description**: Add slowly drifting, very faint particles in the background to give the world a living, atmospheric feel. Could be dust motes or energy wisps.
**Implementation**:
- Add array of 30-50 ambient particles in renderer constructor
- Each: {x, y, vx, vy, alpha, size} — very slow movement, very low alpha (0.02-0.05)
- Draw before food layer
- Wrap around screen edges

### 3.2 Creature Size-Based Rendering Detail
**File**: `renderer.js`
**Description**: Larger creatures should look more detailed — maybe add more body segments or a mouth. Very small creatures can be simpler circles.
**Implementation**: If `creature.size > 10`, draw an extra body segment. If `creature.size < 6`, skip eyes.

### 3.3 Food Spawn Animation
**File**: `renderer.js`, `world.js`
**Description**: When food spawns, have it fade in over a few frames rather than popping into existence.
**Implementation**: Add a `spawnAge` property to food. In renderer, multiply alpha by `min(1, food.age / 10)`.

### 3.4 Death Animation
**File**: `renderer.js`
**Description**: When a creature dies, briefly show its body fading out and shrinking before removing it.
**Implementation**: Keep dead creatures in a separate `dyingCreatures` array for 20 ticks. Render them with decreasing alpha and size.

### 3.5 Day/Night Cycle
**File**: `renderer.js`, `world.js`, `config.js`
**Description**: Gradual background color cycling between dark blue (night) and slightly lighter blue (day). Food spawns faster during "day."
**Implementation**:
- Add `DAY_CYCLE_LENGTH: 3000` to config (ticks per full cycle)
- World modulates `FOOD_SPAWN_RATE` by `0.5 + 0.5 * sin(tick / DAY_CYCLE_LENGTH * TAU)`
- Renderer modulates background brightness similarly

### 3.6 Minimap
**File**: New section in `renderer.js` or small helper
**Description**: Small overview map in corner showing creature density as a heatmap.
**Implementation**: Draw to a small offscreen canvas (160x90), one pixel per 10x10 world area, color by creature count.

---

## Phase 4: Simulation Depth (Priority: MEDIUM-HIGH)

### 4.1 Predator/Prey Specialization
**File**: `creature.js`, `world.js`
**Description**: Currently aggression is a body gene but doesn't strongly influence behavior (the brain decides). Add a visual indicator and make aggression affect attack damage/range.
**Implementation**:
- Creatures with `aggression > 0.7` get a red tint overlay and slightly larger attack range
- Creatures with `aggression < 0.3` get a slight speed bonus (prey adaptation)
- This creates stronger evolutionary pressure for specialization

### 4.2 Creature Memory / Recurrence
**File**: `neural.js`, `config.js`
**Description**: Add 2-4 recurrent inputs to the neural network — the previous tick's outputs fed back as inputs. This gives creatures simple "memory" for more complex behaviors.
**Implementation**:
- Increase NN_INPUT_SIZE from 12 to 16
- Inputs 12-15: previous outputs[0-3]
- Update `buildSensoryInputs()` in world.js to append previous outputs
- Store `lastOutputs` on creature (already stored on brain.lastOutputs)

### 4.3 Food Types
**File**: `world.js`, `renderer.js`, `config.js`
**Description**: Two food types — plants (green, common, low energy) and meat (red, rare, appears where creatures die, high energy). This creates ecological niches.
**Implementation**:
- Food objects get a `type` field: 'plant' or 'meat'
- Meat spawns at death locations (modify creature:die listener)
- Renderer colors them differently (green vs red glow)
- Plant energy: 25, Meat energy: 60

### 4.4 Terrain / Zones
**File**: `world.js`, `renderer.js`, `config.js`
**Description**: Add 2-3 circular "fertile zones" where food spawns more frequently, creating migration pressure and territorial behavior.
**Implementation**:
- `World.zones = [{x, y, radius, spawnMultiplier}]` — 2-3 random zones
- Food spawn probability multiplied by zone influence
- Renderer draws faint green circles for fertile zones
- Zones slowly drift over time (very slow — 0.01 px/tick)

### 4.5 Creature Communication (Advanced)
**File**: `creature.js`, `neural.js`, `world.js`
**Description**: Add a "signal" output to the neural network — a value that nearby creatures can sense. This enables emergent communication.
**Implementation**:
- Add output[4]: signal value (-1 to 1)
- Add input[16]: nearest creature's signal value
- Increase NN sizes accordingly
- Store `creature.signal` each tick

### 4.6 Improved Genetics / Genome Viewer
**File**: `ui.js`, `renderer.js`
**Description**: Show a visual genome comparison when inspecting a creature — color-coded bars for each body gene relative to population average.
**Implementation**: Draw horizontal bars in the inspector panel below the brain canvas.

---

## Phase 5: UI & Quality of Life (Priority: MEDIUM)

### 5.1 Creature Lineage Tracking
**File**: `creature.js`, `ui.js`, `world.js`
**Description**: Track family trees. When inspecting a creature, show its parent and highlight its children in the world.
**Implementation**:
- Already have `parentId` and `children` count
- Add `childIds` array to creature
- UI: "Show children" button highlights all living descendants
- Renderer: Draw faint lines from selected creature to its children

### 5.2 Population Graph Improvements
**File**: `stats.js`
**Description**: Add births/deaths rate overlay, species count line, and ability to click on the chart to jump to that time (or at least show tooltip).

### 5.3 Settings Panel
**File**: New `settings.js` or extend `ui.js`, add HTML section
**Description**: Sliders for key simulation parameters (mutation rate, food spawn rate, energy drain). Allow live tuning without code changes.
**Implementation**:
- Add a collapsible "Settings" section to sidebar
- Range inputs for: MUTATION_RATE, MUTATION_STRENGTH, FOOD_SPAWN_RATE, CREATURE_ENERGY_DRAIN
- On change, update `EcoSim.Config` values directly (they're read each tick)

### 5.4 Save/Load State
**File**: New `serialization.js`
**Description**: Save the entire world state to JSON and reload it. Enables bookmarking interesting evolutionary moments.
**Implementation**:
- Serialize: all creatures (position, genes, brain genome, stats), food positions, world tick/counters
- Deserialize: reconstruct all objects
- Use localStorage or download as .json file
- Add Save/Load buttons to UI

### 5.5 Screenshot / GIF Export
**File**: New functionality in `ui.js`
**Description**: "Screenshot" button that downloads the current canvas as PNG. Bonus: record last N frames as GIF using a small library.

### 5.6 Fullscreen Mode
**File**: `ui.js`
**Description**: Double-click canvas to go fullscreen. Hide sidebar, maximize canvas.

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

### 6.4 Spatial Grid for Food Rendering
**File**: `renderer.js`
**Description**: Only render food visible in the viewport (if we add panning/zooming).

---

## Phase 7: Advanced Features (Priority: LOW — stretch goals)

### 7.1 Camera Pan/Zoom
**Description**: WASD or click-drag to pan, scroll to zoom. Follow-cam on selected creature.

### 7.2 Multiple Worlds / Islands
**Description**: Split the world into 2-4 separate islands with occasional migration between them. Creates isolated evolutionary paths that occasionally mix.

### 7.3 Creature Sound
**Description**: WebAudio API — creatures make quiet sounds based on their hue (pitch) and activity. Creates an ambient soundscape that reflects the ecosystem state.

### 7.4 Evolution Timeline
**Description**: Record the genome of the "most fit" creature every N ticks. Show a timeline visualization of how the dominant genome changed over time.

### 7.5 Neural Network Training Visualization
**Description**: Show weight changes over generations as a heatmap — which connections are being selected for?

### 7.6 Export Creature
**Description**: Export a creature's genome as JSON. Import it into another simulation. Share creatures between users.

---

## Implementation Strategy

When continuing development:
1. **Read CLAUDE.md first** — it has complete architecture documentation
2. **Test in browser** — open `ecosystem/index.html`, check console for errors
3. **Use agents for large features** — spawn Opus agents for independent components
4. **Keep it vanilla** — no build tools, no npm, no frameworks. ES5 `var` style.
5. **Test after each change** — refresh browser, check console, verify visuals
6. **Performance matters** — the simulation runs 60fps with hundreds of creatures. Profile before/after changes to render/update loops.

### Recommended Build Order
1. Phase 2 (bug fixes) — quick wins, ~30 min
2. Phase 4.1-4.3 (predator/prey, food types) — adds gameplay depth, ~1 hr
3. Phase 3.1, 3.3, 3.5 (ambient particles, food animation, day/night) — visual polish, ~45 min
4. Phase 5.3 (settings panel) — user control, ~30 min
5. Phase 4.2 (creature memory) — neural net enhancement, ~45 min
6. Phase 5.4 (save/load) — persistence, ~1 hr
7. Everything else as time permits

---

## Quick Reference: Key Classes & Methods

```
EcoSim.NeuralNetwork(genome?)
  .forward(inputs[12]) → outputs[4]
  .mutate(rate, strength)
  .getGenome() → {weights1,biases1,...}
  static .crossover(nn1, nn2) → nn

EcoSim.Creature(options?)
  .update(inputs[12])    — brain + movement + energy
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
