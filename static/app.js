// ─── State ────────────────────────────────────────────────────────────────────
let exercises = [];
let wtChart = null;
let wtChart2 = null;
let allChartInstances = [];
let allChartsPeriodDays = 30;
let wtPeriodDays = 30;
// 編集モーダル用キャッシュ
let logCache = new Map();
let weightCache = new Map();
let editingType = null;
let editingId = null;

// ─── Utility ──────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'エラーが発生しました');
  }
  return res.json();
}

// unit に応じた表示ラベル
function unitLabel(unit) {
  if (unit === 'sec') return '秒';
  if (unit === 'reps') return '回';
  return '回';
}

function unitBadgeText(unit) {
  if (unit === 'sec') return '秒数';
  if (unit === 'reps') return '回数のみ';
  return '重量 (kg)';
}

// ログ1行の「回数/秒数」列テキスト
function formatReps(log) {
  if (log.reps == null) return '—';
  return log.unit === 'sec' ? `${log.reps} 秒` : `${log.reps} 回`;
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.top-nav button, .bnav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.getElementById('nav-' + name)?.classList.add('active');
  document.getElementById('bnav-' + name)?.classList.add('active');

  if (name === 'dashboard') refreshDashboard();
  if (name === 'record') loadLogs();
  if (name === 'weight') loadWeightPage();
  if (name === 'settings') loadExercises();
}

// ─── Chart helpers ─────────────────────────────────────────────────────────────
const baseChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#1a1d27',
      borderColor: '#2e3248',
      borderWidth: 1,
      titleColor: '#94a3b8',
      bodyColor: '#e2e8f0',
    },
  },
  scales: {
    x: {
      ticks: { color: '#94a3b8', maxTicksLimit: 8, font: { size: 11 } },
      grid: { color: '#2e3248' },
    },
    y: {
      ticks: { color: '#94a3b8', font: { size: 11 } },
      grid: { color: '#2e3248' },
    },
  },
};

function makeLineChart(canvas, labels, data, color, height = 260) {
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, color + '55');
  gradient.addColorStop(1, color + '00');

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: color,
        backgroundColor: gradient,
        borderWidth: 2,
        pointRadius: data.length > 30 ? 2 : 4,
        pointBackgroundColor: color,
        fill: true,
        tension: 0.3,
      }],
    },
    options: { ...baseChartOptions },
  });
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function refreshDashboard() {
  await loadAllExercises();

  // サマリー統計
  const todayStr = today();
  const [todayLogs, weekLogs, wts] = await Promise.all([
    api('GET', `/api/logs?from_date=${todayStr}&to_date=${todayStr}`),
    api('GET', `/api/logs?from_date=${getMonday(new Date())}`),
    api('GET', '/api/weight'),
  ]);

  document.getElementById('stat-today').textContent = todayLogs.length;
  document.getElementById('stat-week').textContent = new Set(weekLogs.map(l => l.date)).size;
  const lastWt = wts.length ? wts[wts.length - 1].weight_kg : null;
  document.getElementById('stat-weight').textContent = lastWt ? lastWt + ' kg' : '—';

  // 最近のログ
  const recent = await api('GET', '/api/logs');
  renderRecentLogs(recent.slice(0, 20));

  // グラフ
  await Promise.all([
    loadAllExerciseCharts(),
    loadWeightChart(),
  ]);
}

function getMonday(d) {
  const date = new Date(d);
  const diff = date.getDay() === 0 ? -6 : 1 - date.getDay();
  date.setDate(date.getDate() + diff);
  return date.toISOString().slice(0, 10);
}

