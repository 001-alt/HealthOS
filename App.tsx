import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Directory, File, Paths } from 'expo-file-system';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { addBodyRecord, loadCoachAdvice, loadProfile, loadRecords, resetDatabase, saveProfile } from './src/database/sqlite';
import { ActivityLevel, BodyRecord, DailyCheck, Goal, Profile } from './src/types';
import { bmiLabel, calculateMetrics } from './src/utils/healthCalculator';
import { withLatestMeasurements, todayISO } from './src/utils/measurements';
import { assertValid, parseProfileDraft, toProfileDraft, validateBodyRecord, validateProfile, type ProfileDraft } from './src/utils/validation';
import { useDailyCheck } from './src/hooks/useDailyCheck';
import { useJournal } from './src/hooks/useJournal';
import { FoodDiaryModal } from './src/components/FoodDiaryModal';
import { WorkoutModal } from './src/components/WorkoutModal';
import { BodyRecordsScreen } from './src/components/BodyRecordsScreen';
import { CoachModal } from './src/components/CoachModal';
import { proteinTotal, sourceLabels, workoutStatus } from './src/utils/journal';

const green = '#0f8f77';
const dark = '#123c3d';
const pale = '#e9f8f2';
const goals: Goal[] = ['健康匀称', '精瘦', '腹肌明显', '增肌', '降低体脂'];
const activities: ActivityLevel[] = ['久坐', '轻度活动', '中度活动', '高强度活动'];
const durations = ['4', '8', '12'] as const;
const initialProfile: Profile = { age: 28, gender: '男', height: 175, weight: 70, waist: 82, goal: '健康匀称', duration: 8, activity: '中度活动' };

type RecordTab = 'overview' | 'weight' | 'waist' | 'bodyFat';
type AppTab = 'home' | 'records' | 'training' | 'profile';
type DailyMetric = 'water' | 'steps' | 'sleep';
type RecordDraft = { weight: string; waist: string; bodyFat: string };

