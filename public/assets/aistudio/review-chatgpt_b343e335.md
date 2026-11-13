CRITICAL ARCHITECTURE REVIEW — KAEL Healthcare & ERP

Status: REQUIRES FUNDAMENTAL REVISION BEFORE PRODUCTION IMPLEMENTATION

Argon, setelah meninjau keseluruhan implementation_plan.md, terdapat beberapa kesalahan fundamental, kekurangan arsitektur, serta asumsi operasional yang harus diperbaiki.

Perhatikan bahwa KAEL bukan sekadar aplikasi SIMKLINIK dan SIMRS. KAEL harus menjadi platform Healthcare & ERP modular, multi-facility, dan highly configurable, yang memungkinkan Superuser menyesuaikan sistem dengan kebutuhan setiap pelanggan tanpa harus meminta perubahan source code untuk setiap variasi pelayanan yang sudah didukung platform.

1. CRITICAL — Dual-Topology Adaptive Engine adalah pendekatan yang terlalu kaku

Arsitektur saat ini membagi fasilitas hanya menjadi dua mode:

KLINIK → SIMKLINIK

RUMAH_SAKIT → SIMRS

Ini tidak cukup dan berpotensi menjadi kesalahan desain jangka panjang.

Tidak semua klinik mempunyai pelayanan yang sama. Tidak semua rumah sakit mempunyai instalasi, spesialisasi, fasilitas, alur pelayanan, ataupun model bisnis yang sama.

Contoh:

FasilitasVariasi kemampuanKlinik Pratama ADokter umum dan farmasiKlinik Pratama BDokter umum, gigi, KIA, laboratoriumKlinik Utama CDokter spesialis, diagnostik, tindakan tertentu, rawat inapKlinik DPelayanan estetika atau rehabilitasi sesuai perizinanRS Umum AIGD, rawat inap, ICU, operasi, radiologiRS Khusus BFokus ibu dan anakRS Khusus CFokus kesehatan jiwa atau spesialisasi tertentuRS Umum DSebagian layanan dilakukan melalui kerja sama pihak ketiga 

Dengan arsitektur sekarang, variasi tersebut berisiko menghasilkan kondisi bercabang yang semakin banyak dan sulit dipelihara.

Koreksi wajib: Pertahankan tipe fasilitas sebagai klasifikasi, tetapi jangan jadikan tipe tersebut penentu tunggal seluruh fungsi sistem.

Gunakan arsitektur berbasis kemampuan:

KAEL CORE → FACILITY PROFILE → CAPABILITY REGISTRY → MODULE CONFIGURATION → SERVICE CATALOG → WORKFLOW ENGINE → ADAPTIVE UI

Jenis fasilitas hanya memberikan konfigurasi awal. Kemampuan sebenarnya ditentukan oleh kombinasi profil, izin, layanan aktif, sumber daya, kontrak pembiayaan, dan konfigurasi Superuser.

2. CRITICAL — Superuser Configuration Engine belum dirancang

Ini adalah kekurangan paling besar dalam keseluruhan dokumen.

Superuser bukan sekadar pengguna yang mengelola akun atau melihat laporan konsolidasi.

Superuser merupakan pengendali konfigurasi operasional KAEL.

Superuser harus mampu mengelola:

DomainKemampuan konfigurasiModulMengaktifkan dan menonaktifkan modul yang tersediaPelayananMenentukan jenis layanan setiap fasilitasUnitMembuat dan mengatur unit, ruangan, instalasi, dan subunitMenuMenentukan visibilitas, struktur, dan urutan navigasiFormulirMenambahkan field, validasi, template, dan formulir khususWorkflowMengatur tahapan pelayanan dan persetujuanSDMMenentukan jabatan, peran, unit kerja, dan kewenanganTarifMengatur tarif berdasarkan fasilitas, layanan, penjamin, dan periodeBillingMengatur paket, deposit, diskon, pembayaran, dan penagihanFarmasiMengatur gudang, depo, distribusi, batas stok, dan kebijakan persediaanDokumenMengatur kop surat, identitas fasilitas, template, dan tanda tanganDashboardMemilih indikator, widget, filter, dan laporan yang ditampilkanIntegrasiMengelola konektor serta status integrasi resmi tiap fasilitasAkuntansiMengatur COA, cost center, aturan jurnal, dan struktur laporanPerizinanMemetakan layanan terhadap izin dan persyaratan fasilitas 