function renderRecentLogs(logs) {
  const el = document.getElementById('recent-logs');
  if (!logs.length) { el.innerHTML = '<div class="empty">まだ記録がありません</div>'; return; }
  const rows = logs.map(l => `
    <tr>
      <td>${l.date}</td>
      <td>${l.exercise_name}</td>
      <td>${l.sets ?? '—'}</td>
      <td>${formatReps(l)}</td>
      <td>${l.weight_kg != null ? l.weight_kg + ' kg' : '—'}</td>
      <td style="color:var(--text2);font-size:0.85rem;">${l.memo || ''}</td>
    </tr>
  `).join('');
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>日付</th><th>種目</th><th>セット</th><th>回数/秒数</th><th>重量</th><th>メモ</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// ─── 全種目グラフ ─────────────────────────────────────────────────────────────
const CHART_COLORS = [
  '#5b7fff','#ff6b6b','#4ade80','#facc15','#c084fc',
  '#38bdf8','#fb923c','#f472b6','#34d399','#a78bfa',
  '#60a5fa','#f87171',
];

async function loadAllExerciseCharts() {
  // 既存チャートを破棄
  allChartInstances.forEach(c => c.destroy());
  allChartInstances = [];

  const grid = document.getElementById('all-charts-grid');
  const emptyEl = document.getElementById('all-charts-empty');
  grid.innerHTML = '<div class="empty">データを読み込み中…</div>';

  // 全種目のstatsを並列取得
  const statsResults = await Promise.all(
    exercises.map(ex =>
      api('GET', `/api/stats/exercise/${ex.id}?days=${allChartsPeriodDays}`)
        .then(data => ({ ex, data }))
    )
  );

  // データのある種目だけ抽出
  const withData = statsResults.filter(r => r.data.length > 0);

  if (!withData.length) {
    grid.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';

  // グリッドを生成
  grid.innerHTML = withData.map(r => `
    <div class="mini-chart-card">
      <div class="mini-chart-title">${r.ex.name}</div>
      <div class="mini-chart-wrap"><canvas id="mini-chart-${r.ex.id}"></canvas></div>
    </div>
  `).join('');

  // 各チャートを描画
  withData.forEach((r, i) => {
    const { ex, data } = r;
    const color = CHART_COLORS[i % CHART_COLORS.length];
    const canvas = document.getElementById(`mini-chart-${ex.id}`);

    // 軸の値: kg種目は最大重量、reps/sec種目は合計回数/秒数
    const values = data.map(d => {
      if (ex.unit === 'kg') return d.max_weight ?? 0;
      return d.total_reps ?? 0;
    });
    const yLabel = ex.unit === 'kg' ? 'kg' : ex.unit === 'sec' ? '秒' : '回';

    const chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: data.map(d => d.date),
        datasets: [{
          data: values,
          borderColor: color,
          backgroundColor: color + '33',
          borderWidth: 2,
          pointRadius: data.length > 20 ? 2 : 3,
          pointBackgroundColor: color,
          fill: true,
          tension: 0.3,
        }],
      },
      options: {
        ...baseChartOptions,
        plugins: {
          ...baseChartOptions.plugins,
          tooltip: {
            ...baseChartOptions.plugins.tooltip,
            callbacks: {
              label: ctx => `${ctx.parsed.y} ${yLabel}`,
            },
          },
        },
      },
    });
    allChartInstances.push(chart);
  });
}

async function setAllChartsPeriod(days, btn) {
  allChartsPeriodDays = days;
  btn.closest('.period-select').querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  await loadAllExerciseCharts();
}

async function loadWeightChart() {
  const since = new Date();
  since.setDate(since.getDate() - wtPeriodDays);
  const data = await api('GET', `/api/weight?from_date=${since.toISOString().slice(0,10)}`);
  const canvas = document.getElementById('weight-chart');
  if (wtChart) wtChart.destroy();
  if (data.length) {
    wtChart = makeLineChart(canvas, data.map(d => d.date), data.map(d => d.weight_kg), '#ff6b6b');
  }
}

function setWtPeriod(days, btn) {
  wtPeriodDays = days;
  btn.closest('.period-select').querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadWeightChart();
}

// ─── Exercises ────────────────────────────────────────────────────────────────
async function loadAllExercises() {
  exercises = await api('GET', '/api/exercises');
}

async function loadExercises() {
  await loadAllExercises();
  const tbody = document.getElementById('ex-tbody');
  tbody.innerHTML = exercises.map(e => `
    <tr>
      <td>${e.name}</td>
      <td><span class="badge">${unitBadgeText(e.unit)}</span></td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteExercise(${e.id})">削除</button></td>
    </tr>
  `).join('');
}

async function addExercise() {
  const name = document.getElementById('new-ex-name').value.trim();
  const unit = document.getElementById('new-ex-unit').value;
  if (!name) { toast('種目名を入力してください'); return; }
  try {
    await api('POST', '/api/exercises', { name, unit });
    document.getElementById('new-ex-name').value = '';
    toast('追加しました');
    loadExercises();
  } catch (e) {
    toast(e.message);
  }
}

async function deleteExercise(id) {
  if (!confirm('削除すると関連するログも削除されます。よろしいですか？')) return;
  await api('DELETE', `/api/exercises/${id}`);
  toast('削除しました');
  loadExercises();
}

// ─── Record page ───────────────────────────────────────────────────────────────
async function initRecordPage() {
  await loadAllExercises();
  document.getElementById('log-date').value = today();
  document.getElementById('filter-month').value = thisMonth();

  const sel = document.getElementById('log-exercise');
  sel.innerHTML = exercises.map(e => `<option value="${e.id}" data-unit="${e.unit}">${e.name}</option>`).join('');

  const filterSel = document.getElementById('filter-exercise');
  filterSel.innerHTML = `<option value="">全種目</option>` +
    exercises.map(e => `<option value="${e.id}">${e.name}</option>`).join('');

  onExerciseChange();
}

