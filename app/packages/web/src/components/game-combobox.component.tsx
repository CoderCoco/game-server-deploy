import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '../lib/utils.utils.js';
import { useClickOutside } from '../hooks/use-click-outside.hook.js';

interface Props {
  games: string[];
  value: string;
  onChange: (game: string) => void;
  className?: string;
}

/**
 * Searchable game selector. Renders a button trigger that opens a small popover
 * with a text filter and a list of matching games. Closes on selection, Esc,
 * or click-outside. Built on plain elements + Tailwind so we don't need to add
 * a Popover/cmdk dependency just for this surface.
 */
export function GameCombobox({ games, value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return games;
    return games.filter((g) => g.toLowerCase().includes(q));
  }, [games, query]);

  // Close the popover on outside-click or Escape. The hook owns the
  // document-level listeners; we just hand it the container ref + a close
  // callback. (Stable handler via useCallback so the hook's deps array
  // doesn't churn on every render.)
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(containerRef, close, open);

  // Focus the search input on open so users can start typing immediately.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const select = (g: string) => {
    onChange(g);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-label={value ? `Game selector, ${value} selected` : 'Game selector'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-56 items-center justify-between rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5 text-sm text-[var(--color-foreground)] hover:bg-[var(--color-border)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
      >
        <span className="truncate font-[var(--font-mono)]">{value || 'Select a game…'}</span>
        <ChevronsUpDown className="h-4 w-4 opacity-60" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-72 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
            <Search className="h-4 w-4 opacity-50" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search games…"
              className="w-full bg-transparent text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-[var(--color-muted-foreground)]">No games found.</div>
            ) : (
              filtered.map((g) => {
                const selected = g === value;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => select(g)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-sm font-[var(--font-mono)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-2)]',
                      selected && 'bg-[var(--color-surface-2)]',
                    )}
                  >
                    <span className="truncate">{g}</span>
                    {selected && <Check className="h-4 w-4 text-[var(--color-primary-light)]" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