Pengaturan tersebut harus dapat dilakukan melalui antarmuka administrasi yang benar-benar berfungsi, bukan sekadar toggle visual.

Setiap perubahan konfigurasi wajib memiliki validasi dependensi, audit trail, versioning, effective date, rollback, dan mekanisme publish.

Superuser harus dapat mengatur seluruh konfigurasi yang menjadi kewenangannya. Namun, pengaturan sistem tidak boleh menggantikan kewenangan klinis tenaga kesehatan atau persyaratan perizinan suatu layanan.

Contoh: Superuser dapat mengaktifkan modul operasi yang tersedia, tetapi layanan operasionalnya harus tetap memenuhi syarat perizinan, fasilitas, dan tenaga medis.

3. CRITICAL — KAEL membutuhkan Prebuilt Capability Catalog

Permintaan kustomisasi pelanggan tidak boleh selalu menyebabkan penambahan kode khusus untuk masing-masing klinik atau rumah sakit.

KAEL harus menyediakan katalog fitur siap pakai, mencakup kemampuan operasional dari berbagai tipe fasilitas kesehatan.

Contohnya, ketika pelanggan meminta layanan hemodialisis, KAEL seharusnya sudah mempunyai kemampuan modulnya apabila termasuk katalog produk yang didukung.

Superuser tinggal mengaktifkan dan mengonfigurasi modul tersebut, termasuk jadwal, ruangan, alat, staf, tarif, inventori, dan workflow yang diperlukan.

Prinsip yang sama berlaku untuk layanan dental, rehabilitasi, MCU, fisioterapi, home care, bedah, obstetri, pediatri, hemodialisis, laboratorium, radiologi, dan pelayanan spesialistik lainnya.

Katalog harus menyatakan dengan jelas status setiap fitur: tersedia dan siap pakai, tersedia tetapi memerlukan integrasi, sedang dikembangkan, atau belum tersedia.

Jangan mengklaim sebuah fitur dapat langsung diaktifkan apabila implementasinya belum ada. Permintaan yang belum tercakup katalog tetap memerlukan pengembangan, tetapi arsitektur extensibility harus meminimalkan perubahan pada core.

4. CRITICAL — Tidak ada Workflow Builder dan Dynamic Form Engine

Mengaktifkan menu tidak sama dengan mengaktifkan layanan.

Setiap layanan mempunyai alur kerja berbeda. Contoh:

Pelayanan umum:

Registrasi → Antrean → Pemeriksaan → Resep → Farmasi → Pembayaran → Selesai.

Pelayanan laboratorium:

Order → Pengambilan sampel → Pemrosesan → Validasi hasil → Publikasi hasil → Penagihan.

Pelayanan operasi:

Assessment → Persetujuan → Penjadwalan → Persiapan → Checklist → Operasi → Pemulihan → Dokumentasi → Billing.

KAEL harus mendukung workflow yang dapat dikonfigurasi melalui state machine, dengan tahapan, transisi, guard, approval, assignment, dan event yang eksplisit.

Dynamic Form Engine harus mendukung field types, conditional visibility, validation, templates, terminology mapping, dan versioning.

Konfigurasi tidak boleh menghapus atau mengubah arti data klinis historis. Form yang sudah digunakan harus tetap dapat dibaca sesuai versi ketika rekam medis dibuat.

5. HIGH — Model fasilitas dan regulasi kurang akurat

Dokumen memperlakukan Klinik sebagai FKTP dan Rumah Sakit sebagai FKRTL. Ini terlalu menyederhanakan klasifikasi.

