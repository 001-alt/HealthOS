import type { DailyCoachPlan } from '../types';
import { parseAIPlan } from './journal';

export function parseDailyCoach(content: string, date: string): DailyCoachPlan {
  try {
    const data = JSON.parse(content);
    const text = (value: unknown, max = 800) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(); return value.trim(); };
    if (!Array.isArray(data.tasks) || !data.tasks.length || data.tasks.length > 6 || !Array.isArray(data.meals) || !data.meals.length || data.meals.length > 4) throw new Error();
    return { date, generatedAt: new Date().toISOString(), summary: text(data.summary), tasks: data.tasks.map((task: unknown) => text(task, 200)), meals: data.meals.map((meal: { meal: unknown; suggestion: unknown }) => ({ meal: text(meal.meal, 20), suggestion: text(meal.suggestion, 500) })), workout: parseAIPlan(JSON.stringify(data.workout)), recovery: text(data.recovery), feedback: text(data.feedback) };
  } catch { throw new Error('AI 返回的每日计划不完整，请重新生成。原有记录已保留。'); }
}
