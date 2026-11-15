'use client';

import { useEffect, useState } from 'react';

// A phone's on-screen keyboard does not make the page shorter: iOS never does, and Android Chrome
// no longer does by default. It covers the bottom of the window, and only `visualViewport` says by
// how much. Koyomi is a box the height of the window whose day scrolls inside it, so whatever is
// typed into low on the day (an event's details at the end of the evening, a title growing line by
// line) went behind the keyboard, with no way to scroll it out. These give the day room to scroll
// while a keyboard is up, and keep the line being typed above it.

/** Space kept between the line being typed and the top of the keyboard. */
const GAP = 12;

/** How much of the bottom of the window a keyboard covers, in CSS pixels: 0 when there is none. */
export function keyboardCover(): number {
  const seen = window.visualViewport;
  // Zoomed in by a pinch, less of the window is seen for another reason.
  if (!seen || seen.scale > 1.01) return 0;
  const cover = document.documentElement.clientHeight - (seen.offsetTop + seen.height);
  // A browser's own bars coming and going change this by a few pixels; a keyboard is far taller.
  return cover > 80 ? Math.round(cover) : 0;
}

/** The keyboard's cover (see keyboardCover), kept up to date while the component is on screen. */
export function useKeyboardCover(): number {
  const [cover, setCover] = useState(0);
  useEffect(() => {
    const seen = window.visualViewport;
    if (!seen) return;
    const update = () => setCover(keyboardCover());
    update();
    seen.addEventListener('resize', update);
    seen.addEventListener('scroll', update);
    return () => {
      seen.removeEventListener('resize', update);
      seen.removeEventListener('scroll', update);
    };
  }, []);
  return cover;
}

/** What is copied from a field to lay its text out again exactly as it does. */
const LAYOUT = [
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'font-stretch',
  'font-variant',
  'font-feature-settings',
  'font-kerning',
  'letter-spacing',
  'word-spacing',
  'line-height',
  'text-transform',
  'text-indent',
  'tab-size',
  'overflow-wrap',
  'word-break',
  'direction',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
];

/** Where, on screen, the line with the caret ends. A one-line field is its own line. */
function caretLineBottom(field: HTMLInputElement | HTMLTextAreaElement): number {
  const box = field.getBoundingClientRect();
  if (!(field instanceof HTMLTextAreaElement)) return box.bottom;
  // The text up to the caret, laid out again as the field lays it out, shows which line it is on.
  const style = getComputedStyle(field);
  const copy = document.createElement('div');
  for (const name of LAYOUT) copy.style.setProperty(name, style.getPropertyValue(name));
  Object.assign(copy.style, {
    position: 'absolute',
    top: '0',
    left: '-10000px',
    visibility: 'hidden',
    whiteSpace: 'pre-wrap',
    boxSizing: 'border-box',
    border: '0',
    width: `${field.clientWidth}px`,
  });
  copy.textContent = field.value.slice(0, field.selectionEnd ?? field.value.length);
  const caret = copy.appendChild(document.createElement('span'));
  caret.textContent = '​';
  document.body.appendChild(copy);
  const line = parseFloat(style.lineHeight) || caret.offsetHeight;
  // The mark's box is the font's height, centred in its line: the line ends half the difference below it.
  const bottom = box.top + field.clientTop - field.scrollTop + caret.offsetTop + (caret.offsetHeight + line) / 2;
  copy.remove();
  return bottom;
}

/** The nearest box around `el` that scrolls up and down. */
function scrollerOf(el: Element): HTMLElement | null {
  for (let at = el.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === 'auto' || overflowY === 'scroll') return at;
  }
  return null;
}

/**
 * If the line being typed on in `field` is below what can be seen (behind a keyboard, or below the
 * bottom of the day), scrolls the day just enough to bring it up. Only the day scrolls, never the
 * page, and only for the field that has the caret.
 */
export function keepCaretInSight(field: HTMLInputElement | HTMLTextAreaElement | null) {
  if (!field || document.activeElement !== field) return;
  const scroller = scrollerOf(field);
  if (!scroller) return;
  const seen = window.visualViewport;
  const seenBottom = seen ? seen.offsetTop + seen.height : innerHeight;
  const below = caretLineBottom(field) - (Math.min(scroller.getBoundingClientRect().bottom, seenBottom) - GAP);
  if (below > 0) scroller.scrollTop += below;
}

/** The field inside `within` that has the caret, if any. */
export function typingIn(within: Element | null): HTMLInputElement | HTMLTextAreaElement | null {
  const field = document.activeElement;
  if (!within || !field || !within.contains(field)) return null;
  if (field instanceof HTMLTextAreaElement) return field;
  return field instanceof HTMLInputElement && !['date', 'checkbox', 'radio', 'button', 'submit', 'hidden'].includes(field.type) ? field : null;
}
