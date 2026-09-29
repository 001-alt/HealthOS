import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { loadDailyCheck, saveDailyCheck } from '../database/sqlite';
import { DailyCheck } from '../types';
import { createDailyCheckController, emptyCheck } from '../utils/dailyCheckController';
import { todayISO } from '../utils/measurements';

export function useDailyCheck(enabled: boolean) {
  const [check, setCheck] = useState<DailyCheck>(emptyCheck);
  const [controller] = useState(() => createDailyCheckController({ today: todayISO, load: loadDailyCheck, save: saveDailyCheck, onChange: setCheck }));
  const [error, setError] = useState('');
  const refresh = useCallback(() => {
    void controller.refresh().then(() => setError('')).catch(() => setError('今日打卡加载失败，请点击重试'));
  }, [controller]);
  useEffect(() => {
    if (!enabled) return;
    refresh();
    const timer = setInterval(refresh, 30000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [enabled, refresh]);
  const updateCheck = (updater: React.SetStateAction<DailyCheck>) => {
    void controller.update(previous => typeof updater === 'function' ? updater(previous) : updater)
      .then(() => setError(''))
      .catch(() => { setError('打卡未能保存，请重试'); Alert.alert('保存失败', '本次打卡未保存，请重新操作。'); });
  };
  return { check, updateCheck, error, refresh };
}
