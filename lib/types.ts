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

export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO 8601 UTC instants. For a series, the first occurrence. */
  start: string;
  end: string;
  /** Reserved. Always false until the design has an all-day row. */
  allDay: boolean;
  category: Category;
  /** Set when the event was scheduled from Plan. Such an event never repeats. */
  planItemId: string | null;
  recurrence: Recurrence | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Something waiting for time. Whether it is scheduled is not stored here:
 * an item is scheduled exactly when an event points at it.
 */
export interface PlanItem {
  id: string;
  title: string;
  status: 'open' | 'completed';
  createdAt: string;
  updatedAt: string;
}
