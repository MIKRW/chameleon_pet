(function () {
  const root = document.documentElement;
  const themeToggle = document.getElementById('theme-toggle');

  const THEME_PALETTES = {
    light: null, // use the chameleon's default palette
    dark: {
      body: '#7fd99a',
      bodyLight: '#bff2cf',
      bodyDark: '#2f5c40',
    },
  };

  function applyTheme(theme) {
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
    if (window.__chameleonPetInstance) {
      window.__chameleonPetInstance.setPalette(THEME_PALETTES[theme]);
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