// 種目切り替え時にフォームのラベル・フィールドを更新
function onExerciseChange() {
  const sel = document.getElementById('log-exercise');
  const opt = sel.options[sel.selectedIndex];
  const unit = opt ? opt.dataset.unit : 'kg';

  document.getElementById('label-reps').textContent =
    unit === 'sec' ? '秒数 (sec)' : '回数 (reps)';
  document.getElementById('log-reps').placeholder =
    unit === 'sec' ? '例: 60' : '例: 10';

  // 重量フィールドは kg 種目のみ表示
  document.getElementById('field-weight').style.display =
    unit === 'kg' ? '' : 'none';
}

async function saveLog() {
  const date = document.getElementById('log-date').value;
  const exercise_id = parseInt(document.getElementById('log-exercise').value);
  const sets = parseInt(document.getElementById('log-sets').value) || null;
  const reps = parseInt(document.getElementById('log-reps').value) || null;
  const weight_kg = parseFloat(document.getElementById('log-weight').value) || null;
  const memo = document.getElementById('log-memo').value.trim() || null;

  if (!date || !exercise_id) { toast('日付と種目を選択してください'); return; }

  await api('POST', '/api/logs', { date, exercise_id, sets, reps, weight_kg, memo });
  toast('記録しました！');
  document.getElementById('log-sets').value = '';
  document.getElementById('log-reps').value = '';
  document.getElementById('log-weight').value = '';
  document.getElementById('log-memo').value = '';
  loadLogs();
}

