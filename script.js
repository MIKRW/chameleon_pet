(function () {
  const root = document.documentElement;
  const themeToggle = document.getElementById('theme-toggle');

  // Maps the site's light/dark theme to a named palette from
  // chameleon-themes.js — see that file to add or tweak moods.
  const PET_THEME_FOR_SITE_THEME = {
    light: 'moss',
    dark: 'midnight',
  };

  function applyTheme(theme) {
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
    if (window.__chameleonPetInstance) {
      window.__chameleonPetInstance.setTheme(PET_THEME_FOR_SITE_THEME[theme]);
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