function optionalNumber(value: string) {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function metricChange(records: BodyRecord[], metric: 'weight' | 'waist') {
  if (records.length < 2) return '记录两次后显示变化';
  const difference = records[0][metric] - records[1][metric];
  const unit = metric === 'weight' ? 'kg' : 'cm';
  const precision = metric === 'weight' ? 1 : 0;
  if (Math.abs(difference) < 0.05) return '与上次记录持平';
  return difference < 0 ? `较上次减少 ${Math.abs(difference).toFixed(precision)} ${unit}` : `较上次增加 ${difference.toFixed(precision)} ${unit}`;
}

const PHOTO_FOLDER = 'photos';

function photoExtension(asset: ImagePicker.ImagePickerAsset) {
  const source = (asset.fileName || asset.uri || '').split('?')[0];
  const match = /\.([A-Za-z0-9]+)$/.exec(source);
  return match ? match[1].toLowerCase() : 'jpg';
}

// 选择器给的是 cache 目录里的临时文件，复制到 document 目录才不会随清缓存消失。
async function persistPhoto(sourceUri: string, extension: string) {
  const directory = new Directory(Paths.document, PHOTO_FOLDER);
  if (!directory.exists) directory.create({ intermediates: true });
  const target = new File(directory, `body-${Date.now()}.${extension}`);
  await new File(sourceUri).copy(target);
  return target.uri;
}

function isStoredPhoto(uri?: string) {
  return !!uri && uri.includes(`/${PHOTO_FOLDER}/`);
}

// 只清理我们自己目录里的旧照片，避免误删用户相册里的原图。
function removeStoredPhoto(uri?: string) {
  if (!isStoredPhoto(uri)) return;
  try { const file = new File(uri as string); if (file.exists) file.delete(); } catch { /* 清理失败不影响主流程 */ }
}

function Field({ label, value, onChangeText, keyboardType = 'numeric', inline = false, placeholder }: {
  label: string; value: string; onChangeText: (value: string) => void;
  keyboardType?: 'numeric' | 'default'; inline?: boolean; placeholder?: string;
}) {
  return <View style={[s.field, inline && s.fieldInline]}>
    <Text style={s.fieldLabel}>{label}</Text>
    <TextInput style={s.input} value={value} onChangeText={onChangeText} keyboardType={keyboardType} placeholder={placeholder} placeholderTextColor="#9caead" />
  </View>;
}

function ChoiceRow<T extends string>({ items, value, onChange }: { items: readonly T[]; value: T; onChange: (value: T) => void }) {
  return <View style={s.choiceWrap}>{items.map(item => <Pressable key={item} onPress={() => onChange(item)} style={[s.choice, value === item && s.choiceActive]}><Text style={[s.choiceText, value === item && s.choiceTextActive]}>{item}</Text></Pressable>)}</View>;
}

function Progress({ value, total, color = green }: { value: number; total: number; color?: string }) {
  return <View style={s.progress}><View style={[s.progressFill, { width: `${Math.min(100, total ? value / total * 100 : 0)}%`, backgroundColor: color }]} /></View>;
}

function Onboarding({ onDone }: { onDone: (profile: Profile) => void }) {
  const [profile, setProfile] = useState(initialProfile);
  const set = (key: keyof Profile, value: string | number | undefined) => setProfile(current => ({ ...current, [key]: value } as Profile));
  return <SafeAreaView style={s.safe} edges={['top']}><ScrollView contentContainerStyle={s.onboard} keyboardShouldPersistTaps="handled">
    <View style={s.logo}><Text style={s.logoLeaf}>◒</Text></View><Text style={s.brand}>Health<Text style={{ color: '#20b892' }}>OS</Text></Text><Text style={s.tagline}>你的个人 AI 健康操作系统</Text>
    <View style={s.welcome}><Text style={s.h1}>先了解你的身体</Text><Text style={s.muted}>这些数据只保存在你的设备上，用来计算更适合你的计划。</Text></View>
    <View style={s.card}><Text style={s.sectionTitle}>基本信息</Text>
      <View style={s.row}><Field inline label="年龄" value={String(profile.age)} onChangeText={value => set('age', Number(value) || 0)} /><Field inline label="身高（cm）" value={String(profile.height)} onChangeText={value => set('height', Number(value) || 0)} /></View>
      <View style={s.row}><Field inline label="当前体重（kg）" value={String(profile.weight)} onChangeText={value => set('weight', Number(value) || 0)} /><Field inline label="腰围（cm）" value={String(profile.waist)} onChangeText={value => set('waist', Number(value) || 0)} /></View>
      <Text style={s.fieldLabel}>可选围度</Text>
      <View style={s.row}><Field inline label="胸围（cm）" value={profile.chest?.toString() ?? ''} placeholder="可选" onChangeText={value => set('chest', optionalNumber(value))} /><Field inline label="臀围（cm）" value={profile.hip?.toString() ?? ''} placeholder="可选" onChangeText={value => set('hip', optionalNumber(value))} /></View>
      <View style={s.row}><Field inline label="手臂围（cm）" value={profile.arm?.toString() ?? ''} placeholder="可选" onChangeText={value => set('arm', optionalNumber(value))} /><Field inline label="体脂率（%）" value={profile.bodyFat?.toString() ?? ''} placeholder="可选" onChangeText={value => set('bodyFat', optionalNumber(value))} /></View>
      <Text style={s.fieldLabel}>性别</Text><ChoiceRow items={['男', '女'] as const} value={profile.gender} onChange={value => set('gender', value)} />
      <Text style={s.fieldLabel}>活动水平</Text><ChoiceRow items={activities} value={profile.activity} onChange={value => set('activity', value)} />
      <Text style={s.fieldLabel}>你的目标</Text><ChoiceRow items={goals} value={profile.goal} onChange={value => set('goal', value)} />
      <Text style={s.fieldLabel}>计划周期</Text><ChoiceRow items={durations} value={String(profile.duration) as typeof durations[number]} onChange={value => set('duration', Number(value))} />
    </View>
    <Pressable style={s.primaryButton} onPress={() => onDone(profile)}><Text style={s.primaryText}>开始我的健康计划  →</Text></Pressable>
  </ScrollView><StatusBar style="dark" /></SafeAreaView>;
}

function Home({ profile, records, check, setCheck, onCoach, advice, onEditMetric, coachLoading, todayJournal, onOpenFood, onOpenWorkout }: { profile: Profile; records: BodyRecord[]; check: DailyCheck; setCheck: React.Dispatch<React.SetStateAction<DailyCheck>>; onCoach: () => void; advice: string; onEditMetric: (metric: DailyMetric) => void; coachLoading: boolean; todayJournal?: import('./src/types').DayJournal; onOpenFood: () => void; onOpenWorkout: () => void }) {
  const current = useMemo(() => withLatestMeasurements(profile, records), [profile, records]);
  const metrics = useMemo(() => calculateMetrics(current), [current]);
  const checks: { key: keyof DailyCheck; icon: string; title: string; detail: string; metric?: DailyMetric }[] = [
    { key: 'protein', icon: '🥗', title: '蛋白质摄入', detail: todayJournal ? todayJournal.legacyProtein && !todayJournal.foods.length ? '旧版已打卡，待补食物明细' : `${proteinTotal(todayJournal.foods)} / ${todayJournal.proteinTarget} g · ${todayJournal.foods.length} 项食物` : '加载当天饮食记录', metric: undefined },
    { key: 'water', icon: '💧', title: '饮水达到 2500 ml', detail: check.waterMl ? `${check.waterMl} / 2500 ml` : '输入今天饮水量', metric: 'water' },
    { key: 'exercise', icon: '🏋️', title: '今日训练', detail: todayJournal ? `${todayJournal.plan.title} · ${sourceLabels[todayJournal.plan.source]} · ${workoutStatus(todayJournal, todayISO())}` : '加载当天训练计划' },
    { key: 'steps', icon: '🚶', title: '8000 步', detail: check.stepsCount ? `${check.stepsCount} / 8000 步` : '输入今天步数', metric: 'steps' },
    { key: 'sleep', icon: '🌙', title: '睡眠 7 小时', detail: check.sleepHours ? `${check.sleepHours.toFixed(1)} / 7 小时` : '输入昨晚睡眠时长', metric: 'sleep' },
  ];
  return <ScrollView contentContainerStyle={s.content}>
    <View style={s.topline}><View><Text style={s.eyebrow}>早上好</Text><Text style={s.h1}>今天也继续坚持。</Text></View><Text style={s.bell}>♧</Text></View>
    <View style={s.statusCard}><View style={s.statusHeader}><Text style={s.statusTitle}>今日状态</Text><Text style={s.dateText}>{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</Text></View><View style={s.metricRow}>
      <View><Text style={s.statusLabel}>体重</Text><Text style={s.metricValue}>{current.weight.toFixed(1)}<Text style={s.metricUnit}> kg</Text></Text><Text style={s.down}>{metricChange(records, 'weight')}</Text></View>
      <View><Text style={s.statusLabel}>腰围</Text><Text style={s.metricValue}>{current.waist.toFixed(0)}<Text style={s.metricUnit}> cm</Text></Text><Text style={s.down}>{metricChange(records, 'waist')}</Text></View>
      <View><Text style={s.statusLabel}>BMI</Text><Text style={s.metricValue}>{metrics.bmi.toFixed(1)}</Text><Text style={s.down}>{bmiLabel(metrics.bmi)}</Text></View>
    </View></View>
    <View style={s.quickRow}>
      <Pressable style={s.quickCard} onPress={onOpenFood}><Text style={s.quickIcon}>🥩</Text><Text style={s.quickValue}>{todayJournal ? `${proteinTotal(todayJournal.foods)}g` : '--'}</Text><Text style={s.quickLabel}>今日蛋白质</Text><Progress value={todayJournal ? proteinTotal(todayJournal.foods) : 0} total={todayJournal?.proteinTarget ?? metrics.protein} /></Pressable>
      <Pressable style={s.quickCard} onPress={() => onEditMetric('water')}><Text style={s.quickIcon}>💧</Text><Text style={s.quickValue}>{check.waterMl ? `${check.waterMl}ml` : '待记录'}</Text><Text style={s.quickLabel}>每日饮水</Text><Progress value={check.waterMl ?? 0} total={2500} color="#4f9fea" /></Pressable>
      <Pressable style={s.quickCard} onPress={onOpenWorkout}><Text style={s.quickIcon}>🏋️</Text><Text style={s.quickValue}>{todayJournal ? workoutStatus(todayJournal, todayISO()) : '--'}</Text><Text style={s.quickLabel}>今日训练</Text><Progress value={todayJournal?.plan.actions.length ? (todayJournal.plan.actions.filter(action => todayJournal.workout?.results.some(result => result.actionId === action.id && result.done)).length / todayJournal.plan.actions.length) : 0} total={1} color="#ef9f3b" /></Pressable>
    </View>
    <View style={s.aiCard}><View style={s.aiTitleRow}><Text style={s.aiSpark}>✦</Text><Text style={s.sectionTitle}>AI 今日建议</Text></View><Text style={s.aiText}>{advice || `你的 BMI 为 ${metrics.bmi.toFixed(1)}（${bmiLabel(metrics.bmi)}）。今天保持${profile.activity}的活动节奏，优先完成 ${metrics.protein}g 蛋白质目标。`}</Text><Pressable onPress={onCoach} style={s.aiAction} disabled={coachLoading}><Text style={s.aiActionText}>{coachLoading ? 'AI 教练正在整理建议…' : '让 AI 教练给我更具体的建议  ›'}</Text></Pressable></View>
    <View style={s.sectionHead}><Text style={s.sectionTitle}>今日计划</Text><Text style={s.muted}>完成度 {([proteinTotal(todayJournal?.foods ?? []) >= (todayJournal?.proteinTarget ?? metrics.protein), check.water, !!todayJournal && workoutStatus(todayJournal, todayISO()) === '已完成', check.steps, check.sleep] as const).filter(Boolean).length}/5</Text></View>
    <View style={s.card}>{checks.map(item => <Pressable key={item.key} style={s.checkRow} onPress={() => item.key === 'protein' ? onOpenFood() : item.key === 'exercise' ? onOpenWorkout() : item.metric ? onEditMetric(item.metric) : setCheck(current => ({ ...current, [item.key]: !current[item.key] }))}><Text style={s.checkIcon}>{item.icon}</Text><View style={s.checkCopy}><Text style={s.checkTitle}>{item.title}</Text><Text style={s.checkDetail}>{item.detail}</Text></View><View style={[s.circle, (item.key === 'protein' ? !!todayJournal && proteinTotal(todayJournal.foods) >= (todayJournal.proteinTarget ?? metrics.protein) : item.key === 'exercise' ? !!todayJournal && workoutStatus(todayJournal, todayISO()) === '已完成' : check[item.key]) ? s.circleDone : undefined]}><Text style={s.circleText}>{(item.key === 'protein' ? !!todayJournal && proteinTotal(todayJournal.foods) >= (todayJournal.proteinTarget ?? metrics.protein) : item.key === 'exercise' ? !!todayJournal && workoutStatus(todayJournal, todayISO()) === '已完成' : check[item.key]) ? '✓' : ''}</Text></View></Pressable>)}</View>
  </ScrollView>;
}

function Records({ records, onAdd }: { records: BodyRecord[]; onAdd: () => void }) {
  const [selectedTab, setSelectedTab] = useState<RecordTab>('overview');
  const values = records.slice(0, 7).reverse();
  const renderChart = (metric: Exclude<RecordTab, 'overview'>) => {
    const source = metric === 'bodyFat' ? values.filter(record => typeof record.bodyFat === 'number') : values;
    const title = metric === 'weight' ? '体重趋势' : metric === 'waist' ? '腰围趋势' : '体脂趋势';
    const unit = metric === 'weight' ? 'kg' : metric === 'waist' ? 'cm' : '%';
    const color = metric === 'bodyFat' ? '#ef9f3b' : '#50cda5';
    const emptyHint = metric === 'bodyFat' ? '还没有体脂记录，点击右上角 ＋ 后填写体脂率。' : `还没有${metric === 'weight' ? '体重' : '腰围'}记录，点击右上角 ＋ 开始记录今天。`;
    if (!source.length) return <View style={s.card}><Text style={s.statusLabel}>{title}</Text><Text style={s.muted}>{emptyHint}</Text></View>;
    const getValue = (record: BodyRecord) => metric === 'weight' ? record.weight : metric === 'waist' ? record.waist : record.bodyFat ?? 0;
    const latest = source[source.length - 1]; const latestValue = getValue(latest);
    const max = Math.max(...source.map(getValue), latestValue + 1); const min = Math.min(...source.map(getValue), latestValue - 1); const span = Math.max(1, max - min);
    return <View style={s.card}><View style={s.chartHeader}><View><Text style={s.statusLabel}>{title}</Text><Text style={s.bigNumber}>{latestValue.toFixed(metric === 'waist' ? 0 : 1)} <Text style={s.metricUnit}>{unit}</Text></Text></View><Text style={s.down}>最近记录</Text></View><View style={s.chart}>{source.map((record, index) => <View key={record.id || index} style={s.barWrap}><View style={[s.bar, { height: `${Math.max(18, (getValue(record) - min) / span * 100)}%`, backgroundColor: color }]} /><Text style={s.barLabel}>{record.date.slice(5)}</Text></View>)}</View></View>;
  };
  return <ScrollView contentContainerStyle={s.content}><View style={s.topline}><View><Text style={s.eyebrow}>长期记录</Text><Text style={s.h1}>身体变化</Text></View><Pressable style={s.addCircle} onPress={onAdd}><Text style={s.addText}>＋</Text></Pressable></View><View style={s.tabRow}>{([['overview', '总览'], ['weight', '体重'], ['waist', '腰围'], ['bodyFat', '体脂']] as const).map(([key, label]) => <Pressable key={key} onPress={() => setSelectedTab(key)} style={[s.tab, selectedTab === key && s.tabActive]}><Text style={[s.tabText, selectedTab === key && s.tabTextActive]}>{label}</Text></Pressable>)}</View>{selectedTab === 'overview' ? <>{renderChart('weight')}{renderChart('waist')}</> : renderChart(selectedTab)}<View style={s.sectionHead}><Text style={s.sectionTitle}>最近记录</Text><Text style={s.muted}>{records.length} 条</Text></View><View style={s.card}>{records.length === 0 ? <Text style={s.muted}>还没有记录，点击右上角 ＋ 开始记录今天。</Text> : records.slice(0, 8).map(record => <View key={record.id} style={s.recordRow}><Text style={s.recordDate}>{record.date}</Text><Text style={s.recordValue}>{record.weight.toFixed(1)} kg</Text><Text style={s.recordValue}>{record.waist.toFixed(0)} cm</Text>{typeof record.bodyFat === 'number' && <Text style={s.recordValue}>{record.bodyFat.toFixed(1)}%</Text>}</View>)}</View></ScrollView>;
}

function TrainingScreen({ profile, days, today, onOpen }: { profile: Profile; days: Record<string, import('./src/types').DayJournal>; today: string; onOpen: (date: string) => void }) {
  const visibleDays = Object.values(days).filter(day => day.date >= today || new Date(`${day.date}T12:00:00`).getDay() >= 0).sort((a, b) => a.date.localeCompare(b.date));
  return <ScrollView contentContainerStyle={s.content}><Text style={s.eyebrow}>{profile.goal} · {profile.duration} 周计划</Text><Text style={s.h1}>本周训练</Text><Text style={[s.muted, s.trainingIntro]}>每张卡片都绑定具体日期；计划内容、实际完成量和来源会一起保存。</Text>{visibleDays.map(day => <Pressable key={day.date} style={s.card} onPress={() => onOpen(day.date)}><View style={s.trainingHeader}><Text style={s.trainingDay}>{day.date.slice(5).replace('-', '/')}</Text><Text style={s.sectionTitle}>{day.plan.title}</Text></View><Text style={s.trainingActions}>{day.plan.actions.length ? day.plan.actions.map(action => `${action.name} ${action.target}`).join(' · ') : '休息恢复'}</Text><Text style={s.muted}>{day.plan.source === 'ai' ? '来源：AI 建议' : day.plan.source === 'custom' ? '来源：自定义' : '来源：系统模板'} · {workoutStatus(day, today)}</Text>{day.workout && <Text style={s.trainingActions}>实际：{day.workout.results.filter(result => result.done).map(result => `${day.plan.actions.find(action => action.id === result.actionId)?.name} ${result.actual}`).join(' · ') || '已打开记录但未勾选动作'}</Text>}<Text style={s.close}>查看/编辑这一天 ›</Text></Pressable>)}{!visibleDays.length && <View style={s.card}><Text style={s.muted}>正在加载本周日期…</Text></View>}<Pressable style={s.primaryButton} onPress={() => onOpen(today)}><Text style={s.primaryText}>记录今天训练 · {today.slice(5).replace('-', '/')}</Text></Pressable></ScrollView>;
}

function ProfileScreen({ profile, records, onEdit, onKey, onPhoto }: { profile: Profile; records: BodyRecord[]; onEdit: () => void; onKey: () => void; onPhoto: () => void }) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const current = withLatestMeasurements(profile, records);
  const metrics = calculateMetrics(current);
  const photoUri = profile.photoUri && profile.photoUri !== failedUri ? profile.photoUri : undefined;
  const rows: [string, string][] = [['年龄', `${profile.age} 岁`], ['性别', profile.gender], ['身高', `${profile.height} cm`], ['体重', `${current.weight} kg`], ['腰围', `${current.waist} cm`], ...(profile.chest ? [['胸围', `${profile.chest} cm`] as [string, string]] : []), ...(profile.hip ? [['臀围', `${profile.hip} cm`] as [string, string]] : []), ...(profile.arm ? [['手臂围', `${profile.arm} cm`] as [string, string]] : []), ...(current.bodyFat ? [['体脂率', `${current.bodyFat}%`] as [string, string]] : []), ['BMI', `${metrics.bmi.toFixed(1)} · ${bmiLabel(metrics.bmi)}`]];
  return <ScrollView contentContainerStyle={s.content}><Text style={s.eyebrow}>个人空间</Text><Text style={s.h1}>我的计划</Text><View style={s.profileHero}>{photoUri ? <Image source={{ uri: photoUri }} style={s.avatarImage} contentFit="cover" onError={() => setFailedUri(photoUri)} /> : <View style={s.avatar}><Text style={s.avatarText}>H</Text></View>}<View><Text style={s.profileName}>我的健康档案</Text><Text style={s.muted}>{profile.goal} · {profile.duration} 周计划</Text></View></View><View style={s.card}><Text style={s.sectionTitle}>身体档案</Text>{rows.map(([key, value]) => <View style={s.infoRow} key={key}><Text style={s.muted}>{key}</Text><Text style={s.infoValue}>{value}</Text></View>)}<Text style={s.cardHint}>体重与腰围取自最新一条身体记录。</Text><Pressable style={s.outlineButton} onPress={onEdit}><Text style={s.outlineText}>编辑身体档案</Text></Pressable></View><View style={s.card}><Text style={s.sectionTitle}>身体照片</Text><Text style={s.muted}>照片只保存在本机，用于对比身体变化。</Text>{photoUri && <Image source={{ uri: photoUri }} style={s.bodyPhoto} contentFit="cover" onError={() => setFailedUri(photoUri)} />}{profile.photoUri && !photoUri && <Text style={s.photoWarning}>照片已失效，请重新选择。</Text>}<Pressable style={s.outlineButton} onPress={onPhoto}><Text style={s.outlineText}>{profile.photoUri ? '更换照片' : '添加身体照片'}</Text></Pressable></View><View style={s.card}><Text style={s.sectionTitle}>AI 教练</Text><Text style={s.muted}>配置自己的 DeepSeek API Key，生成个性化建议。</Text><Pressable style={s.outlineButton} onPress={onKey}><Text style={s.outlineText}>配置 API Key</Text></Pressable></View><Text style={s.disclaimer}>HealthOS 只提供生活方式建议，不能替代医生诊断或治疗。</Text></ScrollView>;
}

function HealthOSApp() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [records, setRecords] = useState<BodyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<Error | null>(null);
  const [tab, setTab] = useState<AppTab>('home');
  const [advice, setAdvice] = useState('');
  const [profileModal, setProfileModal] = useState(false);
  const [recordModal, setRecordModal] = useState(false);
  const [keyModal, setKeyModal] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [draft, setDraft] = useState<ProfileDraft>(toProfileDraft(initialProfile));
  const [newRecord, setNewRecord] = useState<RecordDraft>({ weight: '', waist: '', bodyFat: '' });
  const [dailyMetric, setDailyMetric] = useState<DailyMetric | null>(null);
  const [dailyMetricValue, setDailyMetricValue] = useState('');
  const { check, updateCheck, error: checkError, refresh: refreshCheck } = useDailyCheck(!!profile);
  const [journalModal, setJournalModal] = useState<'food' | 'workout' | null>(null);
  const [journalDate, setJournalDate] = useState(todayISO());
  const { today: journalToday, days: journalDays, error: journalError, refresh: refreshJournal, loadWeek: loadJournalWeek, updateDay } = useJournal(profile, profile ? calculateMetrics(withLatestMeasurements(profile, records)).protein : 0);
  const [coachModal, setCoachModal] = useState(false);

  const initialize = useCallback(async () => {
    setLoading(true); setInitError(null);
    try {
      let loaded: [Profile | null, BodyRecord[], string | null];
      try { loaded = await Promise.all([loadProfile(), loadRecords(), loadCoachAdvice()]); } catch (error) { console.error('HealthOS database initialization failed', error); throw new Error(`本地数据库初始化失败：${error instanceof Error ? error.message : String(error)}`); }
      let key: string | null;
      try { key = await SecureStore.getItemAsync('deepseek_api_key'); } catch (error) { console.error('HealthOS secure storage initialization failed', error); throw new Error(`安全存储初始化失败：${error instanceof Error ? error.message : String(error)}`); }
      const [loadedProfile, loadedRecords, savedAdvice] = loaded;
      setProfile(loadedProfile); setDraft(toProfileDraft(loadedProfile || initialProfile)); setRecords(loadedRecords); setAdvice(savedAdvice || ''); setApiKey(key || '');
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error)); console.error('HealthOS initialization failed', normalized); setInitError(normalized);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void initialize(); }, [initialize]);

  const resetLocalData = async () => { setLoading(true); setProfile(null); try { await resetDatabase(); await initialize(); } catch (error) { const normalized = error instanceof Error ? error : new Error(String(error)); console.error('HealthOS local data reset failed', normalized); setInitError(normalized); setLoading(false); } };
  if (loading) return <View style={s.loading}><ActivityIndicator size="large" color={green} /><Text style={s.muted}>正在打开你的健康空间…</Text></View>;
  if (initError) return <SafeAreaView style={s.safe} edges={['top']}><View style={s.errorScreen}><Text style={s.errorIcon}>!</Text><Text style={s.h1}>无法打开健康空间</Text><Text style={s.errorText}>{initError.message}</Text><Pressable style={s.primaryButton} onPress={() => { void initialize(); }}><Text style={s.primaryText}>重试</Text></Pressable><Pressable style={s.outlineButton} onPress={() => Alert.alert('重置本地数据', '这会删除本机保存的档案、记录和每日打卡，且无法撤销。', [{ text: '取消', style: 'cancel' }, { text: '继续重置', style: 'destructive', onPress: () => { void resetLocalData(); } }])}><Text style={s.outlineText}>重置本地数据</Text></Pressable></View><StatusBar style="dark" /></SafeAreaView>;
  if (!profile) return <Onboarding onDone={async value => { try { await saveProfile(value); setProfile(value); setDraft(toProfileDraft(value)); } catch (error) { console.error('HealthOS profile save failed', error); Alert.alert('保存失败', error instanceof Error ? error.message : '档案未能保存，请重试。'); } }} />;

  const openDailyMetric = (metric: DailyMetric) => { setDailyMetric(metric); setDailyMetricValue(metric === 'water' ? (check.waterMl?.toString() ?? '') : metric === 'steps' ? (check.stepsCount?.toString() ?? '') : (check.sleepHours?.toString() ?? '')); };
  const openJournal = (kind: 'food' | 'workout', date = journalToday) => { setJournalDate(date); setJournalModal(kind); };
  const saveDailyMetricValue = () => { const value = Number(dailyMetricValue); if (!dailyMetric || !Number.isFinite(value) || value <= 0) return Alert.alert('还差一点', '请输入大于 0 的数值。'); if (dailyMetric === 'water' && value > 20000) return Alert.alert('饮水量不合理', '请输入今天实际饮水量（单位：ml）。'); if (dailyMetric === 'steps' && value > 200000) return Alert.alert('步数不合理', '请输入今天实际步数。'); if (dailyMetric === 'sleep' && value > 24) return Alert.alert('睡眠时长不合理', '请输入 24 小时以内的睡眠时长。'); updateCheck(current => dailyMetric === 'water' ? { ...current, waterMl: Math.round(value), water: value >= 2500 } : dailyMetric === 'steps' ? { ...current, stepsCount: Math.round(value), steps: value >= 8000 } : { ...current, sleepHours: value, sleep: value >= 7 }); setDailyMetric(null); setDailyMetricValue(''); };
  const saveDraft = async () => { const normalized = parseProfileDraft(draft); try { assertValid(validateProfile(normalized)); await saveProfile(normalized); setProfile(normalized); setProfileModal(false); } catch (error) { Alert.alert('档案未保存', error instanceof Error ? error.message : '请检查输入范围。'); } };
  const addRecord = async () => { const weight = Number(newRecord.weight); const waist = Number(newRecord.waist); const bodyFat = newRecord.bodyFat.trim() ? Number(newRecord.bodyFat) : undefined; try { assertValid(validateBodyRecord({ weight, waist, bodyFat })); await addBodyRecord({ date: todayISO(), weight, waist, bodyFat }); setRecords(await loadRecords()); setRecordModal(false); setNewRecord({ weight: '', waist: '', bodyFat: '' }); } catch (error) { Alert.alert('记录未保存', error instanceof Error ? error.message : '请检查输入范围。'); } };
  const pickPhoto = async () => { try { const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [3, 4], quality: 0.8 }); const asset = result.assets?.[0]; if (result.canceled || !asset?.uri) return; const uri = await persistPhoto(asset.uri, photoExtension(asset)); const updated = { ...profile, photoUri: uri }; await saveProfile(updated); if (uri !== profile.photoUri) removeStoredPhoto(profile.photoUri); setProfile(updated); setDraft(toProfileDraft(updated)); } catch (error) { console.error('HealthOS photo selection failed', error); Alert.alert('照片保存失败', '无法保存这张照片，请重试。'); } };
  const saveKey = async () => { try { await SecureStore.setItemAsync('deepseek_api_key', apiKey.trim()); setKeyModal(false); Alert.alert('已保存', 'API Key 只保存在本机安全存储中。'); } catch (error) { console.error('HealthOS API key save failed', error); Alert.alert('保存失败', 'API Key 未能保存，请重试。'); } };
  const navItems: [AppTab, string, string][] = [['home', '⌂', '首页'], ['records', '▥', '记录'], ['training', '⚑', '训练'], ['profile', '◉', '我的']];
  return <SafeAreaView style={s.safe} edges={['top']}><View style={s.app}><View style={s.header}><Text style={s.headerBrand}>Health<Text style={{ color: '#21b994' }}>OS</Text></Text><Text style={s.headerSub}>个人健康操作系统</Text></View>{(checkError || journalError) && <Pressable onPress={() => { refreshCheck(); refreshJournal(); }} style={s.syncError}><Text style={s.syncErrorText}>{checkError || journalError} · 重试</Text></Pressable>}{tab === 'home' && <Home profile={profile} records={records} check={check} setCheck={updateCheck} onCoach={() => { setCoachModal(true); }} advice={journalDays[journalToday]?.coach?.summary ?? advice} onEditMetric={openDailyMetric} coachLoading={false} todayJournal={journalDays[journalToday]} onOpenFood={() => openJournal('food')} onOpenWorkout={() => openJournal('workout')} />}{tab === 'records' && <BodyRecordsScreen profile={profile} records={records} onAdd={() => setRecordModal(true)} onSaveProfile={async value => { await saveProfile(value); setProfile(value); setDraft(toProfileDraft(value)); }} />}{tab === 'training' && <TrainingScreen profile={profile} days={journalDays} today={journalToday} onOpen={date => openJournal('workout', date)} />}{tab === 'profile' && <ProfileScreen profile={profile} records={records} onEdit={() => { setDraft(toProfileDraft(profile)); setProfileModal(true); }} onKey={() => setKeyModal(true)} onPhoto={pickPhoto} />}<View style={s.nav}>{navItems.map(([key, icon, label]) => <Pressable key={key} onPress={() => setTab(key)} style={s.navItem}><Text style={[s.navIcon, tab === key && s.navSelected]}>{icon}</Text><Text style={[s.navLabel, tab === key && s.navSelected]}>{label}</Text></Pressable>)}</View></View>
    <Modal visible={profileModal} animationType="slide"><SafeAreaView style={s.modal} edges={['top']}><KeyboardAvoidingView style={s.modal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={s.modalContent} keyboardShouldPersistTaps="handled"><View style={s.modalHeader}><Text style={s.h1}>编辑身体档案</Text><Pressable onPress={() => setProfileModal(false)}><Text style={s.close}>关闭</Text></Pressable></View><View style={s.card}><View style={s.row}><Field inline label="年龄" value={draft.age} onChangeText={age => setDraft({ ...draft, age })} /><Field inline label="身高（cm）" value={draft.height} onChangeText={height => setDraft({ ...draft, height })} /></View><View style={s.row}><Field inline label="体重（kg）" value={draft.weight} onChangeText={weight => setDraft({ ...draft, weight })} /><Field inline label="腰围（cm）" value={draft.waist} onChangeText={waist => setDraft({ ...draft, waist })} /></View><Text style={s.fieldLabel}>可选围度</Text><View style={s.row}><Field inline label="胸围（cm）" value={draft.chest} placeholder="可选" onChangeText={chest => setDraft({ ...draft, chest })} /><Field inline label="臀围（cm）" value={draft.hip} placeholder="可选" onChangeText={hip => setDraft({ ...draft, hip })} /></View><View style={s.row}><Field inline label="手臂围（cm）" value={draft.arm} placeholder="可选" onChangeText={arm => setDraft({ ...draft, arm })} /><Field inline label="体脂率（%）" value={draft.bodyFat} placeholder="可选" onChangeText={bodyFat => setDraft({ ...draft, bodyFat })} /></View><Text style={s.fieldLabel}>目标</Text><ChoiceRow items={goals} value={draft.goal} onChange={goal => setDraft({ ...draft, goal })} /><Text style={s.fieldLabel}>活动水平</Text><ChoiceRow items={activities} value={draft.activity} onChange={activity => setDraft({ ...draft, activity })} /><Text style={s.fieldLabel}>计划周期</Text><ChoiceRow items={durations} value={String(draft.duration) as typeof durations[number]} onChange={duration => setDraft({ ...draft, duration: Number(duration) as Profile['duration'] })} /></View><Pressable style={s.primaryButton} onPress={saveDraft}><Text style={s.primaryText}>保存档案</Text></Pressable></ScrollView></KeyboardAvoidingView></SafeAreaView></Modal>
    <Modal visible={dailyMetric !== null} animationType="slide" transparent><KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={s.dialog}><View style={s.modalHeader}><Text style={s.sectionTitle}>{dailyMetric === 'water' ? '记录今日饮水' : dailyMetric === 'steps' ? '记录今日步数' : '记录昨晚睡眠'}</Text><Pressable onPress={() => setDailyMetric(null)}><Text style={s.close}>关闭</Text></Pressable></View><Field label={dailyMetric === 'water' ? '饮水量（ml）' : dailyMetric === 'steps' ? '步数' : '睡眠时长（小时）'} value={dailyMetricValue} onChangeText={setDailyMetricValue} placeholder="请输入" /><Pressable style={s.primaryButton} onPress={saveDailyMetricValue}><Text style={s.primaryText}>保存数据</Text></Pressable></View></KeyboardAvoidingView></Modal>
    <Modal visible={recordModal} animationType="slide" transparent><KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={s.dialog}><View style={s.modalHeader}><Text style={s.sectionTitle}>记录今天</Text><Pressable onPress={() => setRecordModal(false)}><Text style={s.close}>关闭</Text></Pressable></View><Field label="体重（kg）" value={newRecord.weight} onChangeText={value => setNewRecord({ ...newRecord, weight: value })} /><Field label="腰围（cm）" value={newRecord.waist} onChangeText={value => setNewRecord({ ...newRecord, waist: value })} /><Field label="体脂率（%）" value={newRecord.bodyFat} placeholder="选填" onChangeText={value => setNewRecord({ ...newRecord, bodyFat: value })} /><Pressable style={s.primaryButton} onPress={addRecord}><Text style={s.primaryText}>保存记录</Text></Pressable></View></KeyboardAvoidingView></Modal>
    <Modal visible={keyModal} animationType="slide" transparent><KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={s.dialog}><View style={s.modalHeader}><Text style={s.sectionTitle}>DeepSeek API Key</Text><Pressable onPress={() => setKeyModal(false)}><Text style={s.close}>关闭</Text></Pressable></View><Text style={s.muted}>从 DeepSeek 控制台复制 API Key，保存在本机安全存储中。</Text><TextInput style={[s.input, s.keyInput]} value={apiKey} onChangeText={setApiKey} placeholder="sk-..." placeholderTextColor="#9caead" autoCapitalize="none" secureTextEntry /><Pressable style={s.primaryButton} onPress={saveKey}><Text style={s.primaryText}>保存 Key</Text></Pressable></View></KeyboardAvoidingView></Modal>{journalModal === 'food' && <FoodDiaryModal initialDate={journalDate} days={journalDays} loadWeek={loadJournalWeek} updateDay={updateDay} onClose={() => setJournalModal(null)} />}{journalModal === 'workout' && <WorkoutModal initialDate={journalDate} days={journalDays} profile={profile} apiKey={apiKey} loadWeek={loadJournalWeek} updateDay={updateDay} onClose={() => { setJournalModal(null); refreshJournal(); }} />}{coachModal && <CoachModal day={journalDays[journalToday]} check={check} profile={profile} records={records} apiKey={apiKey} updateDay={updateDay} onClose={() => setCoachModal(false)} onFood={() => { setCoachModal(false); openJournal('food'); }} onWorkout={() => { setCoachModal(false); openJournal('workout'); }} onKey={() => { setCoachModal(false); setKeyModal(true); }} />}<StatusBar style="dark" />
  </SafeAreaView>;
}

