/**
 * ChameleonActions — reaction recipes for each watched site element.
 * Keyed by the same target keys used in chameleon-pet.js's `targets`
 * config ("theme", "resume", "email", ...). Each recipe may define:
 *
 *   onArrive(api) — called once when the pet finishes walking to that
 *                   target and settles on it.
 *   onClick(api)  — called immediately when the real button is clicked on
 *                   the page, even if the pet is elsewhere.
 *
 * `api` is a small facade (see chameleon-behavior.js's _actionApi) with
 * just enough surface for a reaction: flickTongue() and startFade(). This
 * file only decides *what* happens for a given target — *when* it runs
 * (state machine, timing) lives in chameleon-behavior.js, and *how it's
 * drawn* lives in chameleon-sprite.js.
 *
 * To add a new interactive element on the site: add its selector to the
 * `targets` config passed to ChameleonPet.init(), then add a matching
 * entry here for how the pet should react to it. No other file needs to
 * change.
 */
(function (global) {
  'use strict';

  const ACTIONS = {
    theme: {
      onArrive(api) {
        api.flickTongue();
        api.startFade(); // camouflage shift — thematically tied to a theme change
      },
    },
    resume: {
      onArrive(api) {
        api.flickTongue();
      },
    },
    email: {
      onArrive(api) {
        api.flickTongue();
      },
    },
  };

  global.ChameleonActions = ACTIONS;
})(window);
