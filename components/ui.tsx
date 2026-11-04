import { clamp } from '@/lib/dates';
import type { Category } from '@/lib/types';

export type View = 'day' | 'week' | 'month';

/** A half-hour on a day that something can be put into. */
export interface Slot {
  date: string;
  min: number;
  /** Where a new event ends, when its time was marked out by dragging. Otherwise it lasts an hour. */
  end?: number;
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

export const SURFACE = 'rounded-[5px] bg-bg shadow-[0_18px_44px_-18px_var(--shadow),0_0_0_1px_var(--line)] animate-in';

/** Marks a line that says something went wrong. Drawn in the colour of its text, so it is never louder than the words. */
export function AlertIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true" className="mt-[3px] flex-none">
      <circle cx="6" cy="6" r="5.2" />
      <path d="M6 3.3v3.2" />
      <path d="M6 8.6v.01" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * The quiet ×, small to the eye. On a phone what takes the tap is a full 44px around it, and its
 * row makes room for that, so the tap never reaches over what is below.
 */
export function CloseButton({ mobile, label, onClose }: { mobile: boolean; label: string; onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      aria-label={label}
      className={`ml-auto grid flex-none place-items-center rounded-full text-[16px] leading-none text-muted hover:bg-wash hover:text-ink ${mobile ? '-mt-2 -mr-3 size-11' : '-my-1.5 -mr-2 size-7'}`}
    >
      ×
    </button>
  );
}

/** What a line in vermilion says: something the person asked for did not happen, or needs them. */
export const TROUBLE = 'flex items-start gap-1.5 text-verm-text';

export function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="6" cy="6" r="4.25" />
      <path d="M9.2 9.2 12.5 12.5" />
    </svg>
  );
}
