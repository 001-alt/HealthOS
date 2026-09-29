import type { BodyGoal, BodyRecord } from '../types';

export function goalProgress(start: number, current: number, target: number) {
  if (start === target) return current === target ? 100 : 0;
  return Math.round(Math.max(0, Math.min(100, (current - start) / (target - start) * 100)));
}
export function validateBodyGoal(goal: BodyGoal) {
  if (goal.targetWeight === undefined && goal.targetWaist === undefined) throw new Error('请至少填写一个目标。');
  if (goal.targetWeight !== undefined && (!Number.isFinite(goal.targetWeight) || goal.targetWeight < 20 || goal.targetWeight > 400)) throw new Error('目标体重应在 20–400 kg 之间。');
  if (goal.targetWaist !== undefined && (!Number.isFinite(goal.targetWaist) || goal.targetWaist < 30 || goal.targetWaist > 250)) throw new Error('目标腰围应在 30–250 cm 之间。');
}
export function trendRecords(records: BodyRecord[], start: string, end: string) {
  const unique = new Map<string, BodyRecord>();
  for (const record of [...records].sort((a, b) => b.id - a.id)) {
    if (record.date >= start && record.date <= end && !unique.has(record.date)) unique.set(record.date, record);
  }
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function curve(points: { x: number; y: number }[]) {
  if (!points.length) return '';
  return `M ${points[0].x} ${points[0].y}` + points.slice(1).map((point, index) => {
    const previous = points[index]; const middle = (previous.x + point.x) / 2;
    return ` C ${middle} ${previous.y}, ${middle} ${point.y}, ${point.x} ${point.y}`;
  }).join('');
}
