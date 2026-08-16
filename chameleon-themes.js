/**
 * ChameleonThemes — named color palettes for the chameleon pet, kept
 * separate from chameleon-pet.js so palette/mood tweaks don't require
 * touching animation or behavior code.
 *
 * Every palette (the hand-picked ones below, deriveFromSite()'s output, and
 * deriveVariant()'s output) uses the same shape so callers can swap between
 * them freely mid-animation (e.g. setPalette merges partial overrides onto
 * the current one):
 *   { body, bodyLight, bodyDark, outline, crest, eye, eyeRing, tongue }
 * All eight values are '#rrggbb' hex strings — never 'rgb(...)' or named
 * CSS colors — since sprite.js's canvas calls and any future
 * palette-to-palette interpolation assume that format uniformly.
 *
 * The 'transitionHigh'/'transitionLow'/'speckled' variants from
 * deriveVariant() add two optional keys on top of that base shape:
 *   patchColor: '#rrggbb' hex, patchStyle: 'blotches' | 'speckle'
 * sprite.js only reads these when patchColor is present, so every other
 * palette (including all the static THEMES below) can simply omit them.
 *
 * Load this file before chameleon-pet.js.
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

  // ---------- responsive palette: derived from the host site's own colors ----------

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function parseColorToRgb(color) {
    if (!color) return null;
    const c = color.trim();
    const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
    if (hexMatch) {
      let h = hexMatch[1];
      if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
      return {
        r: parseInt(h.substring(0, 2), 16),
        g: parseInt(h.substring(2, 4), 16),
        b: parseInt(h.substring(4, 6), 16),
      };
    }
    const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
    if (rgbMatch) {
      return { r: +rgbMatch[1], g: +rgbMatch[2], b: +rgbMatch[3] };
    }
    return null;
  }

  function rgbToHsl({ r, g, b }) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: l * 100 };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      default: h = (rn - gn) / d + 4; break;
    }
    return { h: h * 60, s: s * 100, l: l * 100 };
  }

  function hslToHex(h, s, l) {
    const hn = ((h % 360) + 360) % 360;
    const sn = clamp(s, 0, 100) / 100;
    const ln = clamp(l, 0, 100) / 100;
    const c = (1 - Math.abs(2 * ln - 1)) * sn;
    const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
    const m = ln - c / 2;
    let r, g, b;
    if (hn < 60) [r, g, b] = [c, x, 0];
    else if (hn < 120) [r, g, b] = [x, c, 0];
    else if (hn < 180) [r, g, b] = [0, c, x];
    else if (hn < 240) [r, g, b] = [0, x, c];
    else if (hn < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function relativeLuminance({ r, g, b }) {
    const lin = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  // Reads the page's own background/foreground/accent colors (CSS custom
  // properties first, computed body styles as fallback). Called fresh each
  // time so every variant below always reflects whichever of the site's
  // light/dark modes is currently active.
  function _sampleSite() {
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);

    const cssVar = (names) => {
      for (const n of names) {
        const v = rootStyle.getPropertyValue(n).trim();
        if (v) return v;
      }
      return null;
    };

    const bgRgb =
      parseColorToRgb(cssVar(['--bg', '--background', '--color-bg'])) ||
      parseColorToRgb(bodyStyle.backgroundColor) || { r: 255, g: 255, b: 255 };
    const fgRgb =
      parseColorToRgb(cssVar(['--fg', '--foreground', '--text', '--color-text'])) ||
      parseColorToRgb(bodyStyle.color) || { r: 17, g: 17, b: 17 };
    const accentRgb =
      parseColorToRgb(cssVar(['--accent', '--primary', '--brand', '--color-accent'])) || fgRgb;

    const isDark = relativeLuminance(bgRgb) < 0.5;
    const accentHsl = rgbToHsl(accentRgb);
    return { isDark, hue: accentHsl.h, sat: clamp(accentHsl.s, 35, 55) };
  }

  // Builds one full 8-key palette (see the format contract in the file
  // header) at a given hue/saturation/body-lightness. Every variant below
  // — default and all six mood variants — goes through this one function,
  // so they all stay in the same hex format; only the (hue, sat, bodyL)
  // inputs differ per variant.
  //
  // Real chameleons aren't monochrome, so only the body/outline stay tied
  // to the site's own hue (that's what makes the pet read as "belonging"
  // to the page); the crest, eye ring, and tongue each borrow a different
  // hue around the color wheel — triadic, complementary, and a warm split
  // accent respectively — for a playful multicolor pop instead of three
  // shades of the same color. Skipped (falls back to the body's own hue,
  // desaturated) when sat is ~0, which is deriveVariant('placeholder')'s
  // signal that it wants a plain hue-less gray stand-in, not a rainbow.
  function buildTonalPalette(hue, sat, bodyL, isDark) {
    const body = hslToHex(hue, sat, bodyL);
    const bodyDark = hslToHex(hue, sat, Math.max(bodyL - 16, 4));
    const bodyLight = hslToHex(hue, Math.min(sat + 10, 65), Math.min(bodyL + 20, 74));
    const outline = hslToHex(hue, Math.min(sat, 30), isDark ? 4 : 8);

    const playful = sat > 2;
    const crestHue = hue + 130; // triadic
    const eyeRingHue = hue + 190; // near-complementary
    // Real chameleon tongues read as pink/red regardless of the body's own
    // hue, so unlike crest/eyeRing (which ride the body's hue wheel), the
    // tongue is pinned to a pink-red band (~330-20 deg, wrapping through 0)
    // — still varies a little with the site hue for some palette-to-palette
    // difference, but never wanders into orange/yellow/green/blue.
    const tongueHue = (355 + ((hue % 50) - 25) + 360) % 360;
    const accentSat = playful ? clamp(sat + 25, 55, 85) : sat;
    const ringSat = playful ? clamp(sat + 20, 55, 80) : sat;
    const tongueSat = playful ? clamp(sat + 30, 65, 90) : sat;

    const crest = hslToHex(crestHue, accentSat, isDark ? 55 : 42);
    // Pulled well above the body's lightness regardless of hue — matching
    // the body's own lightness here would merge the ring into the head
    // whenever the accent's natural lightness sits close to bodyL.
    const eyeRing = hslToHex(eyeRingHue, ringSat, isDark ? 70 : 68);
    const tongue = hslToHex(tongueHue, tongueSat, isDark ? 58 : 48);

    return {
      body,
      bodyLight,
      bodyDark,
      outline,
      crest,
      eye: '#0a0a0a',
      eyeRing,
      tongue,
    };
  }

  // Body-lightness/saturation targets for the "default" mood and the two
  // contrast moods, expressed as how far bodyL sits from the background's
  // own lightness extreme (near-0 for a dark bg, near-100 for a light bg).
  // Ordering the gap low -> default -> high is what keeps "low contrast"
  // reliably subtler and "high contrast" reliably punchier than the
  // default in both light and dark mode, rather than just in one.
  function _defaultTone(isDark, sat) {
    return { sat, bodyL: isDark ? 42 : 30 };
  }
  function _highTone(isDark, sat) {
    return { sat: clamp(sat + 20, 55, 75), bodyL: isDark ? 60 : 16 };
  }
  function _lowTone(isDark, sat) {
    return { sat: clamp(sat - 15, 15, 30), bodyL: isDark ? 30 : 40 };
  }

  // Reads the page's own colors and builds the default site-responsive
  // palette — see _sampleSite()/buildTonalPalette() above.
  function deriveFromSite() {
    const { isDark, hue, sat } = _sampleSite();
    const tone = _defaultTone(isDark, sat);
    return buildTonalPalette(hue, tone.sat, tone.bodyL, isDark);
  }

  // The six mood variants on top of the responsive default, all still
  // derived from the site's own hue so they read as belonging to the same
  // page: 'high' and 'low' contrast, 'transitionHigh'/'transitionLow' (the
  // default body patched with irregular blotches of the high/low color, as
  // if mid-shift toward that mood), 'speckled' (the default body dusted
  // with fine eyeRing-colored dots), and 'placeholder' (a hue-less gray
  // built the same way, meant as a plain stand-in to hand-tune later).
  // patchColor/patchStyle are the two variant-only keys on top of the
  // standard 8 — sprite.js treats them as optional and no-ops without them.
  function deriveVariant(name) {
    const { isDark, hue, sat } = _sampleSite();
    const defaultPalette = deriveFromSite();

    switch (name) {
      case 'high': {
        const t = _highTone(isDark, sat);
        return buildTonalPalette(hue, t.sat, t.bodyL, isDark);
      }
      case 'low': {
        const t = _lowTone(isDark, sat);
        return buildTonalPalette(hue, t.sat, t.bodyL, isDark);
      }
      case 'transitionHigh': {
        const t = _highTone(isDark, sat);
        const high = buildTonalPalette(hue, t.sat, t.bodyL, isDark);
        return Object.assign({}, defaultPalette, { patchColor: high.body, patchStyle: 'blotches' });
      }
      case 'transitionLow': {
        const t = _lowTone(isDark, sat);
        const low = buildTonalPalette(hue, t.sat, t.bodyL, isDark);
        return Object.assign({}, defaultPalette, { patchColor: low.body, patchStyle: 'blotches' });
      }
      case 'speckled':
        return Object.assign({}, defaultPalette, {
          patchColor: defaultPalette.eyeRing,
          patchStyle: 'speckle',
        });
      case 'placeholder': {
        const t = _defaultTone(isDark, 0);
        return buildTonalPalette(0, 0, t.bodyL, isDark);
      }
      default:
        return defaultPalette;
    }
  }

  // ---------- click/drag/drop contrast reactions ----------

  // Shifts one hex color's lightness/saturation while keeping its hue, so
  // the high contrast mood below still reads as "this palette, but
  // alarmed" rather than jumping to an unrelated color.
  function _shiftTone(hex, deltaL, deltaS) {
    const rgb = parseColorToRgb(hex);
    if (!rgb) return hex;
    const hsl = rgbToHsl(rgb);
    return hslToHex(hsl.h, clamp(hsl.s + deltaS, 0, 100), clamp(hsl.l + deltaL, 0, 100));
  }

  // Builds the "high contrast" (punchy, alarmed — used while falling from
  // a high drop) endpoint for a given base palette. Called by
  // chameleon-behavior.js, which tweens between the base and this via
  // lerpPalette() below rather than swapping straight to it.
  function contrastPalette(base) {
    const dL = 20;
    const dS = 22;
    return {
      body: _shiftTone(base.body, dL, dS),
      bodyLight: _shiftTone(base.bodyLight, dL, dS),
      bodyDark: _shiftTone(base.bodyDark, dL * 0.6, dS),
      outline: base.outline,
      crest: _shiftTone(base.crest, dL, dS),
      eye: base.eye,
      eyeRing: _shiftTone(base.eyeRing, 18, 25),
      tongue: base.tongue,
      patchColor: base.patchColor,
      patchStyle: base.patchStyle,
    };
  }

  function lerpHex(a, b, t) {
    const ca = parseColorToRgb(a);
    const cb = parseColorToRgb(b);
    if (!ca || !cb) return t < 0.5 ? a : b;
    const toHex = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
    return `#${toHex(ca.r + (cb.r - ca.r) * t)}${toHex(ca.g + (cb.g - ca.g) * t)}${toHex(ca.b + (cb.b - ca.b) * t)}`;
  }

  // Blends two full palettes color-by-color (t=0 -> a, t=1 -> b); any
  // patchColor/patchStyle is carried over from `a` unchanged since it isn't
  // part of the contrast mood being blended here.
  function lerpPalette(a, b, t) {
    const out = { patchColor: a.patchColor, patchStyle: a.patchStyle };
    for (const key of ['body', 'bodyLight', 'bodyDark', 'outline', 'crest', 'eye', 'eyeRing', 'tongue']) {
      out[key] = lerpHex(a[key], b[key], t);
    }
    return out;
  }

  global.ChameleonThemes = THEMES;
  global.ChameleonThemes.deriveFromSite = deriveFromSite;
  global.ChameleonThemes.deriveVariant = deriveVariant;
  global.ChameleonThemes.VARIANTS = ['high', 'low', 'transitionHigh', 'transitionLow', 'speckled', 'placeholder'];
  global.ChameleonThemes.contrastPalette = contrastPalette;
  global.ChameleonThemes.lerpPalette = lerpPalette;
})(window);
