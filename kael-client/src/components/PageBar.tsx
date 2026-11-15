import { useState } from 'react';

export function usePage<T>(rows: T[], size = 50) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages - 1);
  const value = { rows: rows.slice(current * size, current * size + size), page: current, pages, setPage, total: rows.length };
  return { ...value, bar: <PageBar page={value.page} pages={value.pages} setPage={setPage} /> };
}

export function PageBar({ page, pages, setPage }: { page: number; pages: number; setPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 px-3 py-2 text-xs text-[#52736B]">
      <button type="button" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))} className="rounded border px-2 py-1 disabled:opacity-40">Sebelumnya</button>
      <span>{page + 1} / {pages}</span>
      <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="rounded border px-2 py-1 disabled:opacity-40">Berikutnya</button>
    </div>
  );
}
