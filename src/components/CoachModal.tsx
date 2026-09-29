import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import type { BodyRecord, DailyCheck, DayJournal, Profile } from '../types';
import { generateDailyCoach } from '../services/deepseek';
import { calculateMetrics } from '../utils/healthCalculator';
import { proteinTotal, workoutStatus } from '../utils/journal';
import { todayISO, withLatestMeasurements } from '../utils/measurements';
import { Button, ErrorText, Input, j, JournalModal, useSaveAction } from './JournalUI';
import type { UpdateDay } from './FoodDiaryModal';

export function CoachModal({ day, check, profile, records, apiKey, updateDay, onClose, onFood, onWorkout, onKey }: {
  day?: DayJournal; check: DailyCheck; profile: Profile; records: BodyRecord[]; apiKey: string; updateDay: UpdateDay; onClose: () => void; onFood: () => void; onWorkout: () => void; onKey: () => void;
}) {
  const [preferences, setPreferences] = useState(''); const [message, setMessage] = useState('');
  const { busy, error, run } = useSaveAction(); const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const coach = day?.coach;
  const generate = () => { void run(async () => {
    if (!day || day.date !== todayISO()) throw new Error('日期已变化，请关闭后重新打开今日教练。');
    setMessage(''); const controller = new AbortController(); request.current = controller;
    try {
      const current = withLatestMeasurements(profile, records);
      const generated = await generateDailyCoach(apiKey, current, calculateMetrics(current), day, check, records, preferences, controller.signal);
      await updateDay(day.date, current => ({ ...current, coach: generated, coachDone: [] }));
      setMessage('每日计划已保存。训练草稿可在下方查看并采纳。');
    } finally { request.current = null; }
  }); };
  const adopt = () => Alert.alert('采纳训练草稿', `将替换 ${day?.date} 的训练计划，实际完成情况需要另行记录。`, [{ text: '取消', style: 'cancel' }, { text: '采纳', onPress: () => { void run(async () => {
    if (!day || !coach || day.date !== todayISO()) throw new Error('只能采纳当天的建议。');
    await updateDay(day.date, current => {
      if (current.workout) throw new Error('当天已有实际训练记录，保留原计划。可以参考建议安排后续训练。');
      return { ...current, plan: coach.workout };
    }); setMessage('已采纳到今天的训练计划。');
  }); } }]);
  return <JournalModal title="AI 每日教练" onClose={onClose} busy={busy}>
    <Text style={j.muted}>{day?.date ?? todayISO()} · 根据你的记录调整每日计划</Text>
    {day && <View style={j.hero}><Text style={j.title}>本次建议参考</Text><Text style={j.text}>已记录蛋白质 {proteinTotal(day.foods)} / {day.proteinTarget} g · 饮水 {check.waterMl ?? '未记录'} ml</Text><Text style={j.text}>睡眠 {check.sleepHours ?? '未记录'} 小时 · 步数 {check.stepsCount ?? '未记录'}</Text><Text style={j.text}>训练：{day.plan.title} · {workoutStatus(day, todayISO())}</Text></View>}
    <Input label="今天的情况和偏好" value={preferences} onChangeText={setPreferences} multiline maxLength={500} editable={!busy} placeholder="例如：午餐在食堂、晚间有20分钟、无器械；也可填写饮食禁忌或训练反馈" />
    <Text style={j.muted}>生成时会将上述健康记录和偏好发送给 DeepSeek。照片与 API Key 不会放入提示内容。</Text>
    {!apiKey.trim() && <Button title="先配置 API Key" onPress={onKey} secondary />}
    <Button title={busy ? '处理中…' : coach ? '根据最新记录重新生成' : '生成每日计划'} onPress={generate} disabled={busy || !day || !apiKey.trim()} />
    {busy && <Button title="取消 AI 请求" secondary onPress={() => request.current?.abort()} />}
    <ErrorText error={error} />{message ? <Text accessibilityRole="alert" style={j.badge}>{message}</Text> : null}
    {coach ? <>
      <View style={j.card}><Text style={j.title}>今日概况</Text><Text style={j.muted}>生成于 {new Date(coach.generatedAt).toLocaleString('zh-CN')}。新增记录后可重新生成。</Text><Text style={j.text}>{coach.summary}</Text></View>
      <View style={j.card}><Text style={j.title}>每日行动清单</Text><Text style={j.muted}>勾选仅记录此待办进度，不会代填食物和训练。重新生成将更新清单。</Text>{coach.tasks.map((task, index) => <Pressable key={index} disabled={busy} accessibilityRole="checkbox" accessibilityState={{ checked: day?.coachDone?.includes(index) ?? false }} style={[j.check, day?.coachDone?.includes(index) && j.checked]} onPress={() => { if (day) void run(() => updateDay(day.date, current => ({ ...current, coachDone: current.coachDone?.includes(index) ? current.coachDone.filter(item => item !== index) : [...(current.coachDone ?? []), index] }))); }}><Text style={j.text}>{day?.coachDone?.includes(index) ? '✓' : '○'} {task}</Text></Pressable>)}</View>
      <View style={j.card}><Text style={j.title}>饮食安排 · 尚未计入摄入</Text>{coach.meals.map((meal, index) => <View key={index} style={j.divider}><Text style={j.badge}>{meal.meal}</Text><Text style={j.text}>{meal.suggestion}</Text></View>)}<Button title="记录实际吃过的食物" onPress={onFood} secondary /></View>
      <View style={j.card}><Text style={j.title}>可选训练 · {coach.workout.title}</Text>{coach.workout.actions.map(action => <Text key={action.id} style={j.text}>{action.name} · {action.target}</Text>)}<Text style={j.muted}>{coach.workout.note}</Text><Button title={day?.workout ? '已有训练记录，保留原计划' : '采纳为今日训练计划'} disabled={busy || !!day?.workout} onPress={adopt} /><Button title="查看计划 / 记录实际训练" onPress={onWorkout} secondary /></View>
      <View style={j.card}><Text style={j.title}>恢复与作息</Text><Text style={j.text}>{coach.recovery}</Text><Text style={j.muted}>{coach.feedback}</Text></View>
    </> : <View style={j.card}><Text style={j.title}>从建议到行动</Text><Text style={j.text}>生成后可查看具体餐次、每日待办、训练动作及恢复建议。饮食按实际摄入记录，训练可选择采纳草稿。</Text></View>}
  </JournalModal>;
}
