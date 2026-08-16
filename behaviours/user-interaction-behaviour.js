/**
 * ChameleonUserInteractionBehaviour — reactions to the user directly
 * touching the pet: pressing/holding/dragging it (which dims it to
 * TOUCH_HIDE_ALPHA opacity, as if it's trying to hide from the touch) and
 * dropping it (which, if the drop happens far enough above where it's
 * about to land, flashes the sprite to a high-contrast "alarmed" palette
 * for the remainder of the fall, settling back to default the instant it
 * lands). This is also where every palette/theme-mood tween lives — see
 * updateContrast/getPalette below — so it stays in one place rather than
 * spread across files.
 *
 * Where a drop actually lands — the window perimeter or perched on a site
 * element — is desktop-interaction-behaviour.js's concern; this module
 * only asks it for the landing spot and judges whether that release
 * counts as "from height".
 *
 * Every function here takes the owning ChameleonBehavior instance as its
 * first argument (`ctx`) — see the header comment in
 * standard-behaviour.js for why these modules share the instance's fields
 * rather than owning private state.
 */
(function (global) {
  'use strict';

  // touchAlpha eases toward TOUCH_HIDE_ALPHA while pressed/held/dragged
  // and back to 1 once released. contrastT eases toward 1 (high/alarm
  // color) only while actually falling through the air after a high
  // drop, then back to 0 (default color) the instant it lands.
  // CONTRAST_DROP_RATIO is how far (as a fraction of the landing
  // surface's own size) a drop point has to be from where it lands for
  // the release to read as "from height" rather than a normal, gentle
  // drop.
  const TOUCH_HIDE_ALPHA = 0.3;
  const TOUCH_HIDE_DUR = 0.18;
  const CONTRAST_ALARM_DUR = 0.12;
  const RELEASE_EASE_DUR = 1.0;
  const CONTRAST_DROP_RATIO = 0.55;

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function initState(ctx) {
    ctx._dragAnchor = { x: 0, y: 0 }; // offset from pointer to sprite anchor while dragging

    ctx.contrastT = 0; // 0 = default color, 1 = full high/alarm color
    ctx._contrastFrom = 0;
    ctx._contrastTo = 0;
    ctx._contrastDur = 0;
    ctx._contrastElapsed = 0;
    ctx._alarmDrop = false; // true while airborne after a drop that qualifies as "from height"

    ctx.touchAlpha = 1; // 1 = normal opacity, TOUCH_HIDE_ALPHA = hiding from touch
    ctx._touchAlphaFrom = 1;
    ctx._touchAlphaTo = 1;
    ctx._touchAlphaDur = 0;
    ctx._touchAlphaElapsed = 0;
  }

  // Starts easing contrastT toward `target` (0 default, 1 high/alarm) over
  // `duration` seconds; a short duration reads as a near-instant snap
  // (used for the drop-to-alarm reaction) while a longer one reads as the
  // "transition back to default" once landed.
  function setContrastTarget(ctx, target, duration) {
    ctx._contrastFrom = ctx.contrastT;
    ctx._contrastTo = target;
    ctx._contrastDur = Math.max(duration, 0.001);
    ctx._contrastElapsed = 0;
  }

  // Same idea as setContrastTarget above, but for touchAlpha (1 = normal
  // opacity, TOUCH_HIDE_ALPHA = hiding from touch while pressed/dragged).
  function setTouchAlphaTarget(ctx, target, duration) {
    ctx._touchAlphaFrom = ctx.touchAlpha;
    ctx._touchAlphaTo = target;
    ctx._touchAlphaDur = Math.max(duration, 0.001);
    ctx._touchAlphaElapsed = 0;
  }

  // The hit-area itself was clicked (the pet, not one of the watched
  // buttons) — a generic startle, not tied to any particular target.
  function onClickedSelf(ctx) {
    ctx.fadeT = 0.6;
    ctx.fadeDir = -1;
    global.ChameleonStandardBehaviour.flickTongue(ctx, 'snappy');
  }

  function onPointerDown(ctx, clientX, clientY) {
    const STATE = global.ChameleonBehavior.STATE;
    if (ctx.state === STATE.RETURNING) return;
    ctx._perchRef = null;
    ctx._perch = null;
    ctx.state = STATE.DRAGGING;
    ctx._dragAnchor.x = clientX - ctx.x;
    ctx._dragAnchor.y = clientY - ctx.y;
    ctx._alarmDrop = false; // picking it back up cancels any in-flight alarm
    setTouchAlphaTarget(ctx, TOUCH_HIDE_ALPHA, TOUCH_HIDE_DUR);
  }

  function onPointerMove(ctx, clientX, clientY) {
    const STATE = global.ChameleonBehavior.STATE;
    if (ctx.state !== STATE.DRAGGING) return;
    const vp = ctx.world.viewport();
    const nx = clientX - ctx._dragAnchor.x;
    const ny = clientY - ctx._dragAnchor.y;
    ctx.mirror = nx < ctx.x ? true : nx > ctx.x ? false : ctx.mirror;
    ctx.x = clamp(nx, 10, vp.w - 10);
    ctx.y = clamp(ny, 10, vp.h - 10);
    ctx._rawAngle = 0; // held freely — not pressed against any edge while dragging
  }

  // Dropped: asks desktop-interaction-behaviour.js where this lands (a
  // perch or the window perimeter) and starts the RETURNING tween toward
  // it, then judges whether the release point was far enough above the
  // landing spot — relative to that spot's own size — to read as "from
  // height", flashing alarmed (high contrast) for the fall if so. Either
  // way touch opacity eases back to normal since it's no longer being
  // held.
  function onPointerUp(ctx) {
    const STATE = global.ChameleonBehavior.STATE;
    if (ctx.state !== STATE.DRAGGING) return;
    const desktop = global.ChameleonDesktopInteractionBehaviour;
    const landing = desktop.computeLanding(ctx);
    ctx._perchRef = landing.perchRef;
    ctx._perch = landing.perch;
    ctx._returnTarget = landing.returnTarget;
    ctx._returningToPerch = landing.returningToPerch;
    ctx.state = STATE.RETURNING;

    const dropDist = Math.hypot(ctx._returnTarget.x - ctx.x, ctx._returnTarget.y - ctx.y);
    ctx._alarmDrop = landing.landingSpan > 0 && dropDist / landing.landingSpan >= CONTRAST_DROP_RATIO;
    if (ctx._alarmDrop) setContrastTarget(ctx, 1, CONTRAST_ALARM_DUR);
    setTouchAlphaTarget(ctx, 1, RELEASE_EASE_DUR);
  }

  // Called by desktop-interaction-behaviour.js once a RETURNING tween
  // reaches its landing point: the fall is over, so high contrast only
  // applies while airborne — ease straight back to default rather than
  // lingering alarmed. A no-op if this landing wasn't an alarm drop.
  function settleAlarmOnLanding(ctx) {
    if (!ctx._alarmDrop) return;
    ctx._alarmDrop = false;
    setContrastTarget(ctx, 0, RELEASE_EASE_DUR);
  }

  function updateContrast(ctx, dt) {
    if (ctx._contrastElapsed < ctx._contrastDur) {
      ctx._contrastElapsed += dt;
      const t = clamp(ctx._contrastElapsed / ctx._contrastDur, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      ctx.contrastT = ctx._contrastFrom + (ctx._contrastTo - ctx._contrastFrom) * eased;
    } else {
      ctx.contrastT = ctx._contrastTo;
    }
  }

  function updateTouchAlpha(ctx, dt) {
    if (ctx._touchAlphaElapsed < ctx._touchAlphaDur) {
      ctx._touchAlphaElapsed += dt;
      const t = clamp(ctx._touchAlphaElapsed / ctx._touchAlphaDur, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      ctx.touchAlpha = ctx._touchAlphaFrom + (ctx._touchAlphaTo - ctx._touchAlphaFrom) * eased;
    } else {
      ctx.touchAlpha = ctx._touchAlphaTo;
    }
  }

  // Blends the given base palette toward the high/alarm contrast mood
  // (see contrastT above); returns the base unchanged once the tween has
  // settled back at 0, which is the common (not currently falling) case.
  function getPalette(ctx, basePalette) {
    if (!basePalette || ctx.contrastT < 0.001 || !global.ChameleonThemes) return basePalette;
    const variant = global.ChameleonThemes.contrastPalette(basePalette);
    return global.ChameleonThemes.lerpPalette(basePalette, variant, ctx.contrastT);
  }

  global.ChameleonUserInteractionBehaviour = {
    TOUCH_HIDE_ALPHA,
    TOUCH_HIDE_DUR,
    CONTRAST_ALARM_DUR,
    RELEASE_EASE_DUR,
    CONTRAST_DROP_RATIO,
    initState,
    onClickedSelf,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    settleAlarmOnLanding,
    updateContrast,
    updateTouchAlpha,
    getPalette,
  };
})(window);
