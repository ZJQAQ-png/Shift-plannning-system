'use strict';
const API = '/api';
const SC = location.search || ''; // 发布平台要求的 ?sharecode=xxx，必须带在每个请求上
let state = { employees: [], shiftTypes: [], assignments: [], weekStart: null };
let currentWeek = null;

// ---------- 工具 ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function shiftMinutes(start, end) {
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  let s = toMin(start), e = toMin(end);
  if (e <= s) e += 1440;
  return e - s;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekDays(ws) { return Array.from({ length: 7 }, (_, i) => addDays(ws, i)); }
const WK = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// ---------- 数据 ----------
async function load() {
  const r = await fetch(`${API}/state${SC}`);
  state = await r.json();
  currentWeek = state.weekStart;
  renderAll();
}
async function api(path, method = 'GET', body) {
  const opt = { method, headers: {} };
  if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(`${API}/${path}${SC}`, opt);
  if (!r.ok) { const e = await r.json().catch(() => ({})); alert('操作失败: ' + (e.error || r.status)); return null; }
  return r.json();
}

// ---------- 渲染 ----------
function renderAll() {
  renderBoard();
  renderEmployees();
  renderShifts();
  renderStats();
  $('#weekLabel').textContent = `${currentWeek} 当周`;
}

function assignmentAt(empId, date) {
  return state.assignments.filter((a) => a.employeeId === empId && a.date === date);
}
function shiftById(id) { return state.shiftTypes.find((s) => s.id === id); }