Klinik Utama dapat menyelenggarakan pelayanan spesialistik dan merupakan salah satu bentuk fasilitas pelayanan kesehatan tingkat lanjut. Klinik juga dapat menyelenggarakan rawat inap sesuai jenis serta ketentuan perizinannya.

Permenkes Nomor 11 Tahun 2025 membedakan batas pelayanan rawat inap Klinik Utama hingga 7 hari dan Klinik Pratama hingga 5 hari, sesuai ketentuan masing-masing.

Karena itu, pisahkan atribut:

facility_type, clinic_class, hospital_class, ownership_type, care_level, licensed_services, inpatient_capability, jkn_contract, accreditation_status, dan operating_hours.

Jangan mengasumsikan semua klinik menggunakan PCare atau memperoleh kapitasi. Jangan mengasumsikan seluruh fasilitas rumah sakit mempunyai jenis layanan yang identik.

Larangan absolut penggunaan istilah Poliklinik pada seluruh klinik juga tidak tepat. Terminologi tampilan dapat disesuaikan dengan jenis layanan serta kebiasaan operasional fasilitas.

6. HIGH — Mesin kalkulasi dan indikator belum dapat dipercaya

Beberapa rumus disederhanakan secara berlebihan.

Indikator KBK: AK, RRNS, dan RPPT tidak cukup hanya diberikan formula ringkas. Definisi numerator, denominator, pengecualian, populasi eligible, periode perhitungan, serta target harus mengikuti regulasi dan ketentuan BPJS yang berlaku.

Khusus RRNS, definisi Rujukan Non-Spesialistik Tanpa TACC / Total Rujukan tidak boleh langsung dianggap sebagai formula resmi tanpa verifikasi terhadap ketentuan yang berlaku.

Angka target seperti 150‰, 2%, dan 50% tidak boleh disebarkan sebagai konstanta permanen di source code.

Indikator Rumah Sakit: BOR, ALOS, TOI, BTO, NDR, dan GDR memerlukan aturan eksplisit mengenai tempat tidur tersedia, hari perawatan, pasien keluar, kematian, periode, dan kasus pengecualian.

Akuntansi: Neraca tidak boleh dimodelkan hanya sebagai kumpulan kas, stok, hutang PBF, dan modal. Implementasikan double-entry accounting, jurnal berimbang, COA, subledger, period closing, rekonsiliasi, penyusutan, koreksi, dan jejak transaksi.

Farmasi: HNA bukan satu-satunya komponen yang diperlukan untuk menentukan nilai persediaan atau HPP. Pertimbangkan kebijakan valuasi, potongan pembelian, pajak terkait, retur, dan komponen biaya yang relevan.

Seluruh regulatory calculation harus memiliki formula versioning, effective date, sumber aturan, dan automated regression tests.

7. HIGH — Desain Triase ATS keliru

Dokumen menuliskan:

Australasian Triage Scale: Merah / Kuning / Hijau / Hitam

Ini tidak sesuai dengan struktur resmi Australasian Triage Scale, yang mempunyai lima kategori ATS 1–5.

Jika KAEL menggunakan triase warna berdasarkan protokol lokal, jangan menamainya ATS tanpa pemetaan serta dasar klinis yang benar.

Pisahkan Triase, Early Warning Score, dan eskalasi klinis.

NEWS2, MEWS, PEWS, dan sistem penilaian obstetri tidak boleh diperlakukan sebagai satu kalkulator generik dengan enam tanda vital.

Modul penilaian klinis harus mempunyai algoritma tervalidasi, batas penerapan, otorisasi klinis, dan audit perubahan.

8. HIGH — Integrasi eksternal masih diasumsikan terlalu otomatis

Dokumen menyatakan rujukan PCare langsung diterima pada VClaim dan Surat Rujukan Balik otomatis memasukkan pasien ke PRB serta Prolanis.

Jangan menyamakan integrasi data dengan persetujuan administratif atau keputusan klinis.

Bangun Referral Orchestration Engine dengan status eksplisit:

CREATED → VALIDATED → SUBMITTED → ACKNOWLEDGED → ACCEPTED/REJECTED → SCHEDULED → COMPLETED

