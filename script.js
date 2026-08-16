(function () {
  const root = document.documentElement;
  const themeToggle = document.getElementById('theme-toggle');

  function applyTheme(theme) {
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
    // Read back the site's own --bg/--fg/--accent (now that the attribute
    // change above has taken effect) and derive the pet's palette from
    // them, instead of a fixed named mood — see deriveFromSite() in
    // chameleon-themes.js.
    if (window.__chameleonPetInstance && window.ChameleonThemes) {
      window.__chameleonPetInstance.setPalette(window.ChameleonThemes.deriveFromSite());
    }
  }

  themeToggle.addEventListener('click', () => {
    const isDark = root.getAttribute('data-theme') === 'dark';
    applyTheme(isDark ? 'light' : 'dark');
  });

  const pet = ChameleonPet.init();

  // In case the toggle was clicked before init resolved, sync once more.
  applyTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
})();
