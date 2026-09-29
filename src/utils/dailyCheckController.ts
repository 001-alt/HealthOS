import { DailyCheck } from '../types';

export const emptyCheck: DailyCheck = { protein: false, water: false, exercise: false, steps: false, sleep: false };

export function createDailyCheckController(deps: {
  today: () => string;
  load: (date: string) => Promise<DailyCheck | null>;
  save: (date: string, check: DailyCheck) => Promise<void>;
  onChange: (check: DailyCheck) => void;
}) {
  let date = '';
  let check = { ...emptyCheck };
  let queue = Promise.resolve();
  function enqueue(work: () => Promise<void>) {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  }
  async function loadDay(target: string) {
    if (target === date) return;
    const loaded = await deps.load(target);
    date = target;
    check = loaded ?? { ...emptyCheck };
  }
  return {
    refresh: () => enqueue(async () => {
      await loadDay(deps.today());
      deps.onChange({ ...check });
    }),
    update: (updater: (previous: DailyCheck) => DailyCheck) => {
      // Capture the interaction's date, never the time at which a queued write finishes.
      const target = deps.today();
      return enqueue(async () => {
        await loadDay(target);
        const next = updater({ ...check });
        await deps.save(target, next);
        check = next;
        if (target === deps.today()) deps.onChange({ ...check });
      });
    },
  };
}
