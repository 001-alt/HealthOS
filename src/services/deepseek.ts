import { Metrics } from '../utils/healthCalculator';
import { Profile, DailyCheck, DayJournal, BodyRecord } from '../types';
import { parseAIPlan } from '../utils/journal';
import { parseDailyCoach } from '../utils/coach';

export async function generateDailyCoach(apiKey: string, profile: Profile, metrics: Metrics, day: DayJournal, check: DailyCheck, records: BodyRecord[], preferences: string, signal?: AbortSignal) {
  const context = { date: day.date, profile: { age: profile.age, gender: profile.gender, height: profile.height, weight: profile.weight, waist: profile.waist, goal: profile.goal, activity: profile.activity, bodyGoal: profile.bodyGoal }, targets: { proteinG: day.proteinTarget, calories: metrics.calories, waterMl: 2500 }, actual: { foods: day.foods, waterMl: check.waterMl ?? null, steps: check.stepsCount ?? null, sleepHours: check.sleepHours ?? null, plan: day.plan, workout: day.workout ?? null }, recentMeasurements: records.slice(0, 7), preferences };
  const prompt = `根据以下真实记录生成中文每日健康计划：${JSON.stringify(context)}。空值代表未记录，不能当作零或断言没有做。明确区分已记录摄入和建议菜单；餐次建议提供食物、份量与替换选择，营养值只能标为估算。结合当天剩余安排、活动水平、睡眠及用户偏好。饮水统一使用 ml。若已训练完成，重点建议恢复，不重复增加训练负担；训练草稿为可选替代方案。避免激进减重、极端饮食、高强度强制训练和医疗诊断；有疼痛或不适时建议停止相关动作并寻求专业帮助。只输出 json，结构为 {"summary":"基于记录的今日概况","tasks":["可执行的当天待办，最多6项"],"meals":[{"meal":"午餐","suggestion":"食物、份量、替换方案及理由"}],"workout":{"title":"可选训练安排","note":"强度与注意事项","actions":[{"name":"动作","target":"具体组数次数或时长"}]},"recovery":"恢复及作息建议","feedback":"说明依据、不确定信息与需要用户补充的记录"}。每段不超过400字；训练1至6项。`;
  return parseDailyCoach(await requestCoach(apiKey, prompt, true, signal), day.date);
}

export async function generateCoachAdvice(apiKey: string, profile: Profile, metrics: Metrics, feedback = '', signal?: AbortSignal) {
  const prompt = `用户：${profile.age}岁${profile.gender}，${profile.height}cm，${profile.weight}kg，腰围${profile.waist}cm，体脂率${profile.bodyFat == null ? '未记录' : `${profile.bodyFat}%`}，目标：${profile.goal}。每日热量${metrics.calories} kcal，蛋白质${metrics.protein}g，活动水平：${profile.activity}。反馈：${feedback || '暂无'}。请用简洁中文输出：今日状态、饮食建议、训练建议、注意事项、鼓励反馈。不要医疗诊断，不要极端节食。`;
  return requestCoach(apiKey, prompt, false, signal);
}

export async function generateWorkoutPlan(apiKey: string, profile: Profile, date: string, preferences: string, signal?: AbortSignal) {
  const prompt = `为 ${date} 生成一份保守、易执行的单日训练建议。用户 ${profile.age} 岁，${profile.gender}，目标 ${profile.goal}，活动水平 ${profile.activity}。用户的时间、器械或动作偏好：${preferences || '未提供，优先无需器械的基础动作'}。只输出 json：{"title":"训练名称","note":"执行注意事项","actions":[{"name":"动作名称","target":"组数 × 次数，或分钟数"}]}。给出 1 到 6 项动作，每项都有具体计划量；名称最多 60 字，计划量最多 100 字，备注最多 500 字。不宣称动作已完成，不做医疗诊断，不生成极端训练。`;
  return parseAIPlan(await requestCoach(apiKey, prompt, true, signal));
}

async function requestCoach(apiKey: string, prompt: string, json: boolean, signal?: AbortSignal) {
  if (!apiKey.trim()) throw new Error('请先在“我的”里配置 DeepSeek API Key');
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel);
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` }, body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: '你是一名专业、审慎、易执行的健康管理教练。' }, { role: 'user', content: prompt }], temperature: 0.7, max_tokens: json ? 2800 : 800, ...(json ? { response_format: { type: 'json_object' } } : {}) }) });
    if (response.status === 401) throw new Error('API Key 无效或已失效，请在“我的”中重新配置。');
    if (response.status === 402) throw new Error('DeepSeek 账户余额不足，请检查账户后重试。');
    if (response.status === 429) throw new Error('请求过于频繁，请稍等片刻再试。');
    if (!response.ok) throw new Error(`AI 服务暂时不可用（${response.status}），请稍后重试。`);
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('AI 未返回有效建议，请重试。');
    return content.trim();
  } catch (error) {
    if (timedOut) throw new Error('请求已超过 30 秒，请检查网络后重试。');
    if (controller.signal.aborted) throw new Error('已取消生成。');
    if (error instanceof TypeError) throw new Error('无法连接 AI 服务，请检查网络后重试。');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}
