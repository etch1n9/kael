import { Component, type ReactNode } from 'react';

export class ApplicationBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="min-h-screen bg-[#F4F8F6] px-6 py-16 text-[#183D34]">
        <section role="alert" className="mx-auto max-w-lg rounded-2xl border border-[#D5E3DF] bg-white p-8">
          <h1 className="text-xl font-semibold">Ruang kerja belum dapat ditampilkan</h1>
          <p className="mt-3 text-sm leading-6">Muat ulang untuk mengambil tampilan terbaru. Data yang sudah tersimpan tetap berada di server.</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-6 rounded-xl bg-[#00897B] px-5 py-3 font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00897B]">Muat ulang aplikasi</button>
        </section>
      </main>
    );
  }
}
