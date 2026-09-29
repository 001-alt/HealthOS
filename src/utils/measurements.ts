import { BodyRecord, Profile } from '../types';

// A skipped optional measurement should not erase the last measured body-fat value.
export function withLatestMeasurements(profile: Profile, records: BodyRecord[]): Profile {
  const latest = records[0];
  const bodyFat = records.find(record => typeof record.bodyFat === 'number')?.bodyFat ?? profile.bodyFat;
  return latest ? { ...profile, weight: latest.weight, waist: latest.waist, bodyFat } : profile;
}

export function todayISO(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
