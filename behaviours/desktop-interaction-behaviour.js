/**
 * ChameleonDesktopInteractionBehaviour — the pet's interactions with the
 * page itself: walking to and reacting at watched site elements (theme/
 * resume/email buttons, see ChameleonActions), and perching on whatever
 * element it's dropped onto instead of just returning to the window
 * perimeter. user-interaction-behaviour.js owns the raw pointer
 * down/move/up handling and the touch/alarm cosmetic reactions; this
 * module owns where a drop actually lands and what happens once the pet
 * is seeking/arrived/perched there.
 *
 * Every function here takes the owning ChameleonBehavior instance as its
 * first argument (`ctx`) — see the header comment in
 * standard-behaviour.js for why these modules share the instance's fields
 * rather than owning private state.
 */
(function (global) {
  'use strict';

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function initState(ctx) {
    ctx.currentTargetKey = null;
    ctx._seekS = 0;
    ctx._pendingReaction = null;

    ctx._returnTarget = null;
    ctx._returningToPerch = false;
    ctx._perchRef = null; // opaque DOM handle from world.elementAt, only ever passed back to world.rectForRef
    ctx._perch = null; // { edge, angle, fracX, fracY } — position on the perched element's box, in fractions of its size

    ctx._api = {
      flickTongue: () => global.ChameleonStandardBehaviour.flickTongue(ctx),
      startFade: () => global.ChameleonStandardBehaviour.startFade(ctx),
    };
  }

  // Treats an arbitrary element's box like a miniature viewport and finds
  // the nearest point on *its* perimeter to (ctx.x, ctx.y) — reusing the
  // same edge/angle convention the window-perimeter walk uses, so a perch
  // on an element's top/bottom/left/right reads exactly like standing on
  // the matching window edge. Stored as fractions of the box's own size
  // (not absolute px) so it can be re-derived every frame as the element
  // scrolls or resizes.
  function computePerchTarget(ctx, rect) {
    const local = global.ChameleonPath.nearestS(rect.width, rect.height, 0, ctx.x - rect.left, ctx.y - rect.top);
    return {
      edge: local.edge,
      angle: local.angle,
      fracX: rect.width ? local.x / rect.width : 0,
      fracY: rect.height ? local.y / rect.height : 0,
    };
  }

  function perchPointFor(rect, perch) {
    return {
      x: rect.left + perch.fracX * rect.width,
      y: rect.top + perch.fracY * rect.height,
    };
  }

  // Decides where a drop released at (ctx.x, ctx.y) right now would land:
  // perched on whatever's under it (if that element is large enough — see
  // world.elementAt) or back onto the nearest point of the window
  // perimeter otherwise. Called by user-interaction-behaviour.js's
  // onPointerUp, which uses landingSpan to judge whether the release
  // counts as "from height".
  function computeLanding(ctx) {
    const found = ctx.world.elementAt && ctx.world.elementAt(ctx.x, ctx.y);
    if (found) {
      const perch = computePerchTarget(ctx, found.rect);
      const p = perchPointFor(found.rect, perch);
      return {
        perchRef: found.ref,
        perch,
        returnTarget: { x: p.x, y: p.y, angle: perch.angle },
        returningToPerch: true,
        landingSpan: Math.max(found.rect.width, found.rect.height),
      };
    }
    return {
      perchRef: null,
      perch: null,
      returnTarget: ctx._nearestPoint(ctx.x, ctx.y),
      returningToPerch: false,
      landingSpan: Math.max(ctx.world.viewport().w, ctx.world.viewport().h),
    };
  }

  // A real click landed on a watched button, wherever the pet currently
  // is. Fires that target's onClick immediately, and queues it to be
  // walked to next chance the state machine gets (see maybeSeekTarget).
  function reactTo(ctx, key) {
    ctx._pendingReaction = key;
    const recipe = global.ChameleonActions && global.ChameleonActions[key];
    if (recipe && recipe.onClick) recipe.onClick(ctx._api);
  }

  // Walks toward a watched button: picks _pendingReaction if a real click
  // was observed, otherwise a random target key, so the pet reacts to
  // actual user activity when there is any instead of only patrolling
  // aimlessly. Returns false (leaving state untouched) if that target
  // isn't in the DOM yet or is hidden, which happens on pages still under
  // construction.
  function maybeSeekTarget(ctx) {
    const STATE = global.ChameleonBehavior.STATE;
    const keys = ctx.world.targetKeys();
    if (keys.length === 0) return false;
    const key = ctx._pendingReaction || keys[Math.floor(Math.random() * keys.length)];
    ctx._pendingReaction = null;
    const rect = ctx.world.targetRect(key);
    if (!rect) return false;
    const nearest = ctx._nearestPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    ctx.currentTargetKey = key;
    ctx._seekS = nearest.s;
    ctx.state = STATE.SEEK;
    return true;
  }

  function runArriveAction(ctx) {
    const key = ctx.currentTargetKey;
    const recipe = key && global.ChameleonActions && global.ChameleonActions[key];
    if (recipe && recipe.onArrive) recipe.onArrive(ctx._api);
  }

  function updateSeek(ctx, dt) {
    const STATE = global.ChameleonBehavior.STATE;
    const total = ctx._perimeterLength();
    const { dir, dist } = global.ChameleonPath.shortestDirection(ctx.s, ctx._seekS, total);
    if (dist < 4) {
      ctx.state = STATE.ON_TARGET;
      ctx.stateTimer = rand(1.5, 2.5);
      runArriveAction(ctx);
    } else {
      global.ChameleonStandardBehaviour.advanceAlongPath(ctx, dt, dir);
      global.ChameleonStandardBehaviour.maybeTongueFlick(ctx, dt);
    }
  }

  function updateOnTarget(ctx) {
    const STATE = global.ChameleonBehavior.STATE;
    ctx.bob = Math.sin(performance.now() / 350) * 1;
    if (ctx.stateTimer <= 0) {
      ctx.currentTargetKey = null;
      ctx.state = STATE.WANDER;
    }
  }

  // Dropped: if the pet's feet landed on a suitably large element (per
  // world.elementAt, via computeLanding above), ease onto the nearest
  // point on *that* element's edge and stick there; otherwise ease back
  // onto the window perimeter.
  function updateReturning(ctx, dt) {
    const STATE = global.ChameleonBehavior.STATE;
    const dx = ctx._returnTarget.x - ctx.x;
    const dy = ctx._returnTarget.y - ctx.y;
    const dist = Math.hypot(dx, dy);
    ctx._rawAngle = ctx._returnTarget.angle;
    if (dist < 3) {
      ctx.x = ctx._returnTarget.x;
      ctx.y = ctx._returnTarget.y;
      global.ChameleonUserInteractionBehaviour.settleAlarmOnLanding(ctx);
      if (ctx._returningToPerch) {
        ctx.state = STATE.PERCHED;
        ctx.bob = 0;
      } else {
        ctx.s = ctx._returnTarget.s;
        ctx.state = STATE.WANDER;
      }
    } else {
      const speed = 260;
      ctx.x += (dx / dist) * speed * dt;
      ctx.y += (dy / dist) * speed * dt;
      ctx.mirror = dx < 0;
    }
  }

  function updatePerched(ctx) {
    const STATE = global.ChameleonBehavior.STATE;
    if (ctx._perchRef) {
      const rect = ctx.world.rectForRef(ctx._perchRef);
      if (rect) {
        const p = perchPointFor(rect, ctx._perch);
        ctx.x = p.x;
        ctx.y = p.y;
        ctx._rawAngle = ctx._perch.angle;
      } else {
        // The element vanished from under it (e.g. a re-render) — release
        // back onto the window perimeter rather than being stuck tracking
        // a dead reference.
        ctx._perchRef = null;
        ctx._perch = null;
        ctx._returnTarget = ctx._nearestPoint(ctx.x, ctx.y);
        ctx._returningToPerch = false;
        ctx.state = STATE.RETURNING;
      }
    }
    ctx.bob = 0;
  }

  global.ChameleonDesktopInteractionBehaviour = {
    initState,
    reactTo,
    maybeSeekTarget,
    runArriveAction,
    computeLanding,
    updateSeek,
    updateOnTarget,
    updateReturning,
    updatePerched,
  };
})(window);
