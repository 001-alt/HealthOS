import type { DayJournal } from '../types';

export function createJournalController(deps: {
  loadOrCreate: (date: string) => Promise<DayJournal>;
  save: (day: DayJournal) => Promise<void>;
  onChange: (days: Record<string, DayJournal>) => void;
}) {
  let days: Record<string, DayJournal> = {};
  let queue = Promise.resolve();
  function enqueue(work: () => Promise<void>) {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  }
  async function load(date: string) {
    if (!days[date]) days = { ...days, [date]: await deps.loadOrCreate(date) };
    return days[date];
  }
  return {
    loadDates: (dates: string[]) => enqueue(async () => {
      for (const date of dates) await load(date);
      deps.onChange({ ...days });
    }),
    update: (date: string, updater: (day: DayJournal) => DayJournal) => enqueue(async () => {
      // Each edit captures its explicit date. Never redirect an open form at midnight.
      const previous = await load(date);
      const next = updater(JSON.parse(JSON.stringify(previous)) as DayJournal);
      if (next.date !== date) throw new Error('记录日期不能变更。');
      await deps.save(next);
      days = { ...days, [date]: next };
      deps.onChange({ ...days });
    }),
  };
}
