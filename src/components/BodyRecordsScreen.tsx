import React, { useId, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Line, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import type { BodyRecord, Profile } from '../types';
import { addDays } from '../utils/journal';
import { todayISO, withLatestMeasurements } from '../utils/measurements';
import { curve, goalProgress, trendRecords, validateBodyGoal } from '../utils/trends';
import { parseNumber } from '../utils/validation';
import { Button, ErrorText, Input, j, JournalModal, useSaveAction } from './JournalUI';

function Trend({ records, metric, start, end }: { records: BodyRecord[]; metric: 'weight' | 'waist' | 'bodyFat'; start: string; end: string }) {
  const id = useId().replace(/:/g, '');
  const rows = records.filter(record => typeof record[metric] === 'number' && Number.isFinite(record[metric]));
  const values = rows.map(record => record[metric]!);
  const unit = metric === 'weight' ? 'kg' : metric === 'waist' ? 'cm' : '%';
  const latest = values.at(-1);
  const change = values.length > 1 ? values[values.length - 1] - values[0] : undefined;
  const min = Math.floor(Math.min(...values) - 1); const max = Math.ceil(Math.max(...values) + 1);
  const startTime = new Date(`${start}T12:00:00`).getTime(); const endTime = new Date(`${end}T12:00:00`).getTime();
  const x = (date: string) => 38 + (new Date(`${date}T12:00:00`).getTime() - startTime) / Math.max(1, endTime - startTime) * 260;
  const points = rows.map((record, index) => ({ x: x(record.date), y: 42 + (max - values[index]) / (max - min) * 115 }));
  const path = curve(points); const last = points.at(-1);
  return <View style={j.card}>
    <Text style={j.title}>{metric === 'weight' ? '体重趋势' : metric === 'waist' ? '腰围趋势' : '体脂趋势'}</Text>
    <View style={j.wrap}><Text style={j.big}>{latest === undefined ? '暂无记录' : `${latest.toFixed(1)} ${unit}`}</Text>{change !== undefined && <Text style={[j.badge, { alignSelf: 'center' }]}>{change < 0 ? '↓' : change > 0 ? '↑' : '→'} {Math.abs(change).toFixed(1)} {unit}</Text>}</View>
    {last ? <Svg width="100%" height={190} viewBox="0 0 330 190" accessibilityLabel={`${rows.length} 条真实记录的趋势`}>
      <Defs><LinearGradient id={id} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#40dca7" stopOpacity={0.35} /><Stop offset="1" stopColor="#40dca7" stopOpacity={0.02} /></LinearGradient></Defs>
      {[0, 1, 2, 3].map(index => <React.Fragment key={index}><SvgText x={0} y={46 + index * 115 / 3} fontSize={11} fill="#83918b">{(max - index * (max - min) / 3).toFixed(1)}</SvgText><Line x1={38} x2={298} y1={42 + index * 115 / 3} y2={42 + index * 115 / 3} stroke="#edf4ef" /></React.Fragment>)}
      {points.length > 1 && <><Path d={`${path} L ${last.x} 157 L ${points[0].x} 157 Z`} fill={`url(#${id})`} /><Path d={path} stroke="#1bbc8c" strokeWidth={2.5} fill="none" /></>}
      {points.map((point, index) => <Circle key={index} cx={point.x} cy={point.y} r={2} fill="#1bbc8c" />)}
      <Circle cx={last.x} cy={last.y} r={5} fill="#0c9e7b" /><Rect x={Math.max(38, last.x - 23)} y={last.y - 32} width={48} height={24} rx={8} fill="#087e6b" /><SvgText x={Math.max(38, last.x - 23) + 24} y={last.y - 16} textAnchor="middle" fontSize={12} fill="white">{latest?.toFixed(1)}</SvgText>
      {[0, 1, 2, 3].map(index => { const date = todayISO(new Date(startTime + (endTime - startTime) * index / 3)); return <SvgText key={index} x={38 + index * 260 / 3} y={181} textAnchor="middle" fontSize={11} fill="#83918b">{date.slice(5).replace('-', '/')}</SvgText>; })}
    </Svg> : <Text style={j.muted}>所选时段没有记录，添加后显示真实趋势。</Text>}
    <Text style={j.muted}>{rows.length === 1 ? '仅 1 次记录，暂不绘制连线。' : '变化值为所选时段首末两次记录之差。'}{rows.length > 0 ? ` 最近记录：${rows.at(-1)?.date}` : ''}</Text>
  </View>;
}

export function BodyRecordsScreen({ records, profile, onAdd, onSaveProfile }: { records: BodyRecord[]; profile: Profile; onAdd: () => void; onSaveProfile: (profile: Profile) => Promise<void> }) {
  const [range, setRange] = useState(90); const [edit, setEdit] = useState(false);
  const [weight, setWeight] = useState(''); const [waist, setWaist] = useState('');
  const { busy, error, run } = useSaveAction();
  const current = withLatestMeasurements(profile, records); const goal = profile.bodyGoal;
  const today = todayISO(); const start = addDays(today, -(range - 1)); const rows = trendRecords(records, start, today);
  const openGoal = () => { setWeight(goal?.targetWeight?.toString() ?? ''); setWaist(goal?.targetWaist?.toString() ?? ''); setEdit(true); };
  return <><ScrollView contentContainerStyle={[j.content, { paddingBottom: 110 }]}>
    <View style={j.row}><Text style={j.heading}>身体变化</Text><Button title="＋ 记录" onPress={onAdd} /></View>
    <View style={j.wrap}>{[[30, '最近 30 天'], [90, '最近 3 个月'], [365, '最近 1 年']].map(([value, label]) => <Button key={value} title={String(label)} secondary={range !== value} onPress={() => setRange(Number(value))} />)}</View>
    <Trend records={rows} metric="weight" start={start} end={today} /><Trend records={rows} metric="waist" start={start} end={today} />
    <View style={j.card}><View style={j.row}><Text style={j.title}>目标进度</Text><Button title={goal ? '修改目标' : '设置目标'} secondary onPress={openGoal} /></View>
      <View style={[j.row, { alignItems: 'flex-start' }]}>{(['weight', 'waist'] as const).map(metric => {
        const target = metric === 'weight' ? goal?.targetWeight : goal?.targetWaist; const baseline = metric === 'weight' ? goal?.startWeight : goal?.startWaist;
        const progress = target !== undefined && baseline !== undefined ? goalProgress(baseline, current[metric], target) : 0;
        return <View key={metric} style={[j.grow, { gap: 10 }]}><Text style={j.muted}>{metric === 'weight' ? '体重目标' : '腰围目标'}</Text><Text style={j.title}>{current[metric].toFixed(1)} / {target ?? '未设置'} {metric === 'weight' ? 'kg' : 'cm'}</Text><View style={j.progress}><View style={[j.fill, { width: `${progress}%` }]} /></View><Text style={j.badge}>{target === undefined ? '设置后显示进度' : `${progress}%`}</Text></View>;
      })}</View><Text style={j.muted}>{goal ? `起点 ${goal.startDate}：${goal.startWeight} kg / ${goal.startWaist} cm。进度按起点到目标的变化计算。` : '设置自己的体重或腰围目标，支持减重与增重。'}</Text>
    </View>
    {rows.some(record => record.bodyFat != null) && <Trend records={rows} metric="bodyFat" start={start} end={today} />}
    <View style={j.card}><Text style={j.title}>最近记录</Text>{records.slice(0, 12).map(record => <View key={record.id} style={j.divider}><Text style={j.muted}>{record.date}</Text><Text style={j.text}>{record.weight} kg · {record.waist} cm{record.bodyFat != null ? ` · 体脂 ${record.bodyFat}%` : ''}</Text></View>)}{!records.length && <Text style={j.muted}>点击右上角记录今天的数据。</Text>}</View>
  </ScrollView>{edit && <JournalModal title="设置身体目标" onClose={() => setEdit(false)} busy={busy}><Text style={j.muted}>首次设置以当前身体数据作为起点；修改目标保留原起点。</Text><Input label="目标体重（kg，选填）" value={weight} onChangeText={setWeight} numeric /><Input label="目标腰围（cm，选填）" value={waist} onChangeText={setWaist} numeric /><ErrorText error={error} /><Button title={busy ? '保存中…' : '保存目标'} disabled={busy} onPress={() => { void run(async () => {
    const bodyGoal = { startDate: goal?.startDate ?? today, startWeight: goal?.startWeight ?? current.weight, startWaist: goal?.startWaist ?? current.waist, targetWeight: weight.trim() ? parseNumber(weight) : undefined, targetWaist: waist.trim() ? parseNumber(waist) : undefined };
    validateBodyGoal(bodyGoal); await onSaveProfile({ ...profile, bodyGoal }); setEdit(false);
  }); }} /></JournalModal>}</>;
}