async function loadLogs() {
  await loadAllExercises();

  const exerciseId = document.getElementById('filter-exercise').value;
  const month = document.getElementById('filter-month').value;

  let url = '/api/logs?';
  if (exerciseId) url += `exercise_id=${exerciseId}&`;
  if (month) url += `from_date=${month}-01&to_date=${month}-31&`;

  const logs = await api('GET', url);
  const tbody = document.getElementById('logs-tbody');
  const empty = document.getElementById('logs-empty');

  if (!logs.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  // キャッシュに保存（編集モーダルで使用）
  logCache = new Map(logs.map(l => [l.id, l]));

  tbody.innerHTML = logs.map(l => `
    <tr>
      <td>${l.date}</td>
      <td>${l.exercise_name}</td>
      <td>${l.sets ?? '—'}</td>
      <td>${formatReps(l)}</td>
      <td>${l.weight_kg != null ? l.weight_kg + ' kg' : '—'}</td>
      <td class="memo" style="color:var(--text2);font-size:0.85rem;">${l.memo || ''}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-ghost btn-sm" onclick="openEditLog(${l.id})">編集</button>
        <button class="btn btn-danger btn-sm" onclick="deleteLog(${l.id})">削除</button>
      </td>
    </tr>
  `).join('');

  // フィルター選択肢の再同期
  const filterSel = document.getElementById('filter-exercise');
  if (filterSel.options.length <= 1) {
    filterSel.innerHTML = `<option value="">全種目</option>` +
      exercises.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  }
}

async function deleteLog(id) {
  await api('DELETE', `/api/logs/${id}`);
  toast('削除しました');
  loadLogs();
}

// ─── Weight page ───────────────────────────────────────────────────────────────
function initWeightPage() {
  document.getElementById('wt-date').value = today();
}

async function saveWeight() {
  const date = document.getElementById('wt-date').value;
  const weight_kg = parseFloat(document.getElementById('wt-value').value);
  if (!date || isNaN(weight_kg)) { toast('日付と体重を入力してください'); return; }
  await api('POST', '/api/weight', { date, weight_kg });
  toast('記録しました！');
  document.getElementById('wt-value').value = '';
  loadWeightPage();
}

async function loadWeightPage() {
  const data = await api('GET', '/api/weight');
  const tbody = document.getElementById('weight-tbody');
  const empty = document.getElementById('weight-empty');

  if (!data.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    const reversed = [...data].reverse();
    // キャッシュに保存（編集モーダルで使用）
    weightCache = new Map(data.map(w => [w.id, w]));
    tbody.innerHTML = reversed.map((w, i) => {
      const prev = reversed[i + 1];
      let diff = '';
      if (prev) {
        const d = (w.weight_kg - prev.weight_kg).toFixed(1);
        const color = d < 0 ? 'var(--green)' : d > 0 ? 'var(--accent2)' : 'var(--text2)';
        diff = `<span style="color:${color}">${d > 0 ? '+' : ''}${d}</span>`;
      }
      return `<tr>
        <td>${w.date}</td>
        <td><strong>${w.weight_kg} kg</strong></td>
        <td>${diff || '—'}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-ghost btn-sm" onclick="openEditWeight(${w.id})">編集</button>
          <button class="btn btn-danger btn-sm" onclick="deleteWeight(${w.id})">削除</button>
        </td>
      </tr>`;
    }).join('');
  }

  const canvas = document.getElementById('weight-chart2');
  if (wtChart2) wtChart2.destroy();
  if (data.length) {
    wtChart2 = makeLineChart(canvas, data.map(d => d.date), data.map(d => d.weight_kg), '#ff6b6b');
  }
}

async function deleteWeight(id) {
  await api('DELETE', `/api/weight/${id}`);
  toast('削除しました');
  loadWeightPage();
}

// ─── 編集モーダル ─────────────────────────────────────────────────────────────
function openEditLog(id) {
  const log = logCache.get(id);
  if (!log) return;

  editingType = 'log';
  editingId = id;

  // 種目セレクトを構築
  const sel = document.getElementById('edit-log-exercise');
  sel.innerHTML = exercises.map(e =>
    `<option value="${e.id}" data-unit="${e.unit}">${e.name}</option>`
  ).join('');

  document.getElementById('edit-log-date').value = log.date;
  sel.value = log.exercise_id;
  document.getElementById('edit-log-sets').value = log.sets ?? '';
  document.getElementById('edit-log-reps').value = log.reps ?? '';
  document.getElementById('edit-log-weight').value = log.weight_kg ?? '';
  document.getElementById('edit-log-memo').value = log.memo ?? '';

  onEditExerciseChange();

  document.getElementById('edit-log-form').style.display = 'block';
  document.getElementById('edit-weight-form').style.display = 'none';
  document.getElementById('edit-modal-title').textContent = '✏️ トレーニングを編集';
  document.getElementById('edit-modal').style.display = 'flex';
}

function openEditWeight(id) {
  const w = weightCache.get(id);
  if (!w) return;

  editingType = 'weight';
  editingId = id;

  document.getElementById('edit-wt-date').value = w.date;
  document.getElementById('edit-wt-value').value = w.weight_kg;

  document.getElementById('edit-log-form').style.display = 'none';
  document.getElementById('edit-weight-form').style.display = 'block';
  document.getElementById('edit-modal-title').textContent = '✏️ 体重を編集';
  document.getElementById('edit-modal').style.display = 'flex';
}

function closeEditModal() {
  document.getElementById('edit-modal').style.display = 'none';
  editingType = null;
  editingId = null;
}

// オーバーレイ（背景）クリックで閉じる
function onModalOverlayClick(e) {
  if (e.target === document.getElementById('edit-modal')) closeEditModal();
}

function onEditExerciseChange() {
  const sel = document.getElementById('edit-log-exercise');
  const unit = sel.options[sel.selectedIndex]?.dataset.unit ?? 'kg';
  document.getElementById('edit-label-reps').textContent = unit === 'sec' ? '秒数' : '回数';
  document.getElementById('edit-log-reps').placeholder = unit === 'sec' ? '例: 60' : '例: 10';
  document.getElementById('edit-field-weight').style.display = unit === 'kg' ? '' : 'none';
}

async function saveEdit() {
  try {
    if (editingType === 'log') {
      const date = document.getElementById('edit-log-date').value;
      const exercise_id = parseInt(document.getElementById('edit-log-exercise').value);
      const sets = parseInt(document.getElementById('edit-log-sets').value) || null;
      const reps = parseInt(document.getElementById('edit-log-reps').value) || null;
      const weight_kg = parseFloat(document.getElementById('edit-log-weight').value) || null;
      const memo = document.getElementById('edit-log-memo').value.trim() || null;
      if (!date || !exercise_id) { toast('日付と種目は必須です'); return; }
      await api('PUT', `/api/logs/${editingId}`, { date, exercise_id, sets, reps, weight_kg, memo });
      closeEditModal();
      toast('更新しました');
      loadLogs();
    } else if (editingType === 'weight') {
      const date = document.getElementById('edit-wt-date').value;
      const weight_kg = parseFloat(document.getElementById('edit-wt-value').value);
      if (!date || isNaN(weight_kg)) { toast('日付と体重は必須です'); return; }
      await api('PUT', `/api/weight/${editingId}`, { date, weight_kg });
      closeEditModal();
      toast('更新しました');
      loadWeightPage();
    }
  } catch (e) {
    toast(e.message);
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  initWeightPage();
  await initRecordPage();
  await refreshDashboard();
})();
