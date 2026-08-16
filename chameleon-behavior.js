/**
 * ChameleonBehavior — the state machine coordinator. Owns the STATE enum
 * and the shared pose fields (x, y, angle, mirror, bob, s, state, ...),
 * dispatches each frame's update() to whichever behaviour module owns the
 * current state, and exposes the small surface chameleon-pet.js needs
 * (getPose/getPalette/the onPointer handlers/reactTo/onClickedSelf).
 *
 * The actual behaviour logic lives in three sibling modules under
 * behaviours/, split by *why* the pet is doing something:
 *
 *   behaviours/standard-behaviour.js            - ambient patrol + idle cosmetic tweens (nobody triggered this)
 *   behaviours/user-interaction-behaviour.js     - reactions to the user touching/dragging/dropping the pet itself (incl. all palette/theme-mood tweens)
 *   behaviours/desktop-interaction-behaviour.js  - reactions to site elements: seeking/arriving/perching
 *
 * Every function in those modules takes this instance as its first
 * argument and reads/writes its fields directly — see the header comment
 * in standard-behaviour.js for why the pose fields are shared rather than
 * privately owned per module.
 *
 * Movement follows ChameleonPath's perimeter loop (see that file for the
 * geometry) rather than a fixed ground line, so the pet walks the full
 * border of the window — bottom, up one side, across the top, down the
 * other side — always oriented feet-first into whichever edge it's on.
 *
 * Knows nothing about the DOM beyond a small `world` interface injected
 * at construction — it never queries elements or draws pixels itself.
 *
 *   world.viewport()      -> { w, h }
 *   world.edgeMargin()     -> number (inset of the walkable loop from the true window edge)
 *   world.targetRect(key) -> DOMRect | null   (null if not present/visible)
 *   world.targetKeys()    -> string[]
 *   world.elementAt(x, y) -> { rect, ref } | null   (perch candidate under a drop point; ref is opaque)
 *   world.rectForRef(ref) -> DOMRect | null   (re-queries a perch's rect each frame; null if removed)
 *
 * Load order: chameleon-path.js, chameleon-actions.js, behaviours/*.js,
 * then this file, then chameleon-pet.js.
 */