Tambahkan eligibility checking, identity matching, consent atau dasar akses yang sah, deduplication, retry, idempotency, reconciliation, dan failure recovery.

Bedakan integrasi BPJS PCare, VClaim, antrean, e-Klaim, dan SATUSEHAT sesuai kontrak API masing-masing.

SATUSEHAT membutuhkan pemetaan Patient, Practitioner, Organization, Location, Encounter, Condition, Observation, ServiceRequest, MedicationRequest, serta resource relevan lainnya sesuai use case.

Jangan mengklaim bahwa semua rujukan, SEP, dan klaim dapat dilakukan otomatis hanya berdasarkan keberadaan konektor.

PRB dan Prolanis juga bukan satu proses identik. Masing-masing memerlukan eligibility dan workflow tersendiri.

Pada 2026 telah terdapat pelaksanaan uji coba iDRG, sehingga Claim Engine harus mendukung perubahan skema tarif berdasarkan periode dan kebijakan yang benar-benar berlaku, bukan mengasumsikan INA-CBG berlaku tanpa perubahan selamanya.

9. CRITICAL — Multi-Tenancy, data isolation, dan ownership belum didefinisikan

Konsolidasi Owner tidak sama dengan akses bebas antarsemua fasilitas.

KAEL membutuhkan model organisasi yang jelas:

Platform → Tenant/Owner Group → Legal Entity → Facility → Unit → Service → Encounter

Pisahkan identitas pasien, nomor rekam medis lokal, identitas SATUSEHAT, serta data hubungan pasien dengan fasilitas.

Satu pasien dapat berobat di beberapa fasilitas tanpa menyebabkan data seluruh tenant terbuka kepada tenant lainnya.

Akses lintas fasilitas harus memiliki dasar kewenangan dan tujuan yang jelas.

Implementasikan RBAC bersama pemeriksaan berbasis atribut dan konteks, server-side authorization, tenant scoping pada query, audit akses rekam medis, dan pembatasan akses data sensitif.

Admin platform, Superuser tenant, admin fasilitas, dokter, perawat, farmasi, kasir, HRD, dan akuntansi memerlukan batas kewenangan berbeda.

Pengguna dengan satu akun dapat memiliki peran berbeda pada fasilitas berbeda.

10. CRITICAL — Clinical Data Integrity dan keselamatan operasional belum cukup

Rencana belum mendefinisikan invariant penting pada RME, farmasi, serta billing.

Rekam medis yang sudah disahkan tidak boleh diubah secara diam-diam. Koreksi harus mengikuti kewenangan, tenggat, prosedur, dan audit sesuai ketentuan berlaku.

Resep harus mempunyai status yang jelas. Obat tidak boleh terpotong ganda ketika request diulang. Stok tidak boleh berubah tanpa transaksi atau alasan koreksi yang tercatat.

Konfigurasi Superuser tidak boleh menghapus encounter, transaksi, atau rekam medis historis ketika suatu modul dinonaktifkan.

Modul yang sedang mempunyai transaksi aktif harus menerapkan validasi sebelum perubahan konfigurasi dipublikasikan.

Dokumen juga harus mencakup alergi, medication reconciliation, critical laboratory results, informed consent, clinical sign-off, serta identifikasi pasien yang konsisten.

Permenkes 24/2022 perlu menjadi acuan kontrol RME, termasuk kewenangan perbaikan data dan retensi rekam medis elektronik.

11. HIGH — Belum ada rancangan production untuk Server dan Desktop Client

Rencana ini membahas UI dan modul, tetapi belum menjelaskan source of truth, kontrak API, reliabilitas transaksi, dan sinkronisasi.

Server harus menjadi sumber kebenaran utama untuk konfigurasi, otorisasi, transaksi, rekam medis, inventori, serta data finansial.

Desktop Client harus memakai kontrak layanan yang konsisten dan tidak membuat logika bisnis independen yang dapat menghasilkan perbedaan data.

Tentukan strategi online/offline, terutama pada fasilitas dengan koneksi tidak stabil.

