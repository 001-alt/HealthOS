import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { loadOrCreateJournal, saveJournal } from '../database/sqlite';
import type { DayJournal, Profile } from '../types';
import { weekDates } from '../utils/journal';
import { createJournalController } from '../utils/journalController';
import { todayISO } from '../utils/measurements';

export function useJournal(profile: Profile | null, proteinTarget: number) {
  const [days, setDays] = useState<Record<string, DayJournal>>({});
  const [today, setToday] = useState(todayISO);
  const [error, setError] = useState('');
  const enabled = !!profile;
  const controller = useMemo(() => createJournalController({
    loadOrCreate: date => {
      if (!profile) throw new Error('请先建立档案。');
      return loadOrCreateJournal(date, profile, proteinTarget);
    },
    save: saveJournal,
    onChange: setDays,
    // Start a fresh cache after local data is reset and onboarding restarts.
  }), [profile, proteinTarget]);

  const loadWeek = useCallback(async (date: string) => {
    try { await controller.loadDates(weekDates(date)); setError(''); }
    catch (reason) { setError('饮食和训练记录加载失败，请重试。'); throw reason; }
  }, [controller]);
  const refresh = useCallback(() => {
    const date = todayISO();
    setToday(date);
    void loadWeek(date).catch(() => {});
  }, [loadWeek]);
  useEffect(() => {
    if (!enabled) return;
    // Initial load synchronizes external SQLite state into the hook.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const timer = setInterval(refresh, 30000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [enabled, refresh]);

  return { today, days, error, refresh, loadWeek, updateDay: controller.update };
}
