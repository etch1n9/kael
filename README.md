# KAEL

KAEL terdiri dari client browser React dan backend Rust. Client mengakses API HTTP(S); data, akun, role, otorisasi, dan audit disimpan di server.

| Direktori | Tanggung jawab |
|---|---|
| `kael-client/` | Antarmuka browser, kontrak data API, helper tampilan, aset, dan build web |
| `kael-server/` | Layanan Rust, aturan operasional, otorisasi, dan database SQLite |
| `scripts/` | Perintah build dan pengembangan dari akar proyek |

Target client saat ini adalah browser. Tidak ada proses build aplikasi desktop atau paket Debian.

## Persiapan

Gunakan Node.js 22.18 atau lebih baru untuk toolchain client, serta Rust dan Cargo untuk backend. Backend yang telah dikompilasi dijalankan sebagai executable Rust tanpa Node.js.

```sh
npm ci
npm run build
```

Dependensi Rust mengikuti `kael-server/Cargo.lock`. Hasil build backend berada di `kael-server/target/release/kael-server`, dan hasil build client berada di `kael-client/dist/`. Cache compiler dan dependensi berada di direktori `target/`.

Konfigurasi tersedia pada `kael-server/.env.example` dan `kael-client/.env.example`. Salin menjadi `.env` pada direktori masing-masing bila perlu. Environment proses diutamakan. Semua path relatif server dihitung dari `KAEL_SERVER_ROOT`; perintah proyek menentukan direktori ini secara otomatis. `KAEL_DATA_FILE` dan `KAEL_WEB_ROOT` juga menerima path absolut.

## Administrasi awal

Untuk instalasi baru, jalankan:

```sh
npm run setup
```

Username, nama tampilan, dan kata sandi dapat diberikan melalui `KAEL_ADMIN_USERNAME`, `KAEL_ADMIN_FULL_NAME`, serta `KAEL_ADMIN_PASSWORD` atau `KAEL_ADMIN_PASSWORD_FILE`. Setup hanya membuat akun superuser awal dan menolak menimpa database yang sudah ada. Kata sandi minimal delapan karakter; password disimpan sebagai hash scrypt.

Fasilitas dan role operasional dibuat manual melalui panel superuser. Tidak ada fasilitas atau role bisnis yang disisipkan ke instalasi baru. Nama role, status, dan hak modul disimpan di database. Hak akses diperiksa kembali oleh backend pada setiap operasi.

Profil **Tenaga pemeriksa klinis** ditetapkan manual pada akun. Akun baru tidak otomatis dianggap tenaga pemeriksa karena memiliki hak administrator atau akses RME. Untuk dapat dipilih pada antrean, akun harus aktif, ditandai sebagai tenaga pemeriksa, serta memiliki akses RME dan fasilitas yang sesuai.

Database default adalah `kael-server/storage/kael.sqlite`. Lokasinya dapat diganti melalui `KAEL_DATA_FILE`. Setup menolak database yang sudah ada.

## Web dan API pada satu server

```sh
npm start
```

