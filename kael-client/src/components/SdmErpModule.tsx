import React, { useState } from 'react';
import { CalendarCheck, Clock, Wallet } from 'lucide-react';
import { Facility, UserAccount } from '../domain/simrs.ts';
import { formatRupiah, toLocalDateKey } from '../domain/clinicalLogic.ts';
import { kaelApi, WorkspacePayload } from '../utils/apiClient.ts';

interface SdmErpModuleProps {
  activeFacility: Facility;
  currentUser: UserAccount;
  allUsers: UserAccount[];
  token: string;
  facilityCode: string;
  workspace: WorkspacePayload;
  onRefreshWorkspace: () => Promise<void>;
  initialView?: 'SDM_JADWAL' | 'SDM_ERP';
}

type SdmTab = 'ABSENSI' | 'CUTI' | 'PENGGAJIAN';

export function SdmErpModule({
  activeFacility,
  currentUser,
  allUsers,
  token,
  facilityCode,
  workspace,
  onRefreshWorkspace,
  initialView = 'SDM_ERP',
}: SdmErpModuleProps) {
  const [activeTab, setActiveTab] = useState<SdmTab>(
    initialView === 'SDM_JADWAL' ? 'ABSENSI' : 'PENGGAJIAN'
  );
  const [staffName, setStaffName] = useState(currentUser.fullName);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => toLocalDateKey());
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');

  const tabs: { key: SdmTab; label: string; icon: typeof Clock }[] = [
    { key: 'ABSENSI', label: 'Absensi & shift', icon: Clock },
    { key: 'CUTI', label: 'Cuti & izin', icon: CalendarCheck },
    { key: 'PENGGAJIAN', label: 'Penggajian', icon: Wallet },
  ];
  const kind = activeTab === 'ABSENSI' ? 'attendance' : activeTab === 'CUTI' ? 'leave' : 'payroll';
  const rows = kind === 'attendance' ? workspace.attendance : kind === 'leave' ? workspace.leaveRequests : workspace.payrollRuns;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    try {
      await kaelApi.recordStaff(token, facilityCode, kind, {
        staffName: staffName.trim(),
        note: note.trim(),
        date,
        amount: Number(amount || 0),
      });
      setNote('');
      setAmount('');
      await onRefreshWorkspace();
      setMessage('Catatan tersimpan.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Catatan belum tersimpan.');
    }
  };

  return (
    <div className="min-w-0 space-y-3">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-[#0F2922] dark:text-white tracking-tight mt-0.5">
          SDM &amp; Kepegawaian
        </h1>
        <p className="text-xs text-[#52736B] dark:text-[#86B5A9] mt-1">
          Catatan kehadiran, cuti, dan penggajian untuk {activeFacility.name}.
        </p>
        <datalist id="sdm-staff">
          {allUsers.map((user) => <option key={user.id} value={user.fullName} />)}
        </datalist>
      </div>

      <div className="flex flex-wrap items-center gap-2 min-w-0" role="tablist" aria-label="Layanan SDM">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            id={`sdm-tab-${key}`}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            aria-controls={`sdm-panel-${key}`}
            onClick={() => { setActiveTab(key); setMessage(''); }}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === key
                ? 'bg-[#00897B] text-white'
                : 'bg-white dark:bg-[#0B211D] border border-[#D5E3DF] dark:border-[#1E473F] text-[#0F2922] dark:text-white hover:bg-[#EBF4F1] dark:hover:bg-[#11302A]'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <section
        id={`sdm-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`sdm-tab-${activeTab}`}
        className="rounded-2xl border border-[#E2ECE8] dark:border-[#183831] bg-white dark:bg-[#0B211D] p-4 space-y-3"
      >
        {activeTab === 'ABSENSI' && <StaffForm title="Catat kehadiran" staffName={staffName} setStaffName={setStaffName} note={note} setNote={setNote} date={date} setDate={setDate} amount={amount} setAmount={setAmount} showAmount={false} onSubmit={save} message={message} />}
        {activeTab === 'CUTI' && <StaffForm title="Catat cuti atau izin" staffName={staffName} setStaffName={setStaffName} note={note} setNote={setNote} date={date} setDate={setDate} amount={amount} setAmount={setAmount} showAmount={false} onSubmit={save} message={message} />}
        {activeTab === 'PENGGAJIAN' && <StaffForm title="Catat komponen gaji" staffName={staffName} setStaffName={setStaffName} note={note} setNote={setNote} date={date} setDate={setDate} amount={amount} setAmount={setAmount} showAmount onSubmit={save} message={message} />}
        <ul className="space-y-1 text-xs text-[#52736B] dark:text-[#86B5A9]">
          {(rows || []).slice(0, 20).map((row) => <li key={row.id}>{row.date || row.createdAt.slice(0, 10)} · {row.staffName}{row.note ? ` · ${row.note}` : ''}{row.amount ? ` · ${formatRupiah(row.amount)}` : ''}</li>)}
          {(rows || []).length === 0 && <li>Belum ada catatan pada tab ini.</li>}
        </ul>
      </section>
    </div>
  );
}

function StaffForm(props: {
  title: string;
  staffName: string;
  setStaffName: (value: string) => void;
  note: string;
  setNote: (value: string) => void;
  date: string;
  setDate: (value: string) => void;
  amount: string;
  setAmount: (value: string) => void;
  showAmount: boolean;
  onSubmit: (event: React.FormEvent) => void;
  message: string;
}) {
  return (
    <form onSubmit={props.onSubmit} className="space-y-2">
      <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">{props.title}</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        <input required value={props.staffName} onChange={(event) => props.setStaffName(event.target.value)} placeholder="Nama pegawai" list="sdm-staff" className="rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714] text-[#0F2922] dark:text-white px-3 py-2 text-xs" />
        <input type="date" required value={props.date} onChange={(event) => props.setDate(event.target.value)} className="rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714] text-[#0F2922] dark:text-white px-3 py-2 text-xs" />
        <input value={props.note} onChange={(event) => props.setNote(event.target.value)} placeholder="Catatan" className="rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714] text-[#0F2922] dark:text-white px-3 py-2 text-xs sm:col-span-2" />
        {props.showAmount && <input type="number" min={0} step="any" value={props.amount} onChange={(event) => props.setAmount(event.target.value)} placeholder="Nominal rupiah" className="rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714] text-[#0F2922] dark:text-white px-3 py-2 text-xs font-mono" />}
      </div>
      <button type="submit" className="rounded-xl bg-[#00897B] hover:bg-[#00796B] px-4 py-2 text-xs font-semibold text-white cursor-pointer">Simpan</button>
      {props.message && <p className="text-xs text-[#00897B] dark:text-[#4DB6AC]">{props.message}</p>}
    </form>
  );
}
