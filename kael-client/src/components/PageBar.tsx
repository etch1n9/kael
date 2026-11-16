import { useEffect, useMemo, useState } from 'react';

export interface UsePageOptions {
  /** Pass asTableRow so `bar` is a tbody-legal <tr>; default `bar` stays a <div>, and `tableBar` is always the row variant. */
  asTableRow?: boolean;
  resetKey?: string;
  size?: number;
}

function rowIdSetKey<T>(rows: T[]): string {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !('id' in row)) continue;
    const id = (row as { id?: unknown }).id;
    if (id === undefined || id === null) continue;
    ids.add(String(id));
  }
  return Array.from(ids).sort().join('\u0001');
}

export function usePage<T>(rows: T[], sizeOrOptions: number | UsePageOptions = 50, options?: UsePageOptions) {
  const resolved: UsePageOptions =
    typeof sizeOrOptions === 'object' && sizeOrOptions !== null ? sizeOrOptions : options ?? {};
  const size = typeof sizeOrOptions === 'number' ? sizeOrOptions : resolved.size ?? 50;
  const [page, setPage] = useState(0);
  const idSetKey = useMemo(() => rowIdSetKey(rows), [rows]);
  const resetKey = resolved.resetKey;

  useEffect(() => {
    setPage(0);
  }, [idSetKey, rows.length, resetKey]);

  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages - 1);
  const value = {
    rows: rows.slice(current * size, current * size + size),
    page: current,
    pages,
    setPage,
    total: rows.length,
  };
  return {
    ...value,
    bar: <PageBar page={value.page} pages={value.pages} setPage={setPage} asTableRow={resolved.asTableRow === true} />,
    tableBar: <PageBar page={value.page} pages={value.pages} setPage={setPage} asTableRow />,
  };
}

const pagerButtonClass =
  'rounded border border-[#C5D9D3] dark:border-[#5F8F84] px-2 py-1 text-[#0F2922] dark:text-[#E6F4F1] disabled:opacity-40 disabled:border-[#C5D9D3] disabled:text-[#52736B] disabled:dark:border-[#6F9F94] disabled:dark:text-[#D5E8E2]';

export function PageBar({
  page,
  pages,
  setPage,
  asTableRow = false,
}: {
  page: number;
  pages: number;
  setPage: (page: number) => void;
  asTableRow?: boolean;
}) {
  if (pages <= 1) return null;
  const controls = (
    <div className="flex items-center justify-end gap-2 px-3 py-2 text-xs text-[#52736B] dark:text-[#D5E8E2]">
      <button type="button" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))} className={pagerButtonClass}>Sebelumnya</button>
      <span className="text-[#52736B] dark:text-[#D5E8E2]">{page + 1} / {pages}</span>
      <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className={pagerButtonClass}>Berikutnya</button>
    </div>
  );
  if (asTableRow) {
    return (
      <tr>
        <td colSpan={99}>{controls}</td>
      </tr>
    );
  }
  return controls;
}
