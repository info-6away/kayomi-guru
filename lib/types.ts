export type Category = 'work' | 'life' | 'focus' | 'misc';
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

/**
 * A series repeats on its first event's weekday, day of month or date.
 * Days are local calendar days, 'YYYY-MM-DD'.
 */
export interface Recurrence {
  freq: Frequency;
  /** Last day an occurrence may fall on, inclusive. */
  until: string | null;
  /** Days removed from the series. */
  except: string[];
}

/**
 * An event of Koyomi's own. Records written before Plan was removed may also carry a
 * `planItemId`; it means nothing now and is left as it is.
 */
export interface CalendarEvent {
  id: string;
  title: string;
  /**
   * Timed: ISO 8601 UTC instants. All-day: the calendar day, 'YYYY-MM-DD', in both: a day is a
   * day wherever it is read, so it is never converted through a time zone.
   * For a series, the first occurrence.
   */
  start: string;
  end: string;
  /** Shown in the all-day row rather than at a time. */
  allDay: boolean;
  category: Category;
  recurrence: Recurrence | null;
  createdAt: string;
  updatedAt: string;
}