function renderBoard() {
  const days = weekDays(currentWeek);
  const t = $('#board');
  let html = '<thead><tr><th>员工 \\ 日期</th>';
  days.forEach((d, i) => { html += `<th>${WK[i]}<br><span style="font-weight:400;color:#5b6776">${d.slice(5)}</span></th>`; });
  html += '</tr></thead><tbody>';
  state.employees.forEach((emp) => {
    html += `<tr><th>${esc(emp.name)}<br><span style="font-weight:400;color:#5b6776">${esc(emp.role || '')}</span></th>`;
    days.forEach((d) => {
      const as = assignmentAt(emp.id, d);
      const conflict = as.length > 1 || (as.length === 2 && timeOverlap(as[0], as[1]));
      let inner = '';
      if (as.length) {
        const sh = shiftById(as[0].shiftTypeId);
        if (sh) inner = `<div class="shift-chip" style="background:${sh.color}"><span class="dot"></span>${esc(sh.name)}</div>` + (as.length > 1 ? ' <small>+' + (as.length - 1) + '</small>' : '');
      }
      html += `<td class="cell ${as.length ? '' : 'empty'} ${conflict ? 'conflict' : ''}" data-emp="${emp.id}" data-date="${d}">${inner || (as.length ? '' : '＋')}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody>';
  t.innerHTML = html;
}

function timeOverlap(a, b) {
  const sa = shiftById(a.shiftTypeId), sb = shiftById(b.shiftTypeId);
  if (!sa || !sb) return false;
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const A = [toMin(sa.start), toMin(sa.end) <= toMin(sa.start) ? toMin(sa.end) + 1440 : toMin(sa.end)];
  const B = [toMin(sb.start), toMin(sb.end) <= toMin(sb.start) ? toMin(sb.end) + 1440 : toMin(sb.end)];
  return A[0] < B[1] && B[0] < A[1];
}

function renderEmployees() {
  const ul = $('#empList');
  ul.innerHTML = state.employees.map((e) => `
    <li><div class="meta"><b>${esc(e.name)}</b><span>${esc(e.role || '—')} · 上限 ${e.maxHours}h/周</span></div>
    <button class="del" data-del-emp="${e.id}">删除</button></li>`).join('') || '<li><div class="meta">暂无员工，请添加</div></li>';
}
function renderShifts() {
  const ul = $('#shiftList');
  ul.innerHTML = state.shiftTypes.map((s) => `
    <li><span class="swatch" style="background:${s.color}"></span><div class="meta"><b>${esc(s.name)}</b><span>${esc(s.start)} – ${esc(s.end)}</span></div>
    <button class="del" data-del-shift="${s.id}">删除</button></li>`).join('') || '<li><div class="meta">暂无班次类型，请添加</div></li>';
}

function renderStats() {
  const days = weekDays(currentWeek);
  // 工时
  const ul = $('#statsHours');
  ul.innerHTML = state.employees.map((e) => {
    let total = 0;
    state.assignments.filter((a) => a.employeeId === e.id && days.includes(a.date)).forEach((a) => {
      const sh = shiftById(a.shiftTypeId); if (sh) total += shiftMinutes(sh.start, sh.end) / 60;
    });
    const over = total > e.maxHours;
    return `<li><div class="meta"><b>${esc(e.name)}</b><span style="color:${over ? '#e5484d' : '#5b6776'}">${total.toFixed(1)}h / 上限 ${e.maxHours}h ${over ? '⚠ 超限' : ''}</span></div></li>`;
  }).join('') || '<li><div class="meta">暂无数据</div></li>';
  // 每日覆盖
  const cov = $('#statsCoverage');
  cov.innerHTML = days.map((d, i) => {
    const n = state.assignments.filter((a) => a.date === d).length;
    return `<div class="day"><b>${n}</b>${WK[i]}<br><span style="color:#5b6776">${d.slice(5)}</span></div>`;
  }).join('');
  // 冲突条
  const conflicts = [];
  state.employees.forEach((e) => days.forEach((d) => {
    const as = assignmentAt(e.id, d);
    if (as.length > 1) conflicts.push(`${e.name} 在 ${d} 同日排了 ${as.length} 个班次`);
    else if (as.length === 2 && timeOverlap(as[0], as[1])) conflicts.push(`${e.name} 在 ${d} 班次时间重叠`);
  }));
  const bar = $('#conflictBar');
  if (conflicts.length) { bar.hidden = false; bar.innerHTML = '⚠ 冲突：' + conflicts.map(esc).join('；'); }
  else bar.hidden = true;
}

// ---------- 交互 ----------
function switchTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
}

$('#board')?.addEventListener('click', (ev) => {
  const td = ev.target.closest('.cell');
  if (!td) return;
  openPop(td);
});

let popCell = null;
function openPop(td) {
  popCell = td;
  const emp = td.dataset.emp, date = td.dataset.date;
  $('#popTitle').textContent = `${state.employees.find((e) => e.id === emp)?.name || ''} · ${date}`;
  const as = assignmentAt(emp, date);
  const cur = as[0] ? shiftById(as[0].shiftTypeId) : null;
  $('#popShifts').innerHTML = state.shiftTypes.map((s) => `
    <div class="pop-shift" data-pick="${s.id}" style="border-left:4px solid ${s.color}">${esc(s.name)} <span style="color:#5b6776">${esc(s.start)}–${esc(s.end)}</span></div>`).join('') || '<div style="color:#5b6776;font-size:12px">请先在「班次类型」添加班次</div>';
  const pop = $('#cellPop');
  const r = td.getBoundingClientRect();
  pop.style.left = Math.min(r.left, window.innerWidth - 240) + 'px';
  pop.style.top = (r.bottom + 6) + 'px';
  pop.hidden = false;
}
$('#popShifts').addEventListener('click', async (ev) => {
  const pick = ev.target.closest('[data-pick]');
  if (!pick || !popCell) return;
  const emp = popCell.dataset.emp, date = popCell.dataset.date;
  // 同员工同日已有时先删再加（保持单班次，避免误叠加）
  const ex = assignmentAt(emp, date);
  for (const a of ex) await api(`assignment/${a.id}`, 'DELETE');
  await api('assignment', 'POST', { employeeId: emp, date, shiftTypeId: pick.dataset.pick });
  $('#cellPop').hidden = true;
  await load();
});
$('#popClear').addEventListener('click', async () => {
  if (!popCell) return;
  const ex = assignmentAt(popCell.dataset.emp, popCell.dataset.date);
  for (const a of ex) await api(`assignment/${a.id}`, 'DELETE');
  $('#cellPop').hidden = true;
  await load();
});
$('#popClose').addEventListener('click', () => { $('#cellPop').hidden = true; });
document.addEventListener('click', (e) => { if (!e.target.closest('#cellPop') && !e.target.closest('.cell')) $('#cellPop').hidden = true; });

// 周切换
$('#prevWeek').addEventListener('click', async () => { currentWeek = addDays(currentWeek, -7); await api('weekStart', 'POST', { weekStart: currentWeek }); await load(); });
$('#nextWeek').addEventListener('click', async () => { currentWeek = addDays(currentWeek, 7); await api('weekStart', 'POST', { weekStart: currentWeek }); await load(); });

// 员工/班次表单
$('#empForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('employee', 'POST', { name: $('#empName').value, role: $('#empRole').value, maxHours: Number($('#empMax').value) });
  e.target.reset(); $('#empMax').value = 40; await load();
});
$('#shiftForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('shiftType', 'POST', { name: $('#shiftName').value, start: $('#shiftStart').value, end: $('#shiftEnd').value, color: $('#shiftColor').value });
  e.target.reset(); $('#shiftStart').value = '08:00'; $('#shiftEnd').value = '16:00'; $('#shiftColor').value = '#2f6df6'; await load();
});
$('#empList').addEventListener('click', async (e) => { const id = e.target.dataset.delEmp; if (id) { await api(`employee/${id}`, 'DELETE'); await load(); } });
$('#shiftList').addEventListener('click', async (e) => { const id = e.target.dataset.delShift; if (id) { await api(`shiftType/${id}`, 'DELETE'); await load(); } });
$('#resetBtn').addEventListener('click', async () => { if (confirm('恢复为示例数据？当前排班将被清空。')) { await api('reset', 'POST'); await load(); } });
$$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
else load();