export default function App() { return <SafeAreaProvider><HealthOSApp /></SafeAreaProvider>; }

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f7fbf9' },
  app: { flex: 1 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, backgroundColor: '#f7fbf9' },
  errorScreen: { flex: 1, justifyContent: 'center', padding: 28, backgroundColor: '#f7fbf9' },
  errorIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fce9e6', color: '#c25549', fontSize: 28, fontWeight: '800', textAlign: 'center', lineHeight: 44, marginBottom: 18 },
  errorText: { color: '#63807b', fontSize: 14, lineHeight: 22, marginTop: 10, marginBottom: 18 },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6, flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  headerBrand: { color: dark, fontSize: 26, fontWeight: '800', letterSpacing: -1 },
  headerSub: { color: '#7a9793', fontSize: 12 },
  content: { padding: 20, paddingBottom: 110 },
  onboard: { padding: 24, paddingBottom: 40 },
  logo: { width: 62, height: 62, borderRadius: 18, backgroundColor: '#25b991', justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginTop: 18 },
  logoLeaf: { color: 'white', fontSize: 36, transform: [{ rotate: '-35deg' }] },
  brand: { textAlign: 'center', color: dark, fontSize: 42, fontWeight: '800', letterSpacing: -2, marginTop: 12 },
  tagline: { textAlign: 'center', color: '#75918c', fontSize: 15, marginTop: 4 },
  welcome: { marginTop: 38, marginBottom: 18 },
  h1: { color: dark, fontSize: 25, fontWeight: '800', letterSpacing: -0.5 },
  eyebrow: { color: '#71908a', fontSize: 14, marginBottom: 5 },
  muted: { color: '#79928e', fontSize: 13, lineHeight: 20 },
  card: { backgroundColor: 'white', borderRadius: 20, padding: 18, marginBottom: 16, shadowColor: '#1a6558', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  sectionTitle: { color: dark, fontSize: 17, fontWeight: '800' },
  row: { flexDirection: 'row', gap: 12 },
  field: { marginBottom: 14 },
  fieldInline: { flex: 1, minWidth: 0 },
  fieldLabel: { color: '#64817c', fontSize: 12, marginBottom: 7, marginTop: 6 },
  input: { height: 46, borderRadius: 12, borderWidth: 1, borderColor: '#d9eae4', backgroundColor: '#fbfefd', paddingHorizontal: 13, color: dark, fontSize: 16 },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  choice: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 20, backgroundColor: '#f1f7f5', borderWidth: 1, borderColor: '#f1f7f5' },
  choiceActive: { backgroundColor: pale, borderColor: '#8bdbc5' },
  choiceText: { color: '#6b8782', fontSize: 13 },
  choiceTextActive: { color: green, fontWeight: '700' },
  primaryButton: { backgroundColor: '#087e6b', minHeight: 54, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginTop: 4, shadowColor: '#087e6b', shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  primaryButtonDone: { backgroundColor: '#24aa85' },
  primaryText: { color: 'white', fontSize: 16, fontWeight: '700' },
  topline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, marginBottom: 18 },
  bell: { color: green, fontSize: 27 },
  statusCard: { backgroundColor: '#0c8a76', borderRadius: 21, padding: 19, marginBottom: 14, shadowColor: '#0c8a76', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  statusHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  statusTitle: { color: 'white', fontSize: 16, fontWeight: '700' },
  dateText: { color: '#bce8d9', fontSize: 12 },
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  statusLabel: { color: '#71918c', fontSize: 12, marginBottom: 5 },
  metricValue: { color: 'white', fontSize: 23, fontWeight: '800' },
  metricUnit: { fontSize: 12, fontWeight: '500' },
  down: { color: '#45d4a6', fontSize: 12, marginTop: 4, maxWidth: 105 },
  quickRow: { flexDirection: 'row', gap: 9, marginBottom: 14 },
  quickCard: { flex: 1, backgroundColor: 'white', borderRadius: 16, padding: 12, shadowColor: '#1a6558', shadowOpacity: 0.05, shadowRadius: 8, elevation: 1 },
  quickIcon: { fontSize: 18, marginBottom: 8 },
  quickValue: { color: dark, fontSize: 16, fontWeight: '800' },
  quickLabel: { color: '#7b9691', fontSize: 11, marginTop: 2, marginBottom: 8 },
  progress: { height: 7, backgroundColor: '#e3f1ec', borderRadius: 5, overflow: 'hidden', marginTop: 8 },
  progressFill: { height: '100%', borderRadius: 5 },
  aiCard: { backgroundColor: '#ecfaf5', borderRadius: 18, padding: 17, marginBottom: 18 },
  aiTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  aiSpark: { color: '#00a887', fontSize: 21 },
  aiText: { color: '#376964', fontSize: 14, lineHeight: 22 },
  aiAction: { marginTop: 12 },
  aiActionText: { color: green, fontWeight: '700', fontSize: 13 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  checkRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#edf4f1' },
  checkIcon: { fontSize: 23, width: 40 },
  checkCopy: { flex: 1 },
  checkTitle: { color: dark, fontSize: 15, fontWeight: '700' },
  checkDetail: { color: '#86a09b', fontSize: 12, marginTop: 3 },
  circle: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: '#9dbbb4', alignItems: 'center', justifyContent: 'center' },
  circleDone: { backgroundColor: '#24ba8d', borderColor: '#24ba8d' },
  circleText: { color: 'white', fontWeight: '800' },
  nav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 76, paddingBottom: 9, backgroundColor: 'rgba(255,255,255,.97)', borderTopWidth: 1, borderTopColor: '#e6efeb', flexDirection: 'row', justifyContent: 'space-around' },
  navItem: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  navIcon: { color: '#94aaa5', fontSize: 22 },
  navLabel: { color: '#94aaa5', fontSize: 12, marginTop: 2 },
  navSelected: { color: green, fontWeight: '800' },
  addCircle: { backgroundColor: green, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  addText: { color: 'white', fontSize: 28, lineHeight: 30 },
  tabRow: { flexDirection: 'row', backgroundColor: '#edf6f3', borderRadius: 12, padding: 4, marginBottom: 16 },
  tab: { flex: 1, borderRadius: 9, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  tabActive: { backgroundColor: 'white' },
  tabText: { color: '#7b9691', fontSize: 13 },
  tabTextActive: { color: dark, fontWeight: '700' },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  bigNumber: { color: dark, fontSize: 27, fontWeight: '800', marginTop: 3 },
  chart: { height: 150, flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 20, paddingHorizontal: 4 },
  barWrap: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
  bar: { width: '65%', minHeight: 16, borderRadius: 5 },
  barLabel: { fontSize: 9, color: '#91a9a4', marginTop: 6 },
  recordRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#edf4f1', gap: 8 },
  recordDate: { color: '#63807b', fontSize: 13, flex: 1 },
  recordValue: { color: dark, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  profileHero: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#e8f8f2', borderRadius: 20, padding: 18, marginVertical: 18 },
  avatar: { backgroundColor: '#0c8a76', width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: 50, height: 50, borderRadius: 25 },
  avatarText: { color: 'white', fontSize: 24, fontWeight: '800' },
  profileName: { color: dark, fontSize: 17, fontWeight: '800', marginBottom: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#edf4f1' },
  infoValue: { color: dark, fontWeight: '700' },
  outlineButton: { borderWidth: 1, borderColor: '#b6dfd3', borderRadius: 22, minHeight: 44, justifyContent: 'center', alignItems: 'center', marginTop: 14 },
  outlineText: { color: green, fontWeight: '700' },
  bodyPhoto: { width: '100%', height: 220, borderRadius: 16, marginTop: 14, backgroundColor: '#e9f3ef' },
  cardHint: { color: '#79928e', fontSize: 12, lineHeight: 18, marginTop: 12 },
  photoWarning: { color: '#c25549', fontSize: 12, marginTop: 10 },
  disclaimer: { textAlign: 'center', color: '#98aaa6', fontSize: 11, paddingHorizontal: 24, marginTop: 4 },
  modal: { flex: 1, backgroundColor: '#f7fbf9' },
  modalContent: { padding: 20, paddingTop: 30, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  close: { color: green, fontWeight: '700' },
  overlay: { flex: 1, backgroundColor: 'rgba(14, 47, 44, .35)', justifyContent: 'flex-end' },
  dialog: { backgroundColor: '#f7fbf9', borderTopLeftRadius: 25, borderTopRightRadius: 25, padding: 22, paddingBottom: 35 },
  keyInput: { marginTop: 14, marginBottom: 16 },
  trainingIntro: { marginTop: 8, marginBottom: 18 },
  trainingHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  trainingDay: { color: green, fontSize: 13, fontWeight: '800', backgroundColor: pale, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10 },
  trainingActions: { color: dark, fontSize: 15, fontWeight: '700', lineHeight: 23, marginBottom: 8 },
  syncError: { backgroundColor: '#fff3e6', paddingHorizontal: 20, paddingVertical: 8 },
  syncErrorText: { color: '#a3611c', fontSize: 12, textAlign: 'center' },
});
