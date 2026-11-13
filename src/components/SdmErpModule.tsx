import React, { useMemo, useState } from 'react';
import {
  Users,
  Clock,
  CalendarCheck,
  Wallet,
  CheckCircle2,
  Plus,
  X,
  BadgeCheck,
} from 'lucide-react';
import { Facility, UserAccount } from '../types/simrs';
import { formatRupiah, ROLE_LABELS } from '../utils/clinicalLogic';
import { kaelApi } from '../utils/apiClient';
import { DataExportToolbar } from './DataExportToolbar';
import { ExportColumn } from '../utils/exportDocument';

interface SdmErpModuleProps {
  token: string;
  activeFacility: Facility;
  currentUser: UserAccount;
  allUsers: UserAccount[];
  initialView?: 'SDM_JADWAL' | 'SDM_ERP';
  onRefreshWorkspace: () => Promise<void>;
}

interface AttendanceRecord {
  id: string;
  userId: string;
  fullName: string;
  roleLabel: string;
  nipOrSip: string;
  shift: 'SHIFT_PAGI · 07:00-14:00' | 'SHIFT_SORE · 14:00-21:00' | 'SHIFT_MALAM · 21:00-07:00';
  date: string;
  checkIn: string;
  checkOut: string;
  status: 'HADIR_TEPAT_WAKTU' | 'DINAS_LUAR' | 'CUTI_RESMI';
}

interface LeaveRequest {
  id: string;
  fullName: string;
  roleLabel: string;
  leaveType: 'CUTI_TAHUNAN' | 'IZIN_SAKIT' | 'TUGAS_SEMINAR_MEDIS';
  startDate: string;
  endDate: string;
  reason: string;
  status: 'DISETUJUI' | 'MENUNGGU_APPROVAL';
}

