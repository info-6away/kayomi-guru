'use client';

import { useEffect } from 'react';
import { toggleTheme, watchTheme } from '@/lib/theme';

/** The landing page's ink-mode switch. The choice is kept, exactly as in the calendar. */
export function ThemeToggle() {
  useEffect(() => watchTheme(), []);
  return (
    <button onClick={toggleTheme} aria-label="Toggle ink mode" className="grid size-8 place-items-center text-muted hover:text-ink2">
      <span className="size-2.5 rounded-full border border-current bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)]" />
    </button>
  );
}
