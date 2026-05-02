import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '../lib/utils.js';

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

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    // Focus the search input on open
    inputRef.current?.focus();
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
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
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-56 items-center justify-between rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5 text-sm text-[var(--color-foreground)] hover:bg-[var(--color-border)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
      >
        <span className="truncate font-[var(--font-mono)]">{value || 'Select a game…'}</span>
        <ChevronsUpDown className="h-4 w-4 opacity-60" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-50 mt-1 w-72 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg"
        >
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