export function SdmErpModule({
  token,
  activeFacility,
  currentUser,
  allUsers,
  initialView = 'SDM_ERP',
  onRefreshWorkspace,
}: SdmErpModuleProps) {
  const [activeTab, setActiveTab] = useState<'ABSENSI' | 'CUTI' | 'PENGGAJIAN'>(
    initialView === 'SDM_JADWAL' ? 'ABSENSI' : 'PENGGAJIAN'
  );
  const [selectedShift, setSelectedShift] = useState<AttendanceRecord['shift']>(
    'SHIFT_PAGI · 07:00-14:00'
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submittingPayroll, setSubmittingPayroll] = useState<string | null>(null);

  const facilityStaff = useMemo(() => {
    const list = allUsers.filter(
      (u) =>
        u.allowedFacilities.includes('*') ||
        u.allowedFacilities.includes(activeFacility.code)
    );
    return list.length > 0 ? list : [currentUser];
  }, [allUsers, activeFacility.code, currentUser]);

  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceRecord[]>(() =>
    facilityStaff.map((u, idx) => ({
      id: `att-${u.id}`,
      userId: u.id,
      fullName: u.fullName,
      roleLabel: ROLE_LABELS[u.role] || u.role,
      nipOrSip: u.nipOrSip,
      shift:
        idx % 3 === 0
          ? 'SHIFT_PAGI · 07:00-14:00'
          : idx % 3 === 1
          ? 'SHIFT_SORE · 14:00-21:00'
          : 'SHIFT_PAGI · 07:00-14:00',
      date: '2026-11-11',
      checkIn: `06:${48 + (idx % 10)}`,
      checkOut: idx % 2 === 0 ? '14:05' : 'Sedang bertugas',
      status: 'HADIR_TEPAT_WAKTU',
    }))
  );

  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([
    {
      id: 'lv-1',
      fullName: 'Ns. Siti Rahmawati, S.Kep',
      roleLabel: 'Perawat Klinis Ners',
      leaveType: 'CUTI_TAHUNAN',
      startDate: '2026-11-18',
      endDate: '2026-11-20',
      reason: 'Cuti keluarga terjadwal',
      status: 'DISETUJUI',
    },
    {
      id: 'lv-2',
      fullName: 'Bdn. Fitri Handayani, S.Tr.Keb',
      roleLabel: 'Bidan KIA & Maternitas',
      leaveType: 'TUGAS_SEMINAR_MEDIS',
      startDate: '2026-11-22',
      endDate: '2026-11-23',
      reason: 'Pelatihan Pembaruan ANC Terpadu & USG Dasar Kemenkes',
      status: 'MENUNGGU_APPROVAL',
    },
  ]);

  const [newLeaveReason, setNewLeaveReason] = useState('');
  const [newLeaveType, setNewLeaveType] =
    useState<LeaveRequest['leaveType']>('CUTI_TAHUNAN');
  const [newLeaveStart, setNewLeaveStart] = useState('2026-11-25');
  const [newLeaveEnd, setNewLeaveEnd] = useState('2026-11-26');

  const payrollRows = useMemo(() => {
    return facilityStaff.map((u) => {
      const baseSalary =
        u.role === 'DOKTER' || u.role === 'DOKTER_GIGI'
          ? 12500000
          : u.role === 'MANAJER_KLINIK' || u.role === 'OWNER' || u.role === 'SUPERUSER'
          ? 14000000
          : u.role === 'APOTEKER'
          ? 7800000
          : u.role === 'PERAWAT' || u.role === 'BIDAN'
          ? 6400000
          : 5600000;
      const medicalIncentive =
        u.role === 'DOKTER' || u.role === 'DOKTER_GIGI'
          ? 4250000
          : u.role === 'PERAWAT' || u.role === 'BIDAN'
          ? 1450000
          : 850000;
      return {
        id: u.id,
        fullName: u.fullName,
        nipOrSip: u.nipOrSip,
        roleLabel: ROLE_LABELS[u.role] || u.role,
        baseSalary,
        medicalIncentive,
        takeHomePay: baseSalary + medicalIncentive,
      };
    });
  }, [facilityStaff]);

  const handleClockIn = () => {
    const nowTime = new Date().toTimeString().slice(0, 5);
    const todayStr = new Date().toISOString().slice(0, 10);
    const entry: AttendanceRecord = {
      id: `att-${Date.now()}`,
      userId: currentUser.id,
      fullName: currentUser.fullName,
      roleLabel: ROLE_LABELS[currentUser.role] || currentUser.role,
      nipOrSip: currentUser.nipOrSip,
      shift: selectedShift,
      date: todayStr,
      checkIn: nowTime,
      checkOut: 'Sedang bertugas',
      status: 'HADIR_TEPAT_WAKTU',
    };
    setAttendanceLogs((prev) => [entry, ...prev]);
    setFeedback(`Presensi masuk untuk ${currentUser.fullName} (${selectedShift}) tercatat pukul ${nowTime}.`);
  };

  const handleSubmitLeave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeaveReason.trim()) return;
    const item: LeaveRequest = {
      id: `lv-${Date.now()}`,
      fullName: currentUser.fullName,
      roleLabel: ROLE_LABELS[currentUser.role] || currentUser.role,
      leaveType: newLeaveType,
      startDate: newLeaveStart,
      endDate: newLeaveEnd,
      reason: newLeaveReason.trim(),
      status: 'MENUNGGU_APPROVAL',
    };
    setLeaveRequests((prev) => [item, ...prev]);
    setNewLeaveReason('');
    setFeedback(`Pengajuan cuti/izin atas nama ${currentUser.fullName} berhasil diajukan.`);
  };

  const handleDisbursePayroll = async (staff: (typeof payrollRows)[number]) => {
    setSubmittingPayroll(staff.id);
    try {
      await kaelApi.createAccountingEntry(token, activeFacility.code, {
        accountCode: '5-2100',
        accountName: 'Beban Gaji & Tunjangan SDM Nakes',
        type: 'PENGELUARAN',
        category: 'GAJI_SDM',
        description: `Pembayaran Gaji & Insentif Medis: ${staff.fullName} (${staff.roleLabel})`,
        amount: staff.takeHomePay,
      });
      await onRefreshWorkspace();
      setFeedback(
        `Slip gaji ${staff.fullName} sebesar ${formatRupiah(
          staff.takeHomePay
        )} berhasil dicairkan dan otomatis tercatat di Jurnal ERP Keuangan.`
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal mencairkan gaji.');
    } finally {
      setSubmittingPayroll(null);
    }
  };

  const attendanceColumns: ExportColumn<AttendanceRecord>[] = [
    { key: 'fullName', header: 'Nama Pegawai / Nakes' },
    { key: 'roleLabel', header: 'Jabatan / Profesi' },
    { key: 'nipOrSip', header: 'NIP / SIP / STR' },
    { key: 'shift', header: 'Shift Kerja' },
    { key: 'date', header: 'Tanggal' },
    { key: 'checkIn', header: 'Jam Masuk' },
    { key: 'checkOut', header: 'Jam Pulang' },
    { key: 'status', header: 'Status Kehadiran' },
  ];

  const payrollColumns: ExportColumn<(typeof payrollRows)[number]>[] = [
    { key: 'fullName', header: 'Nama Pegawai / Nakes' },
    { key: 'roleLabel', header: 'Profesi / Jabatan' },
    { key: 'nipOrSip', header: 'NIP / SIP' },
    { key: 'baseSalary', header: 'Gaji Pokok (IDR)', format: (r) => r.baseSalary },
    {
      key: 'medicalIncentive',
      header: 'Jasa Medis / Tunjangan',
      format: (r) => r.medicalIncentive,
    },
    { key: 'takeHomePay', header: 'Total Take Home Pay (IDR)', format: (r) => r.takeHomePay },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#52736B] dark:text-[#86B5A9]">
            SDM &amp; KEPEGAWAIAN NAKES • {activeFacility.name}
          </p>
          <h1 className="text-2xl font-bold text-[#0F2922] dark:text-white tracking-tight mt-0.5">
            {initialView === 'SDM_JADWAL'
              ? 'Jadwal Shift, SIP/STR & Kredensial Nakes'
              : 'Absensi, Cuti & Penggajian SDM'}
          </h1>
          <p className="text-xs text-[#52736B] dark:text-[#86B5A9] mt-0.5">
            Kelola jadwal shift dokter, perawat, bidan, apoteker, validitas SIP/STR, serta pencairan gaji terintegrasi jurnal kas.
          </p>
        </div>
      </div>

      {feedback && (
        <div className="p-3.5 rounded-xl bg-[#E6F4F1] dark:bg-[#0F3D35] border border-[#B2DFDB] dark:border-[#1E564B] text-[#00695C] dark:text-[#80CBC4] text-xs font-medium flex items-center justify-between">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Navigation Pills matching Reference UI */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('ABSENSI')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'ABSENSI'
              ? 'bg-[#00897B] text-white'
              : 'bg-white dark:bg-[#0B211D] border border-[#D5E3DF] dark:border-[#1E473F] text-[#0F2922] dark:text-white hover:bg-[#EBF4F1]'
          }`}
        >
          Absensi saya &amp; shift tim ({attendanceLogs.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('CUTI')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'CUTI'
              ? 'bg-[#00897B] text-white'
              : 'bg-white dark:bg-[#0B211D] border border-[#D5E3DF] dark:border-[#1E473F] text-[#0F2922] dark:text-white hover:bg-[#EBF4F1]'
          }`}
        >
          Cuti &amp; izin ({leaveRequests.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('PENGGAJIAN')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'PENGGAJIAN'
              ? 'bg-[#00897B] text-white'
              : 'bg-white dark:bg-[#0B211D] border border-[#D5E3DF] dark:border-[#1E473F] text-[#0F2922] dark:text-white hover:bg-[#EBF4F1]'
          }`}
        >
          Penggajian &amp; slip nakes ({payrollRows.length})
        </button>
      </div>

      {activeTab === 'ABSENSI' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-[#0F2922] dark:text-white">
                Rekam Presensi Shift Hari Ini — {currentUser.fullName}
              </h3>
              <p className="text-xs text-[#52736B] dark:text-[#86B5A9]">
                Peran aktif: {ROLE_LABELS[currentUser.role]} • NIP/SIP: {currentUser.nipOrSip}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Pilih Shift Kerja"
                value={selectedShift}
                onChange={(e) =>
                  setSelectedShift(e.target.value as AttendanceRecord['shift'])
                }
                className="px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714] text-xs"
              >
                <option value="SHIFT_PAGI · 07:00-14:00">Shift Pagi · 07:00 - 14:00</option>
                <option value="SHIFT_SORE · 14:00-21:00">Shift Sore · 14:00 - 21:00</option>
                <option value="SHIFT_MALAM · 21:00-07:00">Shift Malam · 21:00 - 07:00</option>
              </select>
              <button
                type="button"
                onClick={handleClockIn}
                className="px-4 py-2 rounded-xl bg-[#00897B] hover:bg-[#00796B] text-white text-xs font-semibold"
              >
                Catat Kehadiran Sekarang
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E2ECE8] dark:border-[#183831] bg-[#F8FBFA] dark:bg-[#081916] flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-[#0F2922] dark:text-white">
                Daftar Kehadiran &amp; Shift Pegawai ({attendanceLogs.length})
              </span>
              <DataExportToolbar
                title="Rekapitulasi Absensi & Shift Pegawai"
                filenameBase={`KAEL_SDM_Absensi_${activeFacility.code}`}
                facilityName={activeFacility.name}
                facilityCode={activeFacility.code}
                columns={attendanceColumns}
                rows={attendanceLogs}
                compact
                contextLabel="Ekspor Absensi"
              />
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#EAF3F0] dark:bg-[#0F2D27] text-[#52736B] dark:text-[#86B5A9] border-b border-[#E2ECE8] dark:border-[#183831]">
                  <th className="py-3 px-4 font-semibold">Nama Tenaga Kesehatan / Staf</th>
                  <th className="py-3 px-4 font-semibold">Profesi / Jabatan</th>
                  <th className="py-3 px-4 font-semibold">Shift Kerja</th>
                  <th className="py-3 px-4 font-semibold">Tanggal</th>
                  <th className="py-3 px-4 font-semibold">Jam Masuk</th>
                  <th className="py-3 px-4 font-semibold">Jam Pulang</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2ECE8] dark:divide-[#183831]">
                {attendanceLogs.map((att) => (
                  <tr key={att.id} className="hover:bg-[#F3F8F6] dark:hover:bg-[#0F2B25]">
                    <td className="py-3 px-4 font-semibold text-[#0F2922] dark:text-white">
                      {att.fullName}
                      <div className="font-mono text-[11px] font-normal text-[#52736B]">
                        {att.nipOrSip}
                      </div>
                    </td>
                    <td className="py-3 px-4">{att.roleLabel}</td>
                    <td className="py-3 px-4 font-mono text-[11px]">{att.shift}</td>
                    <td className="py-3 px-4 font-mono">{att.date}</td>
                    <td className="py-3 px-4 font-mono text-[#00897B] font-semibold">
                      {att.checkIn}
                    </td>
                    <td className="py-3 px-4 font-mono">{att.checkOut}</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-[#E6F4F1] dark:bg-[#133830] text-[#00796B] dark:text-[#4DB6AC] text-[11px] font-semibold">
                        <BadgeCheck className="w-3.5 h-3.5" />
                        {att.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'CUTI' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <form
            onSubmit={handleSubmitLeave}
            className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-5 space-y-3.5 text-xs"
          >
            <h3 className="text-sm font-bold text-[#0F2922] dark:text-white">
              Ajukan Cuti / Izin Baru
            </h3>
            <div>
              <label className="block font-semibold mb-1">Jenis Cuti / Izin</label>
              <select
                value={newLeaveType}
                onChange={(e) =>
                  setNewLeaveType(e.target.value as LeaveRequest['leaveType'])
                }
                className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              >
                <option value="CUTI_TAHUNAN">Cuti Tahunan</option>
                <option value="IZIN_SAKIT">Izin Sakit</option>
                <option value="TUGAS_SEMINAR_MEDIS">Tugas Pelatihan / Seminar Medis</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-semibold mb-1">Mulai Tanggal</label>
                <input
                  type="date"
                  value={newLeaveStart}
                  onChange={(e) => setNewLeaveStart(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Sampai Tanggal</label>
                <input
                  type="date"
                  value={newLeaveEnd}
                  onChange={(e) => setNewLeaveEnd(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Keterangan &amp; Pendelegasian Shift</label>
              <input
                type="text"
                required
                value={newLeaveReason}
                onChange={(e) => setNewLeaveReason(e.target.value)}
                placeholder="Contoh: Digantikan oleh perawat shift sore..."
                className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 rounded-xl bg-[#00897B] hover:bg-[#00796B] text-white font-semibold"
            >
              Kirim Permohonan Cuti
            </button>
          </form>

          <div className="lg:col-span-2 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#EAF3F0] dark:bg-[#0F2D27] text-[#52736B] dark:text-[#86B5A9] border-b border-[#E2ECE8] dark:border-[#183831]">
                  <th className="py-3 px-4 font-semibold">Pegawai / Nakes</th>
                  <th className="py-3 px-4 font-semibold">Jenis</th>
                  <th className="py-3 px-4 font-semibold">Periode</th>
                  <th className="py-3 px-4 font-semibold">Alasan</th>
                  <th className="py-3 px-4 font-semibold text-right">Status Approval</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2ECE8] dark:divide-[#183831]">
                {leaveRequests.map((lv) => (
                  <tr key={lv.id}>
                    <td className="py-3 px-4 font-semibold text-[#0F2922] dark:text-white">
                      {lv.fullName}
                      <div className="text-[11px] font-normal text-[#52736B]">{lv.roleLabel}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px]">{lv.leaveType}</td>
                    <td className="py-3 px-4 font-mono text-[11px]">
                      {lv.startDate} s/d {lv.endDate}
                    </td>
                    <td className="py-3 px-4">{lv.reason}</td>
                    <td className="py-3 px-4 text-right">
                      {lv.status === 'DISETUJUI' ? (
                        <span className="px-2.5 py-1 rounded-md bg-[#E6F4F1] text-[#00796B] font-semibold text-[11px]">
                          DISETUJUI
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setLeaveRequests((prev) =>
                              prev.map((item) =>
                                item.id === lv.id ? { ...item, status: 'DISETUJUI' } : item
                              )
                            )
                          }
                          className="px-2.5 py-1 rounded-md bg-[#00897B] text-white font-semibold text-[11px]"
                        >
                          Setujui Cuti
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'PENGGAJIAN' && (
        <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E2ECE8] dark:border-[#183831] bg-[#F8FBFA] dark:bg-[#081916] flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#0F2922] dark:text-white">
              Daftar Penggajian &amp; Insentif Tenaga Kesehatan ({payrollRows.length})
            </span>
            <DataExportToolbar
              title="Daftar Penggajian & Insentif Nakes"
              filenameBase={`KAEL_SDM_Penggajian_${activeFacility.code}`}
              facilityName={activeFacility.name}
              facilityCode={activeFacility.code}
              columns={payrollColumns}
              rows={payrollRows}
              compact
              contextLabel="Ekspor Slip Gaji"
            />
          </div>
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#EAF3F0] dark:bg-[#0F2D27] text-[#52736B] dark:text-[#86B5A9] border-b border-[#E2ECE8] dark:border-[#183831]">
                <th className="py-3 px-4 font-semibold">Nama Nakes / Pegawai</th>
                <th className="py-3 px-4 font-semibold">Peran &amp; Jabatan</th>
                <th className="py-3 px-4 font-semibold text-right">Gaji Pokok</th>
                <th className="py-3 px-4 font-semibold text-right">Insentif / Jasa Medis</th>
                <th className="py-3 px-4 font-semibold text-right">Total Take Home Pay</th>
                <th className="py-3 px-4 font-semibold text-right">Pencairan Kas ERP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2ECE8] dark:divide-[#183831]">
              {payrollRows.map((row) => (
                <tr key={row.id} className="hover:bg-[#F3F8F6] dark:hover:bg-[#0F2B25]">
                  <td className="py-3 px-4 font-semibold text-[#0F2922] dark:text-white">
                    {row.fullName}
                    <div className="font-mono text-[11px] font-normal text-[#52736B]">
                      {row.nipOrSip}
                    </div>
                  </td>
                  <td className="py-3 px-4">{row.roleLabel}</td>
                  <td className="py-3 px-4 text-right font-mono">
                    {formatRupiah(row.baseSalary)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-[#00897B]">
                    {formatRupiah(row.medicalIncentive)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-[#0F2922] dark:text-white">
                    {formatRupiah(row.takeHomePay)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      disabled={submittingPayroll === row.id}
                      onClick={() => handleDisbursePayroll(row)}
                      className="px-3 py-1.5 rounded-lg bg-[#00897B] hover:bg-[#00796B] text-white text-[11px] font-semibold transition-colors"
                    >
                      {submittingPayroll === row.id
                        ? 'Memposting...'
                        : 'Cairkan & Posting Jurnal'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
