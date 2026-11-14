import { normalizeServerOrigin } from './serverConnection';
import { normalizeFacilityCode } from '../domain/clinicalLogic';

const STORAGE_KEY = 'kael_facility_profiles';

export interface FacilityProfile {
  id: string;
  origin: string;
  facilityCode: string;
  label: string;
}

export function loadFacilityProfiles(): FacilityProfile[] {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(data)) return [];
    return data.flatMap((entry) => {
      try {
        if (typeof entry.id !== 'string' || typeof entry.origin !== 'string' || typeof entry.facilityCode !== 'string' || typeof entry.label !== 'string') return [];
        return [{ id: entry.id, origin: normalizeServerOrigin(entry.origin), facilityCode: normalizeFacilityCode(entry.facilityCode), label: entry.label }];
      } catch { return []; }
    });
  } catch { return []; }
}

export function saveFacilityProfile(profiles: FacilityProfile[], draft: Omit<FacilityProfile, 'id'>, editingId?: string): FacilityProfile[] {
  const profile: FacilityProfile = {
    id: editingId || Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) => part.toString(16)).join('-'), origin: normalizeServerOrigin(draft.origin),
    facilityCode: normalizeFacilityCode(draft.facilityCode), label: draft.label.trim(),
  };
  if (!profile.facilityCode) throw new Error('Kode fasilitas pada profil wajib diisi.');
  const next = editingId ? profiles.map((entry) => entry.id === editingId ? profile : entry) : [...profiles, profile];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function deleteFacilityProfile(profiles: FacilityProfile[], id: string): FacilityProfile[] {
  const next = profiles.filter((entry) => entry.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
