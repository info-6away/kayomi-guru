export type Theme = 'light' | 'dark';

/** Keeps the product's first spelling, so a theme chosen before the rename is still found. */
export const THEME_KEY = 'kayomi-theme';
/** Page backgrounds: warm paper, and ink at night. Also the browser/window chrome colour. */
export const THEME_BG: Record<Theme, string> = { light: '#F5F1E8', dark: '#1D1D1B' };

/**
 * Runs before first paint so the page never flashes the wrong palette:
 * the saved choice wins, otherwise the system setting.
 */
export const themeBootScript = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){}})()`;

export const currentTheme = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute('content', THEME_BG[theme]));
}

export function toggleTheme() {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Storage is blocked: the choice lasts for this visit only.
  }
}

/** Keeps the window chrome in step, and follows the system until a choice has been saved. */
export function watchTheme() {
  applyTheme(currentTheme());
  const media = matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch {}
    if (!saved) applyTheme(media.matches ? 'dark' : 'light');
  };
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
