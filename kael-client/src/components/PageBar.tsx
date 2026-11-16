import { useEffect, useState } from 'react';

export function usePage<T>(rows: T[], size = 50) {
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [rows.length]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages - 1);
  const value = { rows: rows.slice(current * size, current * size + size), page: current, pages, setPage, total: rows.length };
  return { ...value, bar: <PageBar page={value.page} pages={value.pages} setPage={setPage} /> };
}

export function PageBar({ page, pages, setPage }: { page: number; pages: number; setPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 px-3 py-2 text-xs text-[#52736B] dark:text-[#86B5A9]">
      <button type="button" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))} className="rounded border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0D2823] text-[#0F2922] dark:text-[#E6F4F1] hover:bg-[#EBF4F1] dark:hover:bg-[#163F35] px-2 py-1 disabled:opacity-40 cursor-pointer">Sebelumnya</button>
      <span>{page + 1} / {pages}</span>
      <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="rounded border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0D2823] text-[#0F2922] dark:text-[#E6F4F1] hover:bg-[#EBF4F1] dark:hover:bg-[#163F35] px-2 py-1 disabled:opacity-40 cursor-pointer">Berikutnya</button>
    </div>
  );
}
