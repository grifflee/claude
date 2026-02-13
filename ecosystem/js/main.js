/**
 * EcoSim — Main Entry Point
 *
 * Initializes all subsystems and drives the game loop.
 * Last script loaded — all EcoSim modules are already available.
 */
(function () {
    'use strict';

    console.log(
        '%c\uD83E\uDDEC EcoSim - Evolutionary Ecosystem Simulator',
        'color: #00d4ff; font-size: 16px; font-weight: bold;'
    );
    console.log(
        '%cAccess simulation: EcoSim.world, EcoSim.renderer, EcoSim.stats',
        'color: #7cff6b;'
    );

    document.addEventListener('DOMContentLoaded', function () {
        try {
            // 1. Grab DOM elements
            var worldCanvas   = document.getElementById('world-canvas');
            var brainCanvas   = document.getElementById('brain-canvas');
            var popChart      = document.getElementById('pop-chart');
            var speciesChart  = document.getElementById('species-chart');
            var statsPanel    = document.getElementById('stats-panel');

            // 2. Create core instances
            var world = new EcoSim.World();
            world.init();

            var renderer = new EcoSim.Renderer(worldCanvas, brainCanvas);
            var stats    = new EcoSim.Stats(popChart, speciesChart, statsPanel);
            var ui       = new EcoSim.UI(world, renderer, stats);

            // 3. Expose globally for debugging
            EcoSim.world    = world;
            EcoSim.renderer = renderer;
            EcoSim.stats    = stats;

            // 4. Set initial UI state
            var speedBtn = document.querySelector('[data-speed="1"]');
            if (speedBtn) speedBtn.classList.add('active');

            var trailsToggle = document.querySelector('[data-toggle="trails"]');
            if (trailsToggle) trailsToggle.classList.add('active');

            renderer.showTrails = true;

            // 5. Game loop
            var frameCount = 0;

            function gameLoop(timestamp) {
                requestAnimationFrame(gameLoop);

                // Simulation ticks (TICKS_PER_FRAME controls speed)
                var ticksThisFrame = EcoSim.Config.TICKS_PER_FRAME;

                if (!world.paused && ticksThisFrame > 0) {
                    for (var i = 0; i < ticksThisFrame; i++) {
                        world.update();
                    }
                }

                // Always render (even when paused)
                renderer.render(world);

                // Brain visualization (every 3rd frame)
                frameCount++;
                if (frameCount % 3 === 0) {
                    renderer.renderBrain(world);
                }

                // Stats
                stats.update(world);
                stats.render();

                // UI
                ui.update();
            }

            requestAnimationFrame(gameLoop);

        } catch (err) {
            console.error('EcoSim failed to initialise:', err);
            console.error(err.stack);

            var overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
                'background:rgba(0,0,0,0.85);color:#ff4444;display:flex;flex-direction:column;' +
                'align-items:center;justify-content:center;font-family:monospace;font-size:16px;' +
                'padding:2rem;z-index:99999;text-align:center;';

            var title = document.createElement('h1');
            title.textContent = 'EcoSim — Initialisation Error';
            title.style.marginBottom = '1rem';

            var message = document.createElement('pre');
            message.textContent = err.message + '\n\n' + err.stack;
            message.style.cssText = 'max-width:80%;overflow:auto;white-space:pre-wrap;color:#ff8888;';

            overlay.appendChild(title);
            overlay.appendChild(message);
            document.body.appendChild(overlay);
        }
    });
})();
