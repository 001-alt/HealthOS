import type { DayJournal, FoodEntry, Profile, WorkoutLog, WorkoutPlan } from '../types';
import { todayISO } from './measurements';

export const sourceLabels = { template: '系统模板', ai: 'AI 建议', custom: '自定义' } as const;
export const meals = ['早餐', '午餐', '晚餐', '加餐'] as const;
export const newEntryId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function addDays(date: string, count: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + count);
  return todayISO(value);
}

export function weekDates(date: string) {
  const weekday = new Date(`${date}T12:00:00`).getDay();
  const monday = addDays(date, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function dateLabel(date: string) {
  return `${date.slice(5).replace('-', '/')} ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${date}T12:00:00`).getDay()]}`;
}

export function templatePlan(date: string, profile: Profile): WorkoutPlan {
  const strength = ['增肌', '腹肌明显'].includes(profile.goal);
  const plans: Record<number, [string, [string, string][]]> = strength ? {
    1: ['上肢力量', [['俯卧撑', '3 组 × 10 次'], ['哑铃划船', '3 组 × 12 次']]],
    3: ['下肢力量', [['深蹲', '3 组 × 12 次'], ['臀桥', '3 组 × 15 次']]],
    5: ['全身循环', [['平板支撑', '3 组 × 30 秒'], ['登山跑', '3 组 × 20 次']]],
  } : {
    1: ['轻松有氧', [['快走或骑行', '30 分钟']]],
    3: ['全身激活', [['深蹲', '3 组 × 12 次'], ['跪姿俯卧撑', '3 组 × 10 次']]],
    5: ['核心与拉伸', [['平板支撑', '3 组 × 20 秒'], ['拉伸', '10 分钟']]],
  };
  const plan = plans[new Date(`${date}T12:00:00`).getDay()];
  return {
    title: plan?.[0] ?? '休息恢复', source: 'template',
    note: plan ? '按当天状态调整动作和强度，出现疼痛时停止。' : '今天没有安排训练；可休息，或添加自己的活动。',
    actions: (plan?.[1] ?? []).map(([name, target], index) => ({ id: `action-${index}`, name, target })),
  };
}

export function createDay(date: string, profile: Profile, proteinTarget: number): DayJournal {
  return { date, proteinTarget, foods: [], plan: templatePlan(date, profile) };
}

export const proteinTotal = (foods: FoodEntry[]) => Math.round(foods.reduce((total, food) => total + food.protein, 0) * 10) / 10;
export const doneActions = (day: DayJournal) => day.plan.actions.filter(action => day.workout?.results.some(result => result.actionId === action.id && result.done && result.actual.trim()));
export const workoutComplete = (day: DayJournal) => day.plan.actions.length > 0 && doneActions(day).length === day.plan.actions.length;
export function workoutStatus(day: DayJournal, today: string) {
  if (day.legacyExercise && !day.workout) return '旧版已打卡，待补明细';
  if (!day.plan.actions.length) return '休息日';
  if (workoutComplete(day)) return '已完成';
  const count = doneActions(day).length;
  if (count) return `已记录 ${count}/${day.plan.actions.length} 项`;
  if (day.date > today) return '未开始';
  return day.date < today ? '未记录' : '待训练';
}

export function validateFood(food: FoodEntry) {
  if (!meals.includes(food.meal)) throw new Error('请选择餐次。');
  if (!food.name.trim() || food.name.length > 60) throw new Error('请填写食物名称（最多 60 字）。');
  if (!food.portion.trim() || food.portion.length > 60) throw new Error('请填写实际份量，例如 250 ml 或 1 份。');
  if (!Number.isFinite(food.protein) || food.protein < 0 || food.protein > 300) throw new Error('请填写这份食物的蛋白质总量，范围 0–300 g。');
}

export function validatePlan(plan: WorkoutPlan) {
  if (!plan.title.trim() || plan.title.length > 60) throw new Error('请填写训练名称（最多 60 字）。');
  if (!['template', 'ai', 'custom'].includes(plan.source)) throw new Error('训练来源无效。');
  if (plan.note.length > 500 || plan.actions.length > 12) throw new Error('训练最多 12 项，备注最多 500 字。');
  if (new Set(plan.actions.map(action => action.id)).size !== plan.actions.length) throw new Error('训练动作重复，请重新添加。');
  if (plan.actions.some(action => !action.id || !action.name.trim() || !action.target.trim() || action.name.length > 60 || action.target.length > 100)) throw new Error('请为每个动作填写名称和计划量（组数、次数或时长）。');
}

export function validateWorkout(day: DayJournal, workout: WorkoutLog, today: string) {
  if (day.date > today) throw new Error('未来日期只能编辑计划，不能提前记录完成。');
  if (!day.plan.actions.length) throw new Error('请先添加实际进行的训练动作。');
  if (workout.minutes !== undefined && (!Number.isFinite(workout.minutes) || workout.minutes <= 0 || workout.minutes > 1440)) throw new Error('训练时长应在 0–1440 分钟之间。');
  if (workout.note.length > 500) throw new Error('训练感受最多 500 字。');
  if (new Set(workout.results.map(result => result.actionId)).size !== workout.results.length) throw new Error('完成记录重复，请重新打开。');
  for (const result of workout.results) {
    if (!day.plan.actions.some(action => action.id === result.actionId)) throw new Error('计划已变更，请重新打开训练记录。');
    if (result.actual.length > 100 || (result.done && !result.actual.trim())) throw new Error('请为已完成的动作填写实际组数、次数或时长。');
  }
}

// An AI response is untrusted input: require a small, valid plan before displaying it.
export function parseAIPlan(content: string): WorkoutPlan {
  try {
    const value = JSON.parse(content);
    if (typeof value.title !== 'string' || typeof value.note !== 'string' || !Array.isArray(value.actions) || !value.actions.length) throw new Error();
    const plan: WorkoutPlan = {
      title: value.title, note: value.note, source: 'ai',
      actions: value.actions.map((action: { name?: unknown; target?: unknown }, index: number) => {
        if (!action || typeof action.name !== 'string' || typeof action.target !== 'string') throw new Error();
        return { id: `ai-${index}`, name: action.name, target: action.target };
      }),
    };
    validatePlan(plan);
    return plan;
  } catch { throw new Error('AI 返回的训练计划不完整，请重试或自行填写。'); }
}
