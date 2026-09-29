export type Goal = '健康匀称' | '精瘦' | '腹肌明显' | '增肌' | '降低体脂';
export type ActivityLevel = '久坐' | '轻度活动' | '中度活动' | '高强度活动';
export type Profile = { age: number; gender: '男' | '女'; height: number; weight: number; waist: number; chest?: number; hip?: number; arm?: number; bodyFat?: number; photoUri?: string; goal: Goal; duration: 4 | 8 | 12; activity: ActivityLevel; bodyGoal?: BodyGoal };
export type BodyRecord = { id: number; date: string; weight: number; waist: number; bodyFat?: number };
export type DailyCheck = { protein: boolean; water: boolean; exercise: boolean; steps: boolean; sleep: boolean; waterMl?: number; stepsCount?: number; sleepHours?: number };

export type Meal = '早餐' | '午餐' | '晚餐' | '加餐';
export type FoodEntry = { id: string; meal: Meal; name: string; portion: string; protein: number };
export type PlanSource = 'template' | 'ai' | 'custom';
export type WorkoutAction = { id: string; name: string; target: string };
export type WorkoutPlan = { title: string; source: PlanSource; note: string; actions: WorkoutAction[] };
export type WorkoutResult = { actionId: string; done: boolean; actual: string };
export type WorkoutLog = { results: WorkoutResult[]; minutes?: number; note: string; savedAt: string };
export type DayJournal = {
  date: string;
  proteinTarget: number;
  foods: FoodEntry[];
  plan: WorkoutPlan;
  workout?: WorkoutLog;
  coach?: DailyCoachPlan;
  coachDone?: number[];
  legacyProtein?: boolean;
  legacyExercise?: boolean;
};

export type BodyGoal = { startDate: string; startWeight: number; startWaist: number; targetWeight?: number; targetWaist?: number };
export type DailyCoachPlan = { date: string; generatedAt: string; summary: string; tasks: string[]; meals: { meal: string; suggestion: string }[]; workout: WorkoutPlan; recovery: string; feedback: string };
