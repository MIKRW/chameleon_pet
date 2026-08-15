/**
 * ChameleonThemes — named color palettes for the chameleon pet, kept
 * separate from chameleon-pet.js so palette/mood tweaks don't require
 * touching animation or behavior code.
 *
 * Each palette needs: body, bodyLight, bodyDark, outline, eye, eyeRing,
 * tongue, crest. Load this file before chameleon-pet.js.
 */
(function (global) {
  'use strict';

  const THEMES = {
    // Default: deep jewel-toned emerald, low-contrast, reads as sleek/stealthy
    // rather than a bright cartoon green.
    shadow: {
      body: '#1f4a3d',
      bodyLight: '#3d8a6b',
      bodyDark: '#0e2620',
      outline: '#081713',
      crest: '#0e2620',
      eye: '#0a0a0a',
      eyeRing: '#c9a24b',
      tongue: '#b23a63',
    },

    // Paired with a light-mode site theme: slightly brighter so it still
    // reads clearly against a pale background.
    moss: {
      body: '#2f6b52',
      bodyLight: '#5aa483',
      bodyDark: '#173a2c',
      outline: '#0d241b',
      crest: '#173a2c',
      eye: '#0a0a0a',
      eyeRing: '#d8b45a',
      tongue: '#c14a72',
    },

    // Paired with a dark-mode site theme: desaturated, low-key, almost
    // blends with a near-black background until it moves.
    midnight: {
      body: '#26333a',
      bodyLight: '#4a6b73',
      bodyDark: '#131a1e',
      outline: '#070a0c',
      crest: '#131a1e',
      eye: '#0a0a0a',
      eyeRing: '#8fd6c9',
      tongue: '#9c4f8a',
    },

    // A rarer accent palette — reserved for reactions on the resume/email
    // buttons if you want a distinct "highlighted" mood later.
    ember: {
      body: '#5a2f1f',
      bodyLight: '#a85a35',
      bodyDark: '#2c1610',
      outline: '#160b08',
      crest: '#2c1610',
      eye: '#0a0a0a',
      eyeRing: '#e8c25a',
      tongue: '#d4553f',
    },
  };

  global.ChameleonThemes = THEMES;
})(window);
