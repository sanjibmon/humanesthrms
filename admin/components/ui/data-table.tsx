'use client';

import { useMemo, useState } from 'react';
import { Icon } from '@/components/icon';
import { EmptyState } from '@/components/shell';
import type { IconName } from '@/components/icon';

export type Column<T> = {
  key: string;
  header: string;
  /** Plain value used for search and sort. Falls back to the rendered cell. */
  value?: (row: T) => string | number | null | undefined;
  cell?: (row: T) => React.ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right';
  /** Hidden below this breakpoint so narrow screens stay readable. */
  hideBelow?: 'sm' | 'md' | 'lg';
};

const HIDE: Record<string, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
};

export function DataTable<T extends { id?: string }>({
  rows,
  columns,
  searchPlaceholder = 'Search…',
  pageSize = 25,
  empty,
  toolbar,
  rowActions,
}: {
  rows: T[];
  columns: Column<T>[];
  searchPlaceholder?: string;
  pageSize?: number;
  empty: { icon: IconName; title: string; body: string; action?: React.ReactNode };
  toolbar?: React.ReactNode;
  rowActions?: (row: T) => React.ReactNode;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; asc: boolean } | null>(null);
  const [page, setPage] = useState(0);

  const valueOf = (row: T, col: Column<T>) => col.value?.(row) ?? '';

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      columns.some((c) => String(valueOf(r, c) ?? '').toLowerCase().includes(needle)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, columns]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    return [...filtered].sort((a, b) => {
      const av = valueOf(a, col);
      const bv = valueOf(b, col);
      if (typeof av === 'number' && typeof bv === 'number') return sort.asc ? av - bv : bv - av;
      const as = String(av ?? '');
      const bs = String(bv ?? '');
      return sort.asc ? as.localeCompare(bs) : bs.localeCompare(as);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const slice = sorted.slice(current * pageSize, current * pageSize + pageSize);

  if (!rows.length) {
    return (
      <div className="card">
        {toolbar ? <div className="mb-4 flex flex-wrap items-center gap-2.5">{toolbar}</div> : null}
        <EmptyState icon={empty.icon} title={empty.title} body={empty.body} action={empty.action} />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <label className="relative flex min-w-[200px] flex-1 items-center">
          <span className="pointer-events-none absolute left-3 text-slate-faint">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </span>
          <input
            type="text"
            value={q}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="!pl-9"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setQ(e.target.value);
              setPage(0);
            }}
          />
        </label>
        {toolbar}
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          icon="chart"
          title="Nothing matches that search"
          body={`No record contains “${q}”. Clear the search to see all ${rows.length}.`}
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className={`${c.sortable ? 'sortable' : ''} ${c.align === 'right' ? 'text-right' : ''} ${c.hideBelow ? HIDE[c.hideBelow] : ''}`}
                      onClick={() =>
                        c.sortable &&
                        setSort((s) => (s?.key === c.key ? { key: c.key, asc: !s.asc } : { key: c.key, asc: true }))
                      }
                      aria-sort={sort?.key === c.key ? (sort.asc ? 'ascending' : 'descending') : undefined}
                    >
                      {c.header}
                      {sort?.key === c.key ? <span className="ml-1">{sort.asc ? '▲' : '▼'}</span> : null}
                    </th>
                  ))}
                  {rowActions ? <th className="text-right">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {slice.map((row, i) => (
                  <tr key={row.id ?? i}>
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={`${c.align === 'right' ? 'text-right tabular-nums' : ''} ${c.hideBelow ? HIDE[c.hideBelow] : ''}`}
                      >
                        {c.cell ? c.cell(row) : String(valueOf(row, c) ?? '—')}
                      </td>
                    ))}
                    {rowActions ? (
                      <td className="text-right">
                        <div className="flex justify-end gap-1.5">{rowActions(row)}</div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 ? (
            <div className="mt-3.5 flex items-center justify-between gap-3 text-xs text-slate-muted">
              <span>
                {current * pageSize + 1}–{Math.min(sorted.length, (current + 1) * pageSize)} of {sorted.length}
              </span>
              <div className="flex gap-2">
                <button className="btn btn-sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
                  Previous
                </button>
                <button className="btn btn-sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
