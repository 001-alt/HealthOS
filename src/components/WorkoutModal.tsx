import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { DayJournal, WorkoutLog, WorkoutPlan, PlanSource } from '../types';
import { addDays, dateLabel, sourceLabels, templatePlan, validatePlan, validateWorkout, workoutStatus } from '../utils/journal';
import { Button, ErrorText, Input, j, JournalModal, useSaveAction } from './JournalUI';
import { generateWorkoutPlan } from '../services/deepseek';
import { Profile } from '../types';
import { todayISO } from '../utils/measurements';

type ActionDraft = { name: string; target: string };
const emptyAction: ActionDraft = { name: '', target: '' };

function planToDraft(plan: WorkoutPlan) { return { title: plan.title, note: plan.note, source: plan.source as PlanSource, actions: plan.actions.map(action => ({ name: action.name, target: action.target })) }; }

export function WorkoutModal({ initialDate, days, profile, apiKey, loadWeek, updateDay, onClose }: {
  initialDate: string; days: Record<string, DayJournal>; profile: Profile; apiKey: string; loadWeek: (date: string) => Promise<void>; updateDay: (date: string, update: (day: DayJournal) => DayJournal) => Promise<void>; onClose: () => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [mode, setMode] = useState<'record' | 'plan'>('record');
  const [loadError, setLoadError] = useState('');
  const [planDraft, setPlanDraft] = useState(() => planToDraft(days[initialDate]?.plan ?? templatePlan(initialDate, profile)));
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');
  const [results, setResults] = useState<Record<string, { done: boolean; actual: string }>>({});
  const [preferences, setPreferences] = useState('');
  const { busy, error, run } = useSaveAction();
  const [aiBusy, setAiBusy] = useState(false);
  const day = days[date];
  const load = () => { setLoadError(''); void loadWeek(date).catch(() => setLoadError('训练记录加载失败，请重试。')); };
  useEffect(() => { void loadWeek(date).catch(() => setLoadError('训练记录加载失败，请重试。')); }, [date, loadWeek]);
  useEffect(() => {
    if (!day) return;
    // Hydrate the editor when the async day record becomes available or the date changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlanDraft(planToDraft(day.plan));
    setMinutes(day.workout?.minutes ? String(day.workout.minutes) : '');
    setNote(day.workout?.note ?? '');
    setResults(Object.fromEntries(day.plan.actions.map(action => [action.id, day.workout?.results.find(result => result.actionId === action.id) ?? { done: false, actual: '' }])));
  }, [day]);
  const changeDate = (next: string) => { setDate(next); setMode('record'); setLoadError(''); };
  const savePlan = () => run(async () => {
    const plan: WorkoutPlan = { title: planDraft.title.trim(), note: planDraft.note.trim(), source: planDraft.source, actions: planDraft.actions.map((action, index) => ({ id: day?.plan.actions[index]?.id ?? `custom-${Date.now()}-${index}`, name: action.name.trim(), target: action.target.trim() })) };
    validatePlan(plan); await updateDay(date, current => ({ ...current, plan })); setMode('record');
  });
  const saveWorkout = () => run(async () => {
    if (!day) throw new Error('训练日期尚未加载。');
    const workout: WorkoutLog = { results: day.plan.actions.map(action => ({ actionId: action.id, done: !!results[action.id]?.done, actual: results[action.id]?.actual.trim() ?? '' })), minutes: minutes.trim() ? Number(minutes) : undefined, note: note.trim(), savedAt: new Date().toISOString() };
    validateWorkout(day, workout, todayISO()); await updateDay(date, current => ({ ...current, workout }));
  });
  const generate = async () => {
    if (!apiKey.trim()) { setLoadError('请先在“我的”里配置 DeepSeek API Key；也可以直接手动编辑计划。'); return; }
    if (aiBusy) return;
    setAiBusy(true); setLoadError('');
    try { const generated = await generateWorkoutPlan(apiKey, profile, date, preferences); setPlanDraft(planToDraft(generated)); setMode('plan'); }
    catch (reason) { setLoadError(reason instanceof Error ? reason.message : 'AI 训练计划生成失败，请重试。'); }
    finally { setAiBusy(false); }
  };
  const addAction = () => setPlanDraft(current => ({ ...current, source: 'custom', actions: [...current.actions, emptyAction] }));
  return <JournalModal title="训练计划与完成记录" onClose={onClose} busy={busy || aiBusy}>
    <View style={j.row}><Button title="前一天" secondary disabled={busy || aiBusy} onPress={() => changeDate(addDays(date, -1))} /><Text style={j.title}>{dateLabel(date)}</Text><Button title="后一天" secondary disabled={busy || aiBusy || date >= todayISO()} onPress={() => changeDate(addDays(date, 1))} /></View>
    <Text style={j.muted}>所有完成量都归属到 {date}。计划内容和实际完成量分开保存，便于回看“哪天做了什么”。</Text>
    {loadError ? <><ErrorText error={loadError} /><Button title="重试加载" onPress={load} /></> : !day ? <Text style={j.muted}>正在加载…</Text> : <>
      <View style={j.row}><Button title="记录实际完成" secondary={mode !== 'record'} disabled={busy || aiBusy} onPress={() => setMode('record')} /><Button title="编辑当天计划" secondary={mode !== 'plan'} disabled={busy || aiBusy} onPress={() => setMode('plan')} /></View>
      {mode === 'plan' ? <View style={j.card}>
        <Text style={j.title}>这一天安排什么？</Text><Text style={j.badge}>来源：{sourceLabels[planDraft.source]}</Text>
        <Input label="训练名称" value={planDraft.title} onChangeText={title => setPlanDraft({ ...planDraft, title, source: 'custom' })} placeholder="例如：下肢力量" maxLength={60} editable={!busy && !aiBusy} />
        <Input label="注意事项" value={planDraft.note} onChangeText={note => setPlanDraft({ ...planDraft, note, source: 'custom' })} placeholder="例如：动作平稳，出现疼痛时停止" multiline maxLength={500} editable={!busy && !aiBusy} />
        {planDraft.actions.map((action, index) => <View style={j.divider} key={`${index}-${action.name}`}><Text style={j.title}>动作 {index + 1}</Text><Input label="动作名称" value={action.name} onChangeText={name => setPlanDraft({ ...planDraft, source: 'custom', actions: planDraft.actions.map((item, i) => i === index ? { ...item, name } : item) })} placeholder="例如：深蹲" maxLength={60} editable={!busy && !aiBusy} /><Input label="计划量" value={action.target} onChangeText={target => setPlanDraft({ ...planDraft, source: 'custom', actions: planDraft.actions.map((item, i) => i === index ? { ...item, target } : item) })} placeholder="例如：3 组 × 12 次" maxLength={100} editable={!busy && !aiBusy} /><Button title="删除动作" secondary disabled={busy || aiBusy} onPress={() => setPlanDraft({ ...planDraft, source: 'custom', actions: planDraft.actions.filter((_, i) => i !== index) })} /></View>)}
        <View style={j.row}><Button title="添加动作" secondary disabled={busy || aiBusy || planDraft.actions.length >= 12} onPress={addAction} /><Button title={aiBusy ? 'AI 生成中…' : '让 AI 生成草稿'} secondary disabled={busy || aiBusy} onPress={() => { void generate(); }} /></View><Input label="给 AI 的偏好（可选）" value={preferences} onChangeText={setPreferences} placeholder="例如：只有瑜伽垫，膝盖不适" maxLength={200} editable={!busy && !aiBusy} /><ErrorText error={error} /><Button title={busy ? '保存中…' : '保存当天计划'} disabled={busy || aiBusy} onPress={() => { void savePlan(); }} />
      </View> : <View style={j.card}>
        <View style={j.row}><Text style={j.title}>{day.plan.title}</Text><Text style={j.badge}>{sourceLabels[day.plan.source]}</Text></View><Text style={j.muted}>{day.plan.note}</Text>
        {!day.plan.actions.length && <Text style={j.text}>今天是休息日。若做了其他训练，请先编辑当天计划添加动作。</Text>}
        {day.plan.actions.map(action => { const result = results[action.id] ?? { done: false, actual: '' }; return <View key={action.id} style={j.divider}><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: result.done }} onPress={() => setResults({ ...results, [action.id]: { ...result, done: !result.done } })} style={[j.check, result.done && j.checked]}><Text style={j.text}>{result.done ? '✓ ' : '○ '}{action.name} · 计划 {action.target}</Text></Pressable><Input label="实际完成量（组数、次数或时长）" value={result.actual} onChangeText={actual => setResults({ ...results, [action.id]: { ...result, actual } })} placeholder="例如：完成 3 组 × 10 次，或 25 分钟" maxLength={100} editable={!busy} /></View>; })}
        <Input label="训练时长（分钟，可选）" value={minutes} onChangeText={setMinutes} numeric placeholder="例如：35" editable={!busy} /><Input label="训练感受或备注（可选）" value={note} onChangeText={setNote} placeholder="例如：最后一组较吃力" multiline maxLength={500} editable={!busy} /><Text style={j.badge}>当前状态：{workoutStatus(day, todayISO())}</Text><ErrorText error={error} /><Button title={busy ? '保存中…' : '保存实际完成情况'} disabled={busy || !day.plan.actions.length} onPress={() => { void saveWorkout(); }} />
      </View>}
      {day.workout && <View style={j.card}><Text style={j.title}>已保存的实际记录</Text><Text style={j.muted}>保存时间：{new Date(day.workout.savedAt).toLocaleString('zh-CN')}</Text>{day.workout.results.filter(result => result.done).map(result => <Text key={result.actionId} style={j.text}>✓ {day.plan.actions.find(action => action.id === result.actionId)?.name}：{result.actual}</Text>)}{day.workout.minutes && <Text style={j.text}>训练时长：{day.workout.minutes} 分钟</Text>}{day.workout.note && <Text style={j.text}>备注：{day.workout.note}</Text>}</View>}
    </>}
  </JournalModal>;
}
