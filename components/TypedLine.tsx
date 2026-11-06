'use client';

import { useEffect, useRef, useState } from 'react';

/** What the landing page's quick-add line types: one of the sample week's own events. */
export const TYPED = 'Team lunch';

/**
 * The landing page's quick-add line, "14:00 │ …", typing an event the way a person would once it
 * comes into view, then resting. With reduced motion it is simply there, already written.
 */
export function TypedLine() {
  const [typed, setTyped] = useState('');
  const [caret, setCaret] = useState(true);
  const line = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTyped(TYPED);
      setCaret(false);
      return;
    }
    const timers: number[] = [];
    const blink = window.setInterval(() => setCaret((on) => !on), 530);
    const watcher = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        watcher.disconnect();
        let at = 900;
        for (let i = 1; i <= TYPED.length; i++) {
          at += 55 + Math.random() * 60;
          timers.push(window.setTimeout(() => setTyped(TYPED.slice(0, i)), at));
        }
        timers.push(
          window.setTimeout(() => {
            window.clearInterval(blink);
            setCaret(false);
          }, at + 900),
        );
      },
      { threshold: 0.8 },
    );
    if (line.current) watcher.observe(line.current);
    return () => {
      watcher.disconnect();
      window.clearInterval(blink);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return (
    <div ref={line} className="flex h-[38px] items-center gap-2.5 border-t border-l-2 border-t-line2 border-l-verm pl-2.5">
      {/* Small text in the accent takes its deeper shade, as everywhere else. */}
      <span className="text-[12px] tracking-[.03em] text-verm-text tabular-nums">14:00</span>
      <span className="h-4 w-px bg-line" />
      <span className="min-w-0 text-[14px] whitespace-nowrap">{typed}</span>
      <span className="h-4 w-[1.5px] flex-none bg-verm" style={{ opacity: caret ? 1 : 0 }} />
    </div>
  );
}
