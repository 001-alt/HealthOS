import * as SQLite from 'expo-sqlite';
import { BodyRecord, DailyCheck, DayJournal, Profile } from '../types';
import { assertValid, validateBodyRecord, validateProfile } from '../utils/validation';
import { createDay, validateFood, validatePlan, validateWorkout } from '../utils/journal';
import { todayISO } from '../utils/measurements';

const SCHEMA: Record<string, string[]> = {
  profile: ['id', 'data'],
  body_records: ['id', 'date', 'weight', 'waist', 'body_fat'],
  daily_check: ['date', 'protein', 'water', 'exercise', 'steps', 'sleep', 'water_liters', 'steps_count', 'sleep_hours'],
  coach_advice: ['id', 'content', 'updated_at'],
  day_journal: ['date', 'data'],
};
const SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY NOT NULL, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS body_records (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, weight REAL NOT NULL, waist REAL NOT NULL, body_fat REAL);
  CREATE TABLE IF NOT EXISTS daily_check (date TEXT PRIMARY KEY NOT NULL, protein INTEGER NOT NULL DEFAULT 0, water INTEGER NOT NULL DEFAULT 0, exercise INTEGER NOT NULL DEFAULT 0, steps INTEGER NOT NULL DEFAULT 0, sleep INTEGER NOT NULL DEFAULT 0, water_liters REAL, steps_count INTEGER, sleep_hours REAL);
  CREATE TABLE IF NOT EXISTS coach_advice (id INTEGER PRIMARY KEY CHECK (id = 1), content TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS day_journal (date TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL);
`;
const OPEN_ATTEMPTS = 3;
let database: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

async function tableColumns(handle: SQLite.SQLiteDatabase, table: string) {
  return (await handle.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)).map(column => column.name);
}

async function migrate(handle: SQLite.SQLiteDatabase) {
  const versionRow = await handle.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = versionRow?.user_version ?? 0;

  if (version < 1) {
    const additions: [string, string, string][] = [
      ['body_records', 'body_fat', 'REAL'],
      ['daily_check', 'protein', 'INTEGER NOT NULL DEFAULT 0'],
      ['daily_check', 'water', 'INTEGER NOT NULL DEFAULT 0'],
      ['daily_check', 'exercise', 'INTEGER NOT NULL DEFAULT 0'],
      ['daily_check', 'steps', 'INTEGER NOT NULL DEFAULT 0'],
      ['daily_check', 'sleep', 'INTEGER NOT NULL DEFAULT 0'],
    ];
    for (const [table, column, type] of additions) {
      const columns = await tableColumns(handle, table);
      if (columns.length > 0 && !columns.includes(column)) {
        await handle.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
    }
    version = 1;
    await handle.execAsync('PRAGMA user_version = 1');
  }

  if (version < 2) {
    await handle.execAsync('CREATE TABLE IF NOT EXISTS coach_advice (id INTEGER PRIMARY KEY CHECK (id = 1), content TEXT NOT NULL, updated_at TEXT NOT NULL)');
    version = 2;
    await handle.execAsync('PRAGMA user_version = 2');
  }

  if (version < 3) {
    const additions: [string, string, string][] = [
      ['daily_check', 'water_liters', 'REAL'],
      ['daily_check', 'steps_count', 'INTEGER'],
      ['daily_check', 'sleep_hours', 'REAL'],
    ];
    for (const [table, column, type] of additions) {
      const columns = await tableColumns(handle, table);
      if (columns.length > 0 && !columns.includes(column)) await handle.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
    await handle.execAsync('PRAGMA user_version = 3');
    version = 3;
  }
  if (version < 4) await handle.execAsync('PRAGMA user_version = 4');
}

async function verifySchema(handle: SQLite.SQLiteDatabase) {
  for (const [table, expected] of Object.entries(SCHEMA)) {
    const present = await tableColumns(handle, table);
    if (present.length === 0) throw new Error(`数据表 ${table} 不存在`);
    const missing = expected.filter(column => !present.includes(column));
    if (missing.length) throw new Error(`数据表 ${table} 结构异常，缺少字段：${missing.join('、')}`);
  }
}

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  let lastError: unknown = new Error('数据库初始化失败');
  for (let attempt = 1; attempt <= OPEN_ATTEMPTS; attempt++) {
    let handle: SQLite.SQLiteDatabase | null = null;
    try {
      handle = await SQLite.openDatabaseAsync('healthos.db');
      await handle.execAsync(SCHEMA_SQL);
      await migrate(handle);
      await verifySchema(handle);
      return handle;
    } catch (error) {
      lastError = error;
      if (handle) await handle.closeAsync().catch(() => {});
      if (attempt < OPEN_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, attempt * 60));
    }
  }
  throw lastError;
}

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;
  if (!opening) opening = openDatabase().then(handle => { database = handle; return handle; }).finally(() => { opening = null; });
  return opening;
}

export async function loadProfile(): Promise<Profile | null> {
  const row = await (await db()).getFirstAsync<{ data: string }>('SELECT data FROM profile WHERE id = 1');
  return row ? JSON.parse(row.data) : null;
}

export async function saveProfile(profile: Profile) {
  assertValid(validateProfile(profile));
  await (await db()).runAsync('INSERT OR REPLACE INTO profile (id, data) VALUES (1, ?)', JSON.stringify(profile));
}

export async function loadRecords(): Promise<BodyRecord[]> {
  return await (await db()).getAllAsync<BodyRecord>('SELECT id, date, weight, waist, body_fat as bodyFat FROM body_records ORDER BY date DESC, id DESC');
}

export async function addBodyRecord(record: Omit<BodyRecord, 'id'>) {
  assertValid(validateBodyRecord(record));
  const handle = await db();
  const existing = await handle.getFirstAsync<{ id: number }>('SELECT id FROM body_records WHERE date = ? ORDER BY id DESC LIMIT 1', record.date);
  if (existing) {
    await handle.runAsync('UPDATE body_records SET weight = ?, waist = ?, body_fat = ? WHERE id = ?', record.weight, record.waist, record.bodyFat ?? null, existing.id);
    return;
  }
  await handle.runAsync('INSERT INTO body_records (date, weight, waist, body_fat) VALUES (?, ?, ?, ?)', record.date, record.weight, record.waist, record.bodyFat ?? null);
}

export async function loadDailyCheck(date: string): Promise<DailyCheck | null> {
  const row = await (await db()).getFirstAsync<{ protein: number; water: number; exercise: number; steps: number; sleep: number; water_liters: number | null; steps_count: number | null; sleep_hours: number | null }>('SELECT protein, water, exercise, steps, sleep, water_liters, steps_count, sleep_hours FROM daily_check WHERE date = ?', date);
  return row ? { protein: !!row.protein, water: !!row.water, exercise: !!row.exercise, steps: !!row.steps, sleep: !!row.sleep, waterMl: row.water_liters == null ? undefined : Math.round(row.water_liters * 1000), stepsCount: row.steps_count ?? undefined, sleepHours: row.sleep_hours ?? undefined } : null;
}

export async function updateBodyRecord(record: BodyRecord) {
  assertValid(validateBodyRecord(record));
  await (await db()).runAsync('UPDATE body_records SET weight = ?, waist = ?, body_fat = ? WHERE id = ?', record.weight, record.waist, record.bodyFat ?? null, record.id);
}

export async function saveDailyCheck(date: string, check: DailyCheck) {
  await (await db()).runAsync('INSERT OR REPLACE INTO daily_check (date, protein, water, exercise, steps, sleep, water_liters, steps_count, sleep_hours) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', date, Number(check.protein), Number(check.water), Number(check.exercise), Number(check.steps), Number(check.sleep), check.waterMl == null ? null : check.waterMl / 1000, check.stepsCount ?? null, check.sleepHours ?? null);
}

export async function loadCoachAdvice(): Promise<string | null> {
  const row = await (await db()).getFirstAsync<{ content: string }>('SELECT content FROM coach_advice WHERE id = 1');
  return row?.content ?? null;
}

export async function saveCoachAdvice(content: string) {
  await (await db()).runAsync('INSERT OR REPLACE INTO coach_advice (id, content, updated_at) VALUES (1, ?, ?)', content, new Date().toISOString());
}

export async function loadOrCreateJournal(date: string, profile: Profile, proteinTarget: number): Promise<DayJournal> {
  const handle = await db();
  const existing = await handle.getFirstAsync<{ data: string }>('SELECT data FROM day_journal WHERE date = ?', date);
  if (existing) {
    const day = JSON.parse(existing.data) as DayJournal;
    // Today's target follows the latest body weight; past dates preserve their historical target.
    if (date === todayISO() && day.proteinTarget !== proteinTarget) {
      day.proteinTarget = proteinTarget;
      await handle.runAsync('UPDATE day_journal SET data = ? WHERE date = ?', JSON.stringify(day), date);
    }
    return day;
  }
  const day = createDay(date, profile, proteinTarget);
  const legacy = await loadDailyCheck(date);
  day.legacyProtein = legacy?.protein ?? false;
  day.legacyExercise = legacy?.exercise ?? false;
  // Old checkmarks contain no food/action details. Preserve them as legacy notes only.
  await handle.runAsync('INSERT OR IGNORE INTO day_journal (date, data) VALUES (?, ?)', date, JSON.stringify(day));
  const saved = await handle.getFirstAsync<{ data: string }>('SELECT data FROM day_journal WHERE date = ?', date);
  return JSON.parse(saved!.data) as DayJournal;
}

export async function saveJournal(day: DayJournal) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Number.isFinite(day.proteinTarget) || day.proteinTarget <= 0) throw new Error('记录日期或目标无效。');
  day.foods.forEach(validateFood);
  validatePlan(day.plan);
  if (day.workout) validateWorkout(day, day.workout, todayISO());
  if (day.date > todayISO() && day.foods.length) throw new Error('不能提前记录未来的饮食。');
  await (await db()).runAsync('INSERT INTO day_journal (date, data) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET data = excluded.data', day.date, JSON.stringify(day));
}

export async function resetDatabase() {
  const pending = opening;
  if (pending) await pending.catch(() => {});
  opening = null;
  if (database) {
    await database.closeAsync().catch(() => {});
    database = null;
  }
  await SQLite.deleteDatabaseAsync('healthos.db');
}
