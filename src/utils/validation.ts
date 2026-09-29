import { BodyRecord, Profile } from '../types';

export const measurementRules = {
  age: { label: '年龄', min: 1, max: 120, integer: true },
  height: { label: '身高（cm）', min: 50, max: 250 },
  weight: { label: '体重（kg）', min: 20, max: 400 },
  waist: { label: '腰围（cm）', min: 30, max: 250 },
  chest: { label: '胸围（cm）', min: 20, max: 250 },
  hip: { label: '臀围（cm）', min: 20, max: 250 },
  arm: { label: '手臂围（cm）', min: 20, max: 250 },
  bodyFat: { label: '体脂率（%）', min: 3, max: 75 },
} as const;
export type MeasurementKey = keyof typeof measurementRules;
export type FieldErrors = Partial<Record<MeasurementKey, string>>;
export type ProfileDraft = Omit<Profile, MeasurementKey> & Record<MeasurementKey, string>;

export function parseNumber(value: string): number {
  const normalized = value.trim();
  return /^\d+(\.\d*)?$/.test(normalized) ? Number(normalized) : NaN;
}

export function toProfileDraft(profile: Profile): ProfileDraft {
  const draft = { ...profile } as unknown as ProfileDraft;
  for (const key of Object.keys(measurementRules) as MeasurementKey[]) draft[key] = profile[key]?.toString() ?? '';
  return draft;
}

export function parseProfileDraft(draft: ProfileDraft): Profile {
  const profile = { ...draft } as unknown as Profile;
  for (const key of Object.keys(measurementRules) as MeasurementKey[]) {
    const optional = ['chest', 'hip', 'arm', 'bodyFat'].includes(key);
    Object.assign(profile, { [key]: optional && !draft[key].trim() ? undefined : parseNumber(draft[key]) });
  }
  return profile;
}

function validateFields(value: Partial<Record<MeasurementKey, number>>, keys: MeasurementKey[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const key of keys) {
    const rule = measurementRules[key];
    const number = value[key];
    if (number == null && ['chest', 'hip', 'arm', 'bodyFat'].includes(key)) continue;
    if (typeof number !== 'number' || !Number.isFinite(number) || number < rule.min || number > rule.max || ('integer' in rule && !Number.isInteger(number))) {
      errors[key] = `请输入 ${rule.min}–${rule.max} 之间的${'integer' in rule ? '整数' : '数值'}`;
    }
  }
  return errors;
}

export function validateProfile(profile: Profile): FieldErrors {
  return validateFields(profile, Object.keys(measurementRules) as MeasurementKey[]);
}

export function validateBodyRecord(record: Omit<BodyRecord, 'id' | 'date'>): FieldErrors {
  return validateFields(record, ['weight', 'waist', 'bodyFat']);
}

export function assertValid(errors: FieldErrors) {
  const first = Object.entries(errors)[0];
  if (first) throw new Error(`${measurementRules[first[0] as MeasurementKey].label}：${first[1]}`);
}