Jika offline operation didukung, wajib ada local encrypted store, durable queue, conflict policy, idempotency, reconciliation, dan status sinkronisasi yang terlihat pengguna.

Tidak boleh ada klaim sukses transaksi eksternal ketika koneksi belum mengirim dan menerima konfirmasi yang sah.

Tambahkan backup dan restore teruji, disaster recovery, monitoring, structured logging tanpa kebocoran data pasien, health checks, serta deployment rollback.

12. HIGH — Enterprise ERP dan pelayanan end-to-end masih belum lengkap

Daftar modul saat ini luas, tetapi tidak membuktikan bahwa alur transaksi antar-modul telah selesai.

KAEL harus menjamin rangkaian operasional:

Pendaftaran → Pelayanan → Order → Pelaksanaan → Hasil → Resep → Dispensing → Billing → Pembayaran/Klaim → Jurnal → Laporan.

Setiap transaksi perlu memiliki identitas, status, pemilik, waktu, dan hubungan ke transaksi lain yang dapat ditelusuri.

Tambahkan dukungan yang dapat dikonfigurasi untuk appointment dan antrean, tarif multi-penjamin, paket layanan, deposit, refund, retur farmasi, purchase-to-pay, inventory transfer, inventory adjustment, pengadaan aset, payroll, serta audit accounting.

Laporan regulasi juga tidak boleh disamaratakan. LB1–LB4 dan RL1–RL5 perlu diverifikasi terhadap kewajiban, format, periode, dan kanal pelaporan yang berlaku untuk jenis fasilitas tertentu.

Laporan tidak cukup hanya bisa diekspor. Data harus tervalidasi, lengkap, dapat ditelusuri ke transaksi sumber, dan mempunyai mekanisme submission serta reconciliation bila integrasi resmi mendukungnya.

13. REQUIRED — Acceptance criteria yang dapat diuji

Rancangan tidak boleh dianggap production-ready tanpa pengujian nyata berikut:

Superuser membuat dua klinik dengan konfigurasi pelayanan berbeda. Keduanya menggunakan core yang sama tanpa perubahan kode khusus per klinik.

Superuser mengaktifkan pelayanan spesialistik pada Klinik Utama yang memenuhi syarat. Menu, jadwal, tenaga medis, tarif, form, workflow, billing, dan laporan otomatis menggunakan konfigurasi yang sesuai.

Superuser menonaktifkan suatu modul. Transaksi historis tetap aman, pengguna tidak kehilangan akses sah terhadap dokumen historis, dan tidak ada kerusakan referential integrity.

Dua rumah sakit mempunyai layanan, tarif, penjamin, workflow, dan instalasi yang berbeda tanpa saling memengaruhi.

Satu Owner mengelola beberapa fasilitas. Laporan konsolidasi hanya mengambil fasilitas dalam scope kepemilikannya dan eliminasi transaksi antarfasilitas ditangani apabila diperlukan untuk konsolidasi akuntansi.

Satu pasien berobat pada dua fasilitas. Nomor RM lokal, identitas pasien, otorisasi, dan pertukaran data klinis tetap konsisten tanpa kebocoran antar-tenant.

Integrasi eksternal mengalami timeout, response duplikat, dan kegagalan sementara. Sistem tidak menggandakan SEP, resep, stok, tagihan, maupun jurnal.

Satu tindakan medis menghasilkan order, penggunaan BMHP, biaya, tagihan, pembayaran, dan jurnal yang dapat direkonsiliasi secara end-to-end.

Konfigurasi diperbarui ketika transaksi sedang berlangsung. Transaksi yang sudah dibuat tetap menggunakan versi konfigurasi yang benar.

Server dan Desktop Client diuji menggunakan transaksi nyata, termasuk restart, kehilangan koneksi, retry, dan pemulihan layanan.

Hasil uji harus menghasilkan bukti eksekusi aktual. Jangan menggunakan dummy success, mock verdict, atau UI yang tampak berhasil padahal backend belum menyimpan transaksi.

