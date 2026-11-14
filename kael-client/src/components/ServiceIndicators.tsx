import { useState } from 'react';
import type { WorkspacePayload } from '../utils/apiClient';

const REFERENCES = {
  inpatient: { title: 'Definisi indikator pelayanan rumah sakit — BPS / Dinas Kesehatan', href: 'https://sirusa.web.bps.go.id/metadata/indikator/6f6f307b-6556-e2b5-557a-a4f274585336' },
  kbk: { title: 'Peraturan BPJS Kesehatan Nomor 7 Tahun 2019 — Lampiran', href: 'https://jdih.djsn.go.id/assets/file/07-bpjsk-2019.pdf' },
  waiting: { title: 'Indikator Nasional Mutu Rumah Sakit — Kemenkes', href: 'https://keslan.kemkes.go.id/inm/index/104350' },
};

export function ServiceIndicators({ workspace }: { workspace: WorkspacePayload }) {
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const visitsAllowed = workspace.dataAccess?.visits === true;
  const bedsAllowed = workspace.dataAccess?.beds === true;
  const monthlyVisits = workspace.visits.filter((visit) => {
    const date = new Date(visit.createdAt);
    return Number.isFinite(date.getTime()) && `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` === period && visit.status !== 'BATAL';
  });
  const beds = workspace.beds.filter((bed) => bed.bedClass !== 'IGD_OBS' && bed.status !== 'MAINTENANCE');
  const occupied = beds.filter((bed) => bed.status === 'TERISI').length;
  const occupancy = bedsAllowed && beds.length > 0 ? new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(occupied / beds.length * 100) + '%' : null;
  const metrics = [
    { name: 'BOR — pemakaian tempat tidur selama periode', formula: 'Hari perawatan ÷ hari kapasitas tempat tidur × 100%.', missing: 'Sensus harian dan perubahan kapasitas selama periode.', scope: 'Rawat inap', source: REFERENCES.inpatient },
    { name: 'ALOS — rata-rata lama rawat pasien keluar', formula: 'Total lama rawat pasien keluar ÷ jumlah pasien keluar hidup dan meninggal.', missing: 'Tanggal masuk, tanggal keluar, serta kohort pasien keluar pada periode yang sama.', scope: 'Rawat inap', source: REFERENCES.inpatient },
    { name: 'TOI — rata-rata interval tempat tidur kosong', formula: '(Hari kapasitas − hari perawatan) ÷ jumlah pasien keluar.', missing: 'Sensus, kapasitas, dan pasien keluar untuk satu periode.', scope: 'Rawat inap', source: REFERENCES.inpatient },
    { name: 'BTO — frekuensi penggunaan tempat tidur', formula: 'Jumlah pasien keluar ÷ jumlah tempat tidur pada periode yang dilaporkan.', missing: 'Rekap pasien keluar dan kapasitas tempat tidur sesuai periode.', scope: 'Rawat inap', source: REFERENCES.inpatient },
    { name: 'NDR dan GDR — kematian pasien rawat inap', formula: 'NDR memakai kematian setelah 48 jam; GDR memakai seluruh kematian. Satuan per 1.000 pasien keluar.', missing: 'Waktu kematian, lama perawatan, dan rekap pasien keluar.', scope: 'Rawat inap', source: REFERENCES.inpatient },
    { name: 'Angka kontak peserta JKN', formula: 'Peserta terdaftar yang melakukan kontak ÷ peserta terdaftar × 1.000.', missing: 'Register kontak lengkap dan kepesertaan bulanan. Antrean klinik saja belum mencakup seluruh kontak.', scope: 'FKTP dengan kontrak KBK', source: REFERENCES.kbk },
    { name: 'Rasio rujukan nonspesialistik', formula: 'Rujukan nonspesialistik yang memenuhi definisi ÷ seluruh rujukan FKTP × 100%.', missing: 'Klasifikasi rujukan serta pengecualian TACC yang tervalidasi.', scope: 'FKTP dengan kontrak KBK', source: REFERENCES.kbk },
    { name: 'Rasio peserta Prolanis terkendali', formula: '(Rasio peserta DM terkendali + rasio peserta hipertensi terkendali) ÷ 2.', missing: 'Kohort DM dan hipertensi terpisah, kepesertaan, serta pengukuran kendali pada periode terkait.', scope: 'FKTP dengan kontrak KBK', source: REFERENCES.kbk },
    { name: 'Kepatuhan waktu tunggu rawat jalan', formula: 'Pasien yang memenuhi batas waktu tunggu ÷ pasien yang diobservasi × 100%.', missing: 'Waktu kedatangan/pendaftaran, awal pelayanan dokter, kriteria sampel dan pengecualian.', scope: 'Indikator mutu rumah sakit', source: REFERENCES.waiting },
  ];

  return (
    <section className="space-y-4 rounded-2xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D] p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-lg font-semibold">Indikator layanan dan dasar perhitungan</h2><p className="mt-1 text-sm text-[#52736B] dark:text-[#86B5A9]">Pilih periode untuk melihat cakupan data operasional. Rumus pelaporan memerlukan sumber yang lengkap.</p></div>
        <label className="text-xs font-semibold">Periode laporan<input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} required className="mt-1 block rounded-lg border border-[#D5E3DF] bg-transparent px-3 py-2" /></label>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-[#F3F8F6] dark:bg-[#071714] p-4"><dt className="text-sm">Kunjungan tercatat pada periode</dt><dd className="mt-1 text-xl font-semibold">{visitsAllowed ? monthlyVisits.length.toLocaleString('id-ID') : 'Akses terbatas'}</dd></div>
        <div className="rounded-xl bg-[#F3F8F6] dark:bg-[#071714] p-4"><dt className="text-sm">Keterisian tempat tidur saat ini</dt><dd className="mt-1 text-xl font-semibold">{bedsAllowed ? occupancy || 'Belum tersedia' : 'Akses terbatas'}</dd><p className="mt-1 text-xs">{bedsAllowed ? `${occupied} terisi dari ${beds.length} tempat tidur aktif.` : 'Data rawat inap tidak tersedia untuk izin akun ini.'} Pengukuran sesaat ini belum menjadi BOR periode.</p></div>
      </dl>
      <p className="text-sm leading-6 text-[#52736B] dark:text-[#86B5A9]">Target, bobot skor, serta pencairan kapitasi memerlukan ketentuan yang berlaku bagi fasilitas dan periode kontraknya. Referensi KBK 2019 di bawah merupakan dasar penelusuran; penerapannya perlu dicocokkan dengan kontrak dan ketentuan terbaru. Belum ada penilaian lulus/gagal atau estimasi pembayaran yang diterapkan.</p>
      <div className="space-y-2">
        {metrics.map((metric) => <details key={metric.name} className="rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] p-4">
          <summary className="cursor-pointer text-sm font-semibold">{metric.name}</summary>
          <dl className="mt-3 space-y-2 text-sm leading-6"><div><dt className="font-medium">Cakupan</dt><dd>{metric.scope}</dd></div><div><dt className="font-medium">Cara menghitung</dt><dd>{metric.formula}</dd></div><div><dt className="font-medium">Sumber yang masih diperlukan</dt><dd>{metric.missing}</dd></div><div><dt className="font-medium">Hasil</dt><dd>Belum dapat dihitung dari sumber yang tersedia.</dd></div></dl>
          <a href={metric.source.href} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-medium text-[#00897B] underline">{metric.source.title}</a>
        </details>)}
      </div>
    </section>
  );
}
