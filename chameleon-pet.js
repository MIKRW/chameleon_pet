/**
 * ChameleonPet — thin bootstrap. Wires together the other modules and does
 * nothing else:
 *
 *   chameleon-themes.js     - color palettes (data)
 *   chameleon-sprite.js     - pure drawing (pose + palette -> pixels)
 *   chameleon-actions.js    - reaction recipes per target key
 *   behaviours/*.js         - the state machine's behaviour logic, split by
 *                             standard / user-interaction / desktop-interaction
 *   chameleon-behavior.js   - state machine coordinator (DOM-agnostic)
 *   chameleon-pet.js (you are here) - sensing + glue:
 *     - finds/watches site elements (theme/resume/email buttons, or
 *       whatever `targets` selectors are configured)
 *     - tracks window size and page background
 *     - forwards raw pointer/click events into the behavior state machine
 *     - runs the animation loop, asking behavior for a pose each frame
 *       and handing it to the sprite module to draw
 *     - exposes the public API (init/setPalette/setTheme/destroy)
 *
 * Load order matters: themes, sprite, actions, behaviours/*, behavior, then this file.
 *
 * Usage:
 *   ChameleonPet.init();
 *
 * Targets are located generically via data-chameleon-target="theme" |
 * "resume" | "email" attributes, with #theme-toggle / #resume-download /
 * #email-link as ID fallbacks — so this works on any site without editing
 * any file, just tag your buttons. To add a new interactive element, add
 * its selector to `targets` below (or via config) and a matching recipe
 * in chameleon-actions.js.
 */
