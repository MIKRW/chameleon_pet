/**
 * ChameleonPet — thin bootstrap. Wires together the other modules and does
 * nothing else:
 *
 *   chameleon-themes.js    - color palettes (data)
 *   chameleon-sprite.js    - pure drawing (pose + palette -> pixels)
 *   chameleon-actions.js   - reaction recipes per target key
 *   chameleon-behavior.js  - state machine (DOM-agnostic)
 *   chameleon-pet.js (you are here) - sensing + glue:
 *     - finds/watches site elements (theme/resume/email buttons, or
 *       whatever `targets` selectors are configured)
 *     - tracks window size and page background
 *     - forwards raw pointer/click events into the behavior state machine
 *     - runs the animation loop, asking behavior for a pose each frame
 *       and handing it to the sprite module to draw
 *     - exposes the public API (init/setPalette/setTheme/destroy)
 *
 * Load order matters: themes, sprite, actions, behavior, then this file.
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
    scale: 6, // internal-pixel -> screen-pixel multiplier
    groundOffset: 24, // px from bottom of viewport the pet's feet rest on
    wanderSpeed: 55, // px/sec
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
      this.resize(); // establishes viewW/viewH/groundY before behavior reads them

      const world = {
        viewport: () => ({ w: this.viewW, h: this.viewH }),
        groundY: () => this.groundY,
        targetRect: (key) => this._targetRect(key),
        targetKeys: () => Object.keys(this.config.targets),
      };
      this.behavior = new global.ChameleonBehavior(world, { wanderSpeed: this.config.wanderSpeed });

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
      this.groundY = cssH - this.config.groundOffset;
      if (this.behavior) this.behavior.y = Math.min(this.behavior.y, this.groundY);
    }

    _bgSampleColor() {
      // Approximate "blend into background" using the page/body background.
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      return bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' ? bodyBg : '#ffffff';
    }

    // ---------- render loop ----------

    _currentPalette() {
      return this.paletteOverride || this.config.palette;
    }

    draw() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.viewW, this.viewH);

      const pose = this.behavior.getPose();
      global.ChameleonSprite.draw(this.bctx, pose, this._currentPalette(), this._bgSampleColor());

      const sw = global.ChameleonSprite.WIDTH * this.config.scale;
      const sh = global.ChameleonSprite.HEIGHT * this.config.scale;
      const dx = pose.x - sw / 2;
      const dy = pose.y - sh + pose.bob;

      ctx.imageSmoothingEnabled = false;
      ctx.save();
      ctx.globalAlpha = 1 - pose.fadeT * 0.85; // never fully invisible/unusable
      if (pose.facing === -1) {
        ctx.translate(dx + sw, dy);
        ctx.scale(-1, 1);
        ctx.drawImage(this.buffer, 0, 0, sw, sh);
      } else {
        ctx.drawImage(this.buffer, dx, dy, sw, sh);
      }
      ctx.restore();

      // Keep hit-area synced to the sprite's on-screen box.
      this.hitEl.style.width = sw + 'px';
      this.hitEl.style.height = sh + 'px';
      this.hitEl.style.left = dx + 'px';
      this.hitEl.style.top = dy + 'px';
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