(function (global) {
  'use strict';

  const STATE = {
    LAP: 'lap', // one full establishing loop of the perimeter on startup
    WANDER: 'wander', // steady-state patrol, reversing direction periodically
    SEEK: 'seek',
    ON_TARGET: 'on_target',
    DRAGGING: 'dragging',
    RETURNING: 'returning', // easing back onto the track (or a perch point) after being dropped
    PERCHED: 'perched', // stuck to an element's edge, motionless, until picked up again
  };

  class ChameleonBehavior {
    constructor(world, config) {
      this.world = world;
      this.config = config; // { wanderSpeed, tongueMode }
      this.reducedMotion =
        global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

      this.s = 0; // distance along the perimeter loop
      this.mirror = false; // sprite horizontal flip
      this.bob = 0;

      // Each behaviour module owns initializing its own slice of the
      // shared fields — see the header comment above for why they're
      // still all flat on this instance rather than privately scoped.
      global.ChameleonStandardBehaviour.initState(this);
      global.ChameleonUserInteractionBehaviour.initState(this);
      global.ChameleonDesktopInteractionBehaviour.initState(this);

      const start = this._pointAt(0);
      this.x = start.x;
      this.y = start.y;
      this.angle = start.angle;
      this._rawAngle = start.angle;

      this.state = this.reducedMotion ? STATE.WANDER : STATE.LAP;
      this.stateTimer = 0;
    }

    // ---------- path helpers (thin wrappers so call sites stay short; shared by all three behaviour modules) ----------

    _pointAt(s) {
      const vp = this.world.viewport();
      return global.ChameleonPath.pointAt(vp.w, vp.h, this.world.edgeMargin(), s);
    }

    _perimeterLength() {
      const vp = this.world.viewport();
      return global.ChameleonPath.perimeterLength(vp.w, vp.h, this.world.edgeMargin());
    }

    _nearestPoint(x, y) {
      const vp = this.world.viewport();
      return global.ChameleonPath.nearestS(vp.w, vp.h, this.world.edgeMargin(), x, y);
    }

    // ---------- reactions from the outside world ----------

    reactTo(key) {
      global.ChameleonDesktopInteractionBehaviour.reactTo(this, key);
    }

    onClickedSelf() {
      global.ChameleonUserInteractionBehaviour.onClickedSelf(this);
    }

    // ---------- pointer / drag ----------

    onPointerDown(clientX, clientY) {
      global.ChameleonUserInteractionBehaviour.onPointerDown(this, clientX, clientY);
    }

    onPointerMove(clientX, clientY) {
      global.ChameleonUserInteractionBehaviour.onPointerMove(this, clientX, clientY);
    }

    onPointerUp() {
      global.ChameleonUserInteractionBehaviour.onPointerUp(this);
    }

    // ---------- main update ----------

    // Advances the state machine by dt seconds. Each STATE case delegates
    // to whichever behaviour module owns it; the tongue/fade/contrast/
    // touch-alpha tweens and angle easing below run every frame
    // regardless of state.
    update(dt) {
      const standard = global.ChameleonStandardBehaviour;
      const user = global.ChameleonUserInteractionBehaviour;
      const desktop = global.ChameleonDesktopInteractionBehaviour;

      if (this.reducedMotion && this.state === STATE.LAP) this.state = STATE.WANDER;

      this.stateTimer -= dt;

      switch (this.state) {
        case STATE.LAP: {
          if (this.reducedMotion) break;
          standard.advanceAlongPath(this, dt, 1); // establishing lap always runs clockwise
          standard.maybeTongueFlick(this, dt);
          this._lapDistance += this.config.wanderSpeed * dt;
          if (this._lapDistance >= this._perimeterLength()) {
            this.state = STATE.WANDER;
            this.direction = 1;
            this._directionTimer = standard.pickDirectionInterval(this);
          }
          if (this._pendingReaction) desktop.maybeSeekTarget(this);
          break;
        }

        case STATE.WANDER: {
          if (this.reducedMotion) break;
          this._directionTimer -= dt;
          if (this._directionTimer <= 0) {
            this.direction *= -1;
            this._directionTimer = standard.pickDirectionInterval(this);
          }
          standard.advanceAlongPath(this, dt, this.direction);
          standard.maybeTongueFlick(this, dt);
          standard.maybeFade(this, dt);
          if (this._pendingReaction) desktop.maybeSeekTarget(this);
          break;
        }

        case STATE.SEEK:
          desktop.updateSeek(this, dt);
          break;

        case STATE.ON_TARGET:
          desktop.updateOnTarget(this);
          break;

        case STATE.DRAGGING:
          this.bob = 0;
          break;

        case STATE.RETURNING:
          desktop.updateReturning(this, dt);
          break;

        case STATE.PERCHED:
          desktop.updatePerched(this);
          break;
      }

      standard.updateTongue(this, dt);
      user.updateContrast(this, dt);
      user.updateTouchAlpha(this, dt);
      standard.updateFade(this, dt);
      standard.updateAngleEase(this, dt);
    }

    getPalette(basePalette) {
      return global.ChameleonUserInteractionBehaviour.getPalette(this, basePalette);
    }

    // Snapshot consumed by the bootstrap's draw loop: sprite pose plus
    // on-screen placement.
    getPose() {
      return {
        x: this.x,
        y: this.y,
        angle: this.angle,
        mirror: this.mirror,
        bob: this.bob,
        walkFrame: this.walkFrame,
        isWalking:
          this.state === STATE.LAP || this.state === STATE.WANDER || this.state === STATE.SEEK,
        perched: this.state === STATE.PERCHED,
        tongueActive: this.tongueActive,
        tongueT: this.tongueT,
        tongueLen: this._activeTongueMode.len,
        tongueEase: this._activeTongueMode.ease,
        tongueSnapT: this._activeTongueMode.snapT,
        fadeT: this.fadeT,
        touchAlpha: this.touchAlpha,
      };
    }
  }

  ChameleonBehavior.STATE = STATE;
  global.ChameleonBehavior = ChameleonBehavior;
})(window);