14. REQUIRED — Perbaiki implementation plan, bukan hanya menambah menu

Sebelum mengubah source code, lakukan audit menyeluruh terhadap arsitektur dan implementasi KAEL yang sudah tersedia.

Identifikasi komponen yang benar-benar berfungsi, komponen parsial, hardcoded behavior, missing dependencies, dan titik integrasi.

Susun ulang implementation plan berdasarkan hasil pemeriksaan tersebut.

Hasil revisi harus memuat:

DeliverablePersyaratanArchitecture specificationDomain boundaries, dependencies, data ownership, dan runtimeCapability catalogDaftar seluruh fitur, status implementasi, dependencies, dan scope konfigurasiSuperuser specificationConfiguration UI, permissions, policies, publish, rollbackFacility modelKlasifikasi fasilitas, izin, kemampuan, dan struktur unitData modelERD, tenant isolation, constraints, dan versi konfigurasiWorkflow specificationState machine dan proses end-to-endAPI/event contractsRequest, response, errors, idempotency, dan external adapterCompliance mappingKetentuan regulasi yang berlaku dan sumber masing-masing aturanImplementation gap matrixExisting / Missing / Incomplete / Incorrect / VerifiedTest evidenceHasil build, integration test, E2E test, dan defect yang tersisa 

Jangan melakukan rewrite besar tanpa memahami dependensi dari source yang sudah ada. Pertahankan bagian yang benar-benar berfungsi, lalu refactor secara terarah dengan pengujian regresi.

Jangan menganggap aplikasi sudah production-ready hanya karena seluruh menu dapat dibuka dan halaman terlihat lengkap.

15. FINAL ARCHITECTURAL DIRECTIVE

Prinsip final KAEL adalah:

ONE CORE, MANY FACILITIES, DIFFERENT CAPABILITIES, CONFIGURABLE WORKFLOWS, ONE INTEGRATED ERP.

Superuser harus mampu menentukan bagaimana fasilitas menggunakan KAEL, bukan dipaksa mengikuti struktur menu dan workflow hardcoded dari developer.

Tipe fasilitas memberikan baseline konfigurasi, bukan pembatas absolut.

Setiap pelayanan yang telah tersedia dalam Capability Catalog harus dapat diaktifkan, dikonfigurasi, dan dioperasikan melalui sistem tanpa penulisan source code khusus untuk pelanggan tersebut.

Perubahan konfigurasi tidak boleh menyebabkan inkonsistensi data, kerusakan transaksi, pelanggaran aturan klinis, atau gangguan fasilitas lain.

Prioritas P0: Capability Registry, Superuser Configuration Engine, facility classification, tenant isolation, workflow foundation, data integrity, dan clinical authorization.

Prioritas P1: Integrasi layanan end-to-end, regulatory calculation engine, billing–inventory–accounting integration, interoperability, serta E2E testing.

Prioritas P2: Penyempurnaan dashboard, visualisasi, kosmetik UI, dan variasi tampilan yang tidak memengaruhi operasional inti.

Jadikan ini sebagai koreksi terhadap fondasi arsitektur yang sudah direncanakan. Tujuannya bukan membuat daftar fitur yang semakin panjang, tetapi memastikan seluruh kemampuan tersebut bekerja sebagai satu sistem yang dapat dikonfigurasi oleh Superuser.

Jangan mulai dengan mengganti sidebar. Mulai dari memperbaiki domain model dan mesin konfigurasi yang menentukan seluruh perilaku KAEL.

Referensi resmi untuk verifikasi

https://jdih.kemkes.go.id/documents/peraturan-menteri-kesehatan-nomor-11-tahun-2025

https://jdih.kemkes.go.id/documents/peraturan-menteri-kesehatan-nomor-24-tahun-2022

https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/

https://acem.org.au/Content-Sources/Advancing-Emergency-Medicine/Better-Outcomes-for-Patients/Triage

https://keslan.kemkes.go.id/read/3206/pertemuan-pembahasan-petunjuk-teknis-pelaporan-sirs-online-2025-dan-uji-coba-bridging-data

