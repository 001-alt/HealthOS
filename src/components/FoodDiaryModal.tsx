import React, { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import type { DayJournal, FoodEntry, Meal } from '../types';
import { addDays, dateLabel, meals, newEntryId, proteinTotal, validateFood } from '../utils/journal';
import { parseNumber } from '../utils/validation';
import { todayISO } from '../utils/measurements';
import { Button, ErrorText, Input, j, JournalModal, useSaveAction } from './JournalUI';

export type UpdateDay = (date: string, update: (day: DayJournal) => DayJournal) => Promise<void>;
type FoodDraft = { id?: string; meal: Meal; name: string; portion: string; protein: string };
const blank: FoodDraft = { meal: '早餐', name: '', portion: '', protein: '' };

export function FoodDiaryModal({ initialDate, days, loadWeek, updateDay, onClose }: {
  initialDate: string; days: Record<string, DayJournal>; loadWeek: (date: string) => Promise<void>; updateDay: UpdateDay; onClose: () => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [draft, setDraft] = useState<FoodDraft>(blank);
  const [loadError, setLoadError] = useState('');
  const { busy, error, run } = useSaveAction();
  const day = days[date];
  const load = () => { setLoadError(''); void loadWeek(date).catch(() => setLoadError('饮食记录加载失败，请重试。')); };
  useEffect(() => { void loadWeek(date).catch(() => setLoadError('饮食记录加载失败，请重试。')); }, [date, loadWeek]);
  const changeDate = (next: string) => { setDate(next); setDraft(blank); setLoadError(''); };
  const save = () => run(async () => {
    if (date > todayISO()) throw new Error('不能提前记录未来的饮食。');
    const food: FoodEntry = { ...draft, id: draft.id ?? newEntryId(), name: draft.name.trim(), portion: draft.portion.trim(), protein: parseNumber(draft.protein) };
    validateFood(food);
    await updateDay(date, current => ({ ...current, foods: draft.id ? current.foods.map(item => item.id === draft.id ? food : item) : [...current.foods, food] }));
    setDraft({ ...blank, meal: draft.meal });
  });
  const remove = (food: FoodEntry) => Alert.alert('删除食物记录', `删除 ${dateLabel(date)} 的“${food.name}”？蛋白质合计会同步更新。`, [
    { text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => { void run(async () => { await updateDay(date, current => ({ ...current, foods: current.foods.filter(item => item.id !== food.id) })); if (draft.id === food.id) setDraft(blank); }); } },
  ]);
  const total = day ? proteinTotal(day.foods) : 0;
  return <JournalModal title="饮食与蛋白质" onClose={onClose} busy={busy}>
    <View style={j.row}><Button title="前一天" secondary disabled={busy} onPress={() => changeDate(addDays(date, -1))} /><Text style={j.title}>{dateLabel(date)}</Text><Button title="后一天" secondary disabled={busy || date >= todayISO()} onPress={() => changeDate(addDays(date, 1))} /></View>
    <Text style={j.muted}>记录归属：{date}。蛋白质填写本次实际吃下的份量所含总克数。</Text>
    {loadError ? <><ErrorText error={loadError} /><Button title="重试加载" onPress={load} /></> : !day ? <Text style={j.muted}>正在加载…</Text> : <>
      <View style={j.hero}><Text style={j.big}>{total} / {day.proteinTarget} g</Text><Text style={j.text}>{total >= day.proteinTarget ? '当日蛋白质目标已达成 ✓' : `距离当日目标还差 ${Math.round((day.proteinTarget - total) * 10) / 10} g`} · 已记录 {day.foods.length} 项食物</Text><View style={j.progress}><View style={[j.fill, { width: `${Math.min(100, total / day.proteinTarget * 100)}%` }]} /></View></View>
      {day.legacyProtein && !day.foods.length && <Text style={j.muted}>这一天有旧版“蛋白质达标”打卡，但没有食物明细。请补录，系统将按实际克数统计。</Text>}
      <View style={j.card}>
        <Text style={j.title}>{draft.id ? '修改这项食物' : '添加吃过的食物'}</Text>
        <View style={j.wrap}>{meals.map(meal => <Button key={meal} title={meal} secondary={draft.meal !== meal} disabled={busy} onPress={() => setDraft({ ...draft, meal })} />)}</View>
        <Input label="食物名称" value={draft.name} onChangeText={name => setDraft({ ...draft, name })} placeholder="例如：牛奶、鸡胸肉、豆腐" maxLength={60} editable={!busy} />
        <Input label="实际份量" value={draft.portion} onChangeText={portion => setDraft({ ...draft, portion })} placeholder="例如：250 ml、150 g、1 份" maxLength={60} editable={!busy} />
        <Input label="这份食物的蛋白质（g）" value={draft.protein} onChangeText={protein => setDraft({ ...draft, protein })} numeric placeholder="按包装营养标签或已知数据填写" editable={!busy} />
        <Text style={j.muted}>例如标签写每 100 ml 含 3 g，喝了 250 ml，就填 7.5。这里填写蛋白质克数，不是食物重量。</Text>
        <ErrorText error={error} />
        <Button title={busy ? '保存中…' : draft.id ? '保存修改' : '添加食物'} disabled={busy} onPress={() => { void save(); }} />
        {draft.id && <Button title="取消修改" secondary disabled={busy} onPress={() => setDraft(blank)} />}
      </View>
      <Text style={j.title}>当天吃了什么</Text>
      {!day.foods.length && <Text style={j.muted}>还没有明细。添加后会自动累计，无需手动勾选达标。</Text>}
      {meals.map(meal => {
        const foods = day.foods.filter(food => food.meal === meal);
        return foods.length ? <View key={meal} style={j.card}><View style={j.row}><Text style={j.title}>{meal}</Text><Text style={j.badge}>{proteinTotal(foods)} g 蛋白质</Text></View>{foods.map(food => <View key={food.id} style={j.divider}><Text style={j.text}>{food.name} · {food.portion}</Text><View style={j.row}><Text style={j.title}>{food.protein} g</Text><View style={j.wrap}><Button title="修改" secondary disabled={busy} onPress={() => setDraft({ ...food, protein: String(food.protein) })} /><Button title="删除" secondary disabled={busy} onPress={() => remove(food)} /></View></View></View>)}</View> : null;
      })}
    </>}
  </JournalModal>;
}