Buka [http://127.0.0.1:1507](http://127.0.0.1:1507). Perintah ini melayani build browser dan API `/api` pada origin yang sama. Server menggunakan `KAEL_HOST` dan `PORT`, dengan nilai awal `127.0.0.1` serta `1507`. Untuk menerima koneksi dari jaringan lain, atur alamat listen pada interface server yang sesuai; `0.0.0.0` adalah alamat listen seluruh interface, sedangkan client menggunakan IP atau hostname server yang dapat dijangkau.

Untuk akses dari komputer lain, gunakan reverse proxy HTTPS dengan sertifikat yang dipercaya client. Contoh Caddy:

```caddy
kael.instansi.id {
    reverse_proxy 127.0.0.1:1507
}
```

Browser komputer lain membuka `https://kael.instansi.id`. Untuk deployment dengan reverse proxy ini, tentukan `VITE_API_BASE_URL=https://kael.instansi.id` saat membangun client atau pilih alamat tersebut pada halaman login.

Backend juga dapat dijalankan langsung dari executable. Tentukan `KAEL_SERVER_ROOT` untuk lokasi konfigurasi dan path relatif data. Untuk mengaktifkan web, isi `KAEL_WEB_ROOT` dengan direktori build client.

## Client dan API terpisah

```sh
npm run start:server
```

Tanpa `KAEL_WEB_ROOT`, backend hanya melayani API. Build client dapat diterbitkan pada web server terpisah:

```sh
VITE_API_BASE_URL=https://api.kael.instansi.id npm run build:client
```

Pada backend, izinkan origin client yang sesuai:

```dotenv
KAEL_CLIENT_ORIGINS=https://app.kael.instansi.id
```

Daftar origin dapat dipisahkan koma dan harus berisi protokol, hostname, serta port bila diperlukan, tanpa path atau wildcard. Restart server setelah mengubah konfigurasinya.

Pengaturan **Atur server** menerima origin lengkap, misalnya `http://192.168.1.20:1507` atau `https://api.instansi.id`. Client menambahkan `/api` secara internal. Tanpa konfigurasi build, alamat awal memakai hostname situs dan port `1507`; alamat dapat diubah manual. Tidak ada pencarian atau pemindaian endpoint otomatis. Sesi terikat pada tujuan API dan pergantian tujuan mengosongkan kata sandi yang sedang diketik.

Jika web dilayani KAEL dan mengakses API pada origin berbeda, izinkan tujuan itu melalui `KAEL_API_ORIGINS`; backend tujuan juga perlu mengizinkan origin client melalui `KAEL_CLIENT_ORIGINS`. Browser tetap dapat menerapkan kebijakan HTTPS dan izin akses jaringan lokal. Mengganti alamat pada UI tidak mengubah izin jaringan server.

Kode fasilitas diisi manual. Tombol **Profil fasilitas** mengelola alamat server, kode fasilitas, dan label pilihan di penyimpanan lokal browser. Profil hanya tersimpan setelah pengguna menekan **Simpan**. Mengisi kode atau berhasil login tidak otomatis menyimpan profil. Profil tidak dikirim ke server dan tidak tersedia di browser/perangkat lain; profil browser yang disinkronkan, disalin, atau dipakai bersama mengikuti pengelolaan perangkat tersebut. Password tidak disimpan dalam profil fasilitas.

Endpoint kesehatan hanya memuat identitas layanan dan protokol. Tidak tersedia daftar fasilitas sebelum autentikasi. Setelah login, backend hanya memberikan fasilitas yang diizinkan untuk akun tersebut. Superuser dapat masuk tanpa kode fasilitas untuk membuka pengelolaan platform.

Variabel `VITE_` bersifat publik dan ditanam pada hasil build. Simpan hanya alamat API pada `VITE_API_BASE_URL`.

## Pengembangan

```sh
npm run dev -- --port 5174
```

Perintah ini menjalankan backend Rust dan Vite. Untuk menjalankan keduanya terpisah, gunakan `npm run dev:server` dan `npm run dev:client`. Perubahan source Rust memerlukan restart proses backend.

Vite menggunakan port awal `5173`, sedangkan preview build menggunakan `4173`. Proxy `/api` meneruskan request ke `KAEL_API_PROXY_TARGET`, dengan nilai awal `http://127.0.0.1:1507`. Untuk client pada origin pengembangan atau preview, izinkan origin tersebut melalui `KAEL_CLIENT_ORIGINS`.

```sh
npm run check
npm run build:client
npm run build:server
npm run preview
```

`check` memeriksa TypeScript dan Rust. `preview` hanya untuk melihat hasil build client; layanan operasional dijalankan dengan `npm start` atau web server yang menerbitkan `dist/`.

## Pengelolaan data dan akses

Superuser dapat mengelola fasilitas, role, akun, serta konfigurasi layanan melalui UI. Penghapusan akun menonaktifkan akses dan memindahkan akun ke **Akun Terhapus**. Identitas dan riwayat tetap tersimpan; akun dapat dipulihkan melalui UI dalam keadaan nonaktif, lalu diaktifkan kembali setelah aksesnya diperiksa. Superuser aktif terakhir dan akun yang sedang dipakai tidak dapat dihapus.

Fasilitas yang masih memiliki akun atau data operasional tidak dapat dihapus. Gunakan perubahan status fasilitas untuk menghentikan akses sambil mempertahankan riwayat. Role yang masih digunakan akun juga tidak dapat dihapus.

SQLite menyimpan data operasional dalam transaksi dengan pemeriksaan revisi. Gunakan satu proses backend untuk satu file database. Sesi berakhir saat backend dimulai ulang.

Antrean BPJS, SATUSEHAT, dan IoMT menyimpan permintaan lokal; pengiriman ke provider membutuhkan konfigurasi integrasi tersendiri. Pengisian presensi, pengajuan cuti, dan pencairan gaji belum diaktifkan karena penyimpanan operasionalnya belum tersedia pada server. Direktori tenaga medis memakai akun database; pengaturan jadwal dan kuota praktik belum tersedia.

Indikator keuangan dan pelayanan hanya dihitung dari data yang tersimpan. Jika saldo awal, periode penilaian, populasi peserta, atau sumber perhitungan lain belum tersedia, antarmuka menampilkan keterangan belum tersedia. Stok bank darah, sterilisasi, sarana, serta layanan klinis yang belum memiliki alur pencatatan lengkap tidak ditampilkan sebagai hasil pemeriksaan atau transaksi yang sudah dilakukan.

Tarif yang belum ditetapkan membuat tagihan berstatus `PENDING`. Petugas menetapkan komponen dan nominal melalui kasir, termasuk nilai nol bila layanan tanpa biaya. Pembayaran memerlukan harga lengkap. Pengajuan klaim berbeda dari penerimaan uang; rekonsiliasi mencatat nominal, referensi, waktu, serta petugas penerimaan yang sebenarnya. Perpindahan stok tidak otomatis dianggap sebagai pembayaran atau penerimaan kas.

## Dasar indikator dan katalog

Ringkasan operasional memuat antrean, kapasitas saat ini, dan transaksi tercatat. Perhitungan formal beserta kebutuhan datanya tersedia pada **Pelaporan dan indikator layanan**. Keterisian sesaat tidak diperlakukan sebagai BOR periode. Definisi BOR, ALOS, TOI, BTO, NDR, dan GDR mengikuti [metadata indikator Dinas Kesehatan yang diterbitkan BPS](https://sirusa.web.bps.go.id/metadata/indikator/6f6f307b-6556-e2b5-557a-a4f274585336).

[Peraturan BPJS Kesehatan Nomor 7 Tahun 2019](https://jdih.djsn.go.id/assets/file/07-bpjsk-2019.pdf) menjadi referensi penelusuran KBK, termasuk pemisahan rasio Prolanis DM dan hipertensi. Target serta pembayaran perlu dicocokkan dengan ketentuan dan kontrak fasilitas pada periode terkait. Sistem tidak menetapkan skor atau pencairan hanya dari jumlah kunjungan lokal. [Indikator Nasional Mutu Kemenkes](https://keslan.kemkes.go.id/inm/index/104350) menjelaskan waktu tunggu sebagai kepatuhan pada batas waktu dalam populasi yang diobservasi; rata-rata menit saja belum memenuhi definisinya.

Judul kode tindakan pada katalog ringkas dicocokkan dengan [kode ICD-9-CM CMS](https://www.cms.gov/medicare/coding-billing/icd-10-codes/icd-9-cm-diagnosis-procedure-codes-abbreviated-and-full-code-titles). Katalog tidak menetapkan tarif fasilitas. Hasil laboratorium tanpa rentang rujukan terverifikasi berstatus `UNASSESSED`; batas rujukan memerlukan sumber serta konteks metode/populasi, sebagaimana dimodelkan dalam [HL7 Observation](https://hl7.org/fhir/R4/observation.html). Skor peringatan klinis yang belum memiliki input dan protokol lengkap tidak ditampilkan sebagai hasil tervalidasi.

Susunan menu mengikuti alur kerja yang tersedia: persediaan menggabungkan katalog dan kartu mutasi, sementara resep, pengadaan, laboratorium, dan radiologi tetap memiliki konteks masing-masing. Pelaporan, antrean integrasi, dan administrasi dipisahkan. Pengelompokan ini merupakan keputusan desain berdasarkan fungsi yang dikerjakan dan pemisahan proses pada [panduan rawat jalan SATUSEHAT](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/) serta [modul HL7 FHIR](https://hl7.org/fhir/R4/modules.html), bukan klaim bahwa standar mewajibkan susunan menu tertentu.