(function (global) {
  'use strict';

  const FALLBACK_PALETTE = {
    body: '#1f4a3d',
    bodyLight: '#3d8a6b',
    bodyDark: '#0e2620',
    outline: '#081713',
    crest: '#0e2620',
    eye: '#0a0a0a',
    eyeRing: '#c9a24b',
    tongue: '#b23a63',
  };

  const DEFAULT_CONFIG = {
    scale: 4, // internal-pixel -> screen-pixel multiplier
    edgeMargin: 4, // px inset of the walkable perimeter from the window's true edge
    wanderSpeed: 55, // px/sec
    tongueMode: 'original', // 'original' | 'middle' | 'snappy' — see TONGUE_MODES in behaviours/standard-behaviour.js
    palette: (global.ChameleonThemes && global.ChameleonThemes.shadow) || FALLBACK_PALETTE,
    targets: {
      theme: '[data-chameleon-target="theme"], #theme-toggle',
      resume: '[data-chameleon-target="resume"], #resume-download',
      email: '[data-chameleon-target="email"], #email-link',
    },
  };

  class ChameleonPet {
    constructor(config) {
      this.config = Object.assign({}, DEFAULT_CONFIG, config, {
        palette: Object.assign({}, DEFAULT_CONFIG.palette, config && config.palette),
        targets: Object.assign({}, DEFAULT_CONFIG.targets, config && config.targets),
      });

      this.paletteOverride = null;
      this._boundTargets = new Set();
      this._raf = null;
      this._lastTime = performance.now();

      this._buildDom();
      this.resize(); // establishes viewW/viewH before behavior reads them

      const world = {
        viewport: () => ({ w: this.viewW, h: this.viewH }),
        edgeMargin: () => this.config.edgeMargin,
        targetRect: (key) => this._targetRect(key),
        targetKeys: () => Object.keys(this.config.targets),
        elementAt: (x, y) => this._elementAt(x, y),
        rectForRef: (ref) => (document.contains(ref) ? ref.getBoundingClientRect() : null),
      };
      this.behavior = new global.ChameleonBehavior(world, {
        wanderSpeed: this.config.wanderSpeed,
        tongueMode: this.config.tongueMode,
      });

      this._bindEvents();

      this._loop = this._loop.bind(this);
      this._raf = requestAnimationFrame(this._loop);
    }

    // ---------- sensing: DOM setup ----------

    _buildDom() {
      const canvas = document.createElement('canvas');
      canvas.style.position = 'fixed';
      canvas.style.left = '0';
      canvas.style.top = '0';
      canvas.style.zIndex = '2147483000';
      canvas.style.pointerEvents = 'none'; // hitbox handled manually on the sprite region
      canvas.style.imageRendering = 'pixelated';
      canvas.setAttribute('aria-hidden', 'true');
      document.body.appendChild(canvas);
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');

      // Offscreen low-res buffer the chameleon is drawn onto, then scaled up.
      this.buffer = document.createElement('canvas');
      this.buffer.width = global.ChameleonSprite.WIDTH;
      this.buffer.height = global.ChameleonSprite.HEIGHT;
      this.bctx = this.buffer.getContext('2d');

      // Invisible hit-area element so the pet can receive pointer events
      // without the full-viewport canvas blocking clicks on the page.
      const hit = document.createElement('div');
      hit.style.position = 'fixed';
      hit.style.zIndex = '2147483001';
      hit.style.cursor = 'grab';
      hit.style.background = 'transparent';
      document.body.appendChild(hit);
      this.hitEl = hit;
    }

    // ---------- sensing: site elements + window ----------

    _findTarget(key) {
      const selector = this.config.targets[key];
      if (!selector) return null;
      return document.querySelector(selector);
    }

    _targetRect(key) {
      const el = this._findTarget(key);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
      return rect;
    }

    // Finds whatever's under (x, y) for a perch drop, ignoring the pet's
    // own hit-area (temporarily made click-through so it doesn't just find
    // itself) and skipping anything too small/generic to sensibly perch on.
    _elementAt(x, y) {
      const prevPointerEvents = this.hitEl.style.pointerEvents;
      this.hitEl.style.pointerEvents = 'none';
      const el = document.elementFromPoint(x, y);
      this.hitEl.style.pointerEvents = prevPointerEvents;
      if (!el || el === document.body || el === document.documentElement) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 24) return null;
      return { rect, ref: el };
    }

    _bindEvents() {
      global.addEventListener('resize', () => this.resize());

      this.hitEl.addEventListener('pointerdown', (e) => {
        this.behavior.onPointerDown(e.clientX, e.clientY);
        this.hitEl.style.cursor = 'grabbing';
        this.hitEl.setPointerCapture(e.pointerId);
      });
      global.addEventListener('pointermove', (e) =>
        this.behavior.onPointerMove(e.clientX, e.clientY)
      );
      global.addEventListener('pointerup', () => {
        this.behavior.onPointerUp();
        this.hitEl.style.cursor = 'grab';
      });
      this.hitEl.addEventListener('click', () => this.behavior.onClickedSelf());

      // React to real clicks on watched buttons even if the pet isn't there.
      // Re-checked on every DOM mutation too, so buttons added later by a
      // still-in-development page get picked up without a manual re-init.
      this._bindTargetClicks();
      this._observer = new MutationObserver(() => this._bindTargetClicks());
      this._observer.observe(document.body, { childList: true, subtree: true });
    }

    _bindTargetClicks() {
      for (const key of Object.keys(this.config.targets)) {
        if (this._boundTargets.has(key)) continue;
        const el = this._findTarget(key);
        if (!el) continue;
        el.addEventListener('click', () => this.behavior.reactTo(key));
        this._boundTargets.add(key);
      }
    }

    resize() {
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      const cssW = global.innerWidth;
      const cssH = global.innerHeight;
      this.canvas.width = cssW * dpr;
      this.canvas.height = cssH * dpr;
      this.canvas.style.width = cssW + 'px';
      this.canvas.style.height = cssH + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.viewW = cssW;
      this.viewH = cssH;
    }

    // ---------- render loop ----------

    _currentPalette() {
      const base = this.paletteOverride || this.config.palette;
      return this.behavior.getPalette(base);
    }

    // Canvas2D always antialiases vector fills/strokes, even with
    // imageSmoothingEnabled off (that flag only governs how drawImage
    // scales the buffer up, not how the shapes were rasterized onto it in
    // the first place). On the large filled shapes (body, crest, casque,
    // eye turret) that antialiasing shows up as a faint translucent halo
    // ringing an otherwise-solid area, since almost the whole shape is
    // already near-opaque — clipping only the extremes (near-0 alpha to
    // fully transparent, near-255 to fully opaque) removes that ghost
    // fringe. Thin strokes (legs, tail, tongue, nose/eye accents) are
    // mid-coverage across most of their width even at full opacity, since
    // a sub-pixel-wide line can't fully cover a pixel row — clamping their
    // whole alpha range the same way as the fills would erase most of
    // those pixels and read as gaps/disconnected segments, so the
    // untouched middle band here deliberately leaves them soft.
    _crispEdges() {
      const w = global.ChameleonSprite.WIDTH;
      const h = global.ChameleonSprite.HEIGHT;
      const imageData = this.bctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      for (let i = 3; i < data.length; i += 4) {
        const a = data[i];
        if (a < 30) data[i] = 0;
        else if (a > 200) data[i] = 255;
      }
      this.bctx.putImageData(imageData, 0, 0);
    }

    draw() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.viewW, this.viewH);

      const pose = this.behavior.getPose();
      global.ChameleonSprite.draw(this.bctx, pose, this._currentPalette());
      this._crispEdges();

      const sw = global.ChameleonSprite.WIDTH * this.config.scale;
      const sh = global.ChameleonSprite.HEIGHT * this.config.scale;
      const anchorX = global.ChameleonSprite.ANCHOR_X * this.config.scale;
      const anchorY = global.ChameleonSprite.ANCHOR_Y * this.config.scale;

      // Pivot on the sprite's feet, not its bounding-box corner, so
      // rotating onto a side/top edge and mirroring for direction both
      // read as the creature turning in place rather than sliding.
      ctx.imageSmoothingEnabled = false;
      ctx.save();
      ctx.translate(pose.x, pose.y);
      ctx.rotate(pose.angle);
      ctx.translate(0, -pose.bob);
      if (pose.mirror) ctx.scale(-1, 1);
      // Camouflage fade (all the way to invisible) and the touch/hold
      // opacity dip (down to ~30%) are independent effects, so combine
      // them multiplicatively rather than one overriding the other.
      ctx.globalAlpha = (1 - pose.fadeT) * pose.touchAlpha;
      ctx.drawImage(this.buffer, -anchorX, -anchorY, sw, sh);
      ctx.restore();

      // Hit-area: a generous axis-aligned square centered on the anchor —
      // exact rotated bounds aren't worth tracking for an invisible
      // pointer target, this just needs to comfortably cover the sprite
      // at any of the four edge orientations.
      const hitSize = Math.max(sw, sh);
      this.hitEl.style.width = hitSize + 'px';
      this.hitEl.style.height = hitSize + 'px';
      this.hitEl.style.left = pose.x - hitSize / 2 + 'px';
      this.hitEl.style.top = pose.y - hitSize / 2 + 'px';
    }

    _loop(now) {
      const dt = Math.min((now - this._lastTime) / 1000, 0.05);
      this._lastTime = now;
      this.behavior.update(dt);
      this.draw();
      this._raf = requestAnimationFrame(this._loop);
    }

    // ---------- public API ----------

    setPalette(paletteOverride) {
      this.paletteOverride = paletteOverride
        ? Object.assign({}, this.config.palette, paletteOverride)
        : null;
    }

    // Convenience wrapper around setPalette() for picking a named theme
    // from chameleon-themes.js instead of passing a raw palette object.
    setTheme(name) {
      const theme = global.ChameleonThemes && global.ChameleonThemes[name];
      this.setPalette(theme || null);
    }

    // Same idea as setTheme(), but for the site-responsive mood variants
    // from chameleon-themes.js's deriveVariant() ('high', 'low',
    // 'transitionHigh', 'transitionLow', 'speckled', 'placeholder') instead
    // of a static named theme — each call re-derives from the site's
    // current colors, so it stays correct across a light/dark toggle.
    setVariant(name) {
      const variant = global.ChameleonThemes && global.ChameleonThemes.deriveVariant(name);
      this.setPalette(variant || null);
    }

    // Switches the tongue-flick preset ('original' | 'middle' | 'snappy')
    // at runtime; falls back to 'middle' for an unrecognized name.
    setTongueMode(name) {
      const modes = global.ChameleonStandardBehaviour.TONGUE_MODES;
      this.behavior.tongueMode = modes[name] || modes.middle;
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      this._observer && this._observer.disconnect();
      this.canvas.remove();
      this.hitEl.remove();
    }
  }

  global.ChameleonPet = {
    init(config) {
      if (global.__chameleonPetInstance) return global.__chameleonPetInstance;
      const instance = new ChameleonPet(config);
      global.__chameleonPetInstance = instance;
      return instance;
    },
  };
})(window);
