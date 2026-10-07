import { clamp } from '@/lib/dates';
import type { Category } from '@/lib/types';

export type View = 'day' | 'week' | 'month';

/** A half-hour on a day that something can be put into. */
export interface Slot {
  date: string;
  min: number;
}

export const CAT: Record<Category, string> = {
  work: 'var(--indigo)',
  life: 'var(--matcha)',
  focus: 'var(--verm)',
  misc: 'var(--other)',
};

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'work', label: 'Work' },
  { id: 'life', label: 'Life' },
  { id: 'focus', label: 'Focus' },
  { id: 'misc', label: 'Other' },
];

/** Height of one hour on the timeline: sized so about 08:00–20:30 fits the window without scrolling. */
export function hourHeight(mobile: boolean, viewportH: number) {
  const room = mobile ? viewportH - 56 - 72 - 48 - 64 : viewportH - 64 - 64 - 8;
  return clamp(Math.round(room / 12.5), mobile ? 48 : 44, 58);
}

export const things = (n: number) => (n === 0 ? 'Nothing waiting' : `${n} ${n === 1 ? 'thing' : 'things'}`);

export const SURFACE = 'rounded-[5px] bg-bg shadow-[0_18px_44px_-18px_var(--shadow),0_0_0_1px_var(--line)] animate-in';

export function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="6" cy="6" r="4.25" />
      <path d="M9.2 9.2 12.5 12.5" />
    </svg>
  );
}
