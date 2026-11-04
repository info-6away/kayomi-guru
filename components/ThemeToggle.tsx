'use client';

import { useEffect, useState } from 'react';
import { currentTheme, toggleTheme, watchTheme } from '@/lib/theme';

/** Whether the page is in its dark theme now, following every change, including one the system makes. */
export function useDarkTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const read = () => setDark(currentTheme() === 'dark');
    read();
    const watcher = new MutationObserver(read);
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => watcher.disconnect();
  }, []);
  return dark;
}

/**
 * The switch between paper and ink, as a half-filled moon. Said to assistive technology as what it
 * is, a dark theme that is on or off, and shown as that on hover.
 */
export function ThemeSwitch({ className, dot }: { className: string; dot: string }) {
  const dark = useDarkTheme();
  return (
    <button onClick={toggleTheme} aria-label="Dark theme" aria-pressed={dark} title={dark ? 'Dark theme is on' : 'Dark theme is off'} className={className}>
      <span className={`rounded-full border border-current bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)] ${dot}`} />
    </button>
  );
}

/** The landing page's theme switch. The choice is kept, exactly as in the calendar. */
export function ThemeToggle() {
  useEffect(() => watchTheme(), []);
  return <ThemeSwitch className="grid size-8 place-items-center text-muted hover:text-ink2" dot="size-2.5" />;
}
