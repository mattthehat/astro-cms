/** Colour variants shared by pills and standalone cell icons */
export type CellVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'accent' | 'muted' | 'light' | 'dark';

/**
 * Structured cell content a decorator can return instead of a plain string.
 * Lets a column wrap its value in a pill, prepend/append text, or show an icon.
 */
export type CellContent = {
  /** Display text. Omit for an icon-only cell (e.g. a boolean tick). */
  text?: string;
  /** Render the content inside a pill/badge of this colour. */
  pill?: CellVariant;
  /** lucide icon name shown before the text (or alone when there is no text). */
  icon?: string;
  /** Colour for a standalone icon. */
  iconVariant?: CellVariant;
  /** Text rendered immediately before the value. */
  prefix?: string;
  /** Text rendered immediately after the value. */
  suffix?: string;
  /** Accessible label when the cell is icon-only. */
  label?: string;
};

/** A decorator returns either a plain string or a structured descriptor. */
export type CellValue = string | CellContent;

export type Decorator = (value: unknown, row: Record<string, unknown>) => CellValue;

export type Column = {
  key: string;
  label: string;
  /** Optional server-side formatter/decorator for the cell value */
  format?: Decorator;
  align?: 'left' | 'centre' | 'right';
  /** Render the header as a sort toggle */
  sortable?: boolean;
};

export type RowAction = {
  label: string;
  variant?: 'primary' | 'danger';
  /** lucide icon name shown before the label */
  icon?: string;
  /** When provided, the action only renders for rows where this returns true */
  show?: (row: Record<string, unknown>) => boolean;
} & (
  | { href: (row: Record<string, unknown>) => string }
  | { formAction: (row: Record<string, unknown>) => string; confirm?: string }
);
