const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8000;

// ─── DB セットアップ ──────────────────────────────────────────────────────────
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'bodymaker.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    unit TEXT NOT NULL DEFAULT 'reps'
  );

  CREATE TABLE IF NOT EXISTS workout_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    exercise_id INTEGER NOT NULL,
    sets INTEGER,
    reps INTEGER,
    weight_kg REAL,
    memo TEXT,
    FOREIGN KEY (exercise_id) REFERENCES exercises(id)
  );

  CREATE TABLE IF NOT EXISTS weight_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    weight_kg REAL NOT NULL
  );

  INSERT OR IGNORE INTO exercises (name, unit) VALUES
    ('ベンチプレス', 'kg'),
    ('スクワット', 'kg'),
    ('デッドリフト', 'kg'),
    ('懸垂', 'reps'),
    ('腕立て伏せ', 'reps'),
    ('腹筋', 'reps'),
    ('ショルダープレス', 'kg'),
    ('アームカール', 'kg'),
    ('ラットプルダウン', 'kg'),
    ('レッグプレス', 'kg'),
    ('レッグランジ', 'reps'),
    ('プランク', 'sec'),
    ('ダンベルプレス', 'kg');
`);

// ─── Basic認証 ────────────────────────────────────────────────────────────────
function basicAuth(req, res, next) {
  const authUser = process.env.AUTH_USER;
  const authPass = process.env.AUTH_PASS;

  // 環境変数未設定時はローカル開発用にスキップ
  if (!authUser || !authPass) return next();

  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Bodymaker"');
    return res.status(401).send('認証が必要です');
  }

  const [user, pass] = Buffer.from(header.slice(6), 'base64').toString().split(':');
  const ok =
    user.length === authUser.length &&
    pass?.length === authPass.length &&
    crypto.timingSafeEqual(Buffer.from(user), Buffer.from(authUser)) &&
    crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(authPass));

  if (ok) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="Bodymaker"');
  return res.status(401).send('認証が必要です');
}

// ─── ミドルウェア ─────────────────────────────────────────────────────────────
app.use(basicAuth);
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'static')));

// ─── エクササイズ API ─────────────────────────────────────────────────────────
app.get('/api/exercises', (_req, res) => {
  const rows = db.prepare('SELECT * FROM exercises ORDER BY name').all();
  res.json(rows);
});

app.post('/api/exercises', (req, res) => {
  const { name, unit = 'reps' } = req.body;
  if (!name) return res.status(400).json({ detail: '名前は必須です' });
  try {
    const info = db.prepare('INSERT INTO exercises (name, unit) VALUES (?, ?)').run(name.trim(), unit);
    res.status(201).json({ id: info.lastInsertRowid, name: name.trim(), unit });
  } catch {
    res.status(409).json({ detail: '同じ名前のエクササイズが既に存在します' });
  }
});

app.delete('/api/exercises/:id', (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare('DELETE FROM workout_logs WHERE exercise_id = ?').run(id);
  db.prepare('DELETE FROM exercises WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ─── ワークアウトログ API ──────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  const { from_date, to_date, exercise_id } = req.query;
  let query = `
    SELECT wl.id, wl.date, wl.sets, wl.reps, wl.weight_kg, wl.memo,
           e.id as exercise_id, e.name as exercise_name, e.unit
    FROM workout_logs wl
    JOIN exercises e ON e.id = wl.exercise_id
    WHERE 1=1
  `;
  const params = [];
  if (from_date) { query += ' AND wl.date >= ?'; params.push(from_date); }
  if (to_date)   { query += ' AND wl.date <= ?'; params.push(to_date); }
  if (exercise_id) { query += ' AND wl.exercise_id = ?'; params.push(parseInt(exercise_id)); }
  query += ' ORDER BY wl.date DESC, wl.id DESC';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/logs', (req, res) => {
  const { date, exercise_id, sets, reps, weight_kg, memo } = req.body;
  if (!date || !exercise_id) return res.status(400).json({ detail: '日付と種目は必須です' });
  const info = db.prepare(
    'INSERT INTO workout_logs (date, exercise_id, sets, reps, weight_kg, memo) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(date, exercise_id, sets ?? null, reps ?? null, weight_kg ?? null, memo ?? null);

  const row = db.prepare(`
    SELECT wl.id, wl.date, wl.sets, wl.reps, wl.weight_kg, wl.memo,
           e.id as exercise_id, e.name as exercise_name, e.unit
    FROM workout_logs wl JOIN exercises e ON e.id = wl.exercise_id
    WHERE wl.id = ?
  `).get(info.lastInsertRowid);
  res.status(201).json(row);
});

app.delete('/api/logs/:id', (req, res) => {
  db.prepare('DELETE FROM workout_logs WHERE id = ?').run(parseInt(req.params.id));
  res.json({ ok: true });
});

// ─── 体重ログ API ──────────────────────────────────────────────────────────────
app.get('/api/weight', (req, res) => {
  const { from_date, to_date } = req.query;
  let query = 'SELECT * FROM weight_logs WHERE 1=1';
  const params = [];
  if (from_date) { query += ' AND date >= ?'; params.push(from_date); }
  if (to_date)   { query += ' AND date <= ?'; params.push(to_date); }
  query += ' ORDER BY date ASC';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/weight', (req, res) => {
  const { date, weight_kg } = req.body;
  if (!date || weight_kg == null) return res.status(400).json({ detail: '日付と体重は必須です' });
  db.prepare(
    'INSERT INTO weight_logs (date, weight_kg) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET weight_kg = excluded.weight_kg'
  ).run(date, weight_kg);
  const row = db.prepare('SELECT * FROM weight_logs WHERE date = ?').get(date);
  res.status(201).json(row);
});

app.delete('/api/weight/:id', (req, res) => {
  db.prepare('DELETE FROM weight_logs WHERE id = ?').run(parseInt(req.params.id));
  res.json({ ok: true });
});

// ─── 統計 API ─────────────────────────────────────────────────────────────────
app.get('/api/stats/exercise/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const days = parseInt(req.query.days) || 90;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT date,
           SUM(sets) as total_sets,
           SUM(reps) as total_reps,
           MAX(weight_kg) as max_weight,
           MAX(COALESCE(sets,1) * COALESCE(reps,0)) as max_volume
    FROM workout_logs
    WHERE exercise_id = ? AND date >= ?
    GROUP BY date
    ORDER BY date ASC
  `).all(id, sinceStr);
  res.json(rows);
});

// ─── SPA フォールバック ────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'static', 'index.html')));

// ─── 起動 ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n💪 Bodymaker が起動しました`);
  console.log(`   http://localhost:${PORT}\n`);
});
