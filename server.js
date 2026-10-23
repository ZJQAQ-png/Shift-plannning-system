'use strict';
// 排班系统 · 零依赖 Node 服务
// 提供静态前端 + JSON API，数据持久化到 data.json
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------- 数据持久化 ----------
function mondayOf(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // 周一=0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function seed() {
  return {
    employees: [
      { id: uid(), name: '张三', role: '护士', maxHours: 40 },
      { id: uid(), name: '李四', role: '护士', maxHours: 40 },
      { id: uid(), name: '王五', role: '技师', maxHours: 48 },
    ],
    shiftTypes: [
      { id: uid(), name: '早班', color: '#2f6df6', start: '08:00', end: '16:00' },
      { id: uid(), name: '晚班', color: '#ff8a3c', start: '16:00', end: '24:00' },
      { id: uid(), name: '夜班', color: '#7a5cff', start: '00:00', end: '08:00' },
    ],
    assignments: [],
    weekStart: mondayOf(new Date()),
  };
}
function loadData() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!d.weekStart) d.weekStart = mondayOf(new Date());
    return d;
  } catch {
    const s = seed();
    saveData(s);
    return s;
  }
}
function saveData(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}
let data = loadData();

// ---------- 工具 ----------
function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); }
    });
  });
}
function find(arr, id) { return arr.find((x) => x.id === id); }

// ---------- API ----------
async function handleApi(req, res, u) {
  const parts = u.pathname.split('/').filter(Boolean); // ['api', ...]
  const seg = parts.slice(1); // 去掉 'api'，保留其余路径段
  const method = req.method;

  // GET /api/state
  if (method === 'GET' && seg.length === 1 && seg[0] === 'state') {
    return send(res, 200, data);
  }

  // 员工
  if (seg[0] === 'employee') {
    if (method === 'POST') {
      const b = await readBody(req);
      if (!b.name) return send(res, 400, { error: 'name required' });
      const e = { id: uid(), name: String(b.name).trim(), role: String(b.role || '').trim(), maxHours: Number(b.maxHours) || 40 };
      data.employees.push(e); saveData(data);
      return send(res, 200, e);
    }
    if (method === 'DELETE' && seg[1]) {
      data.employees = data.employees.filter((e) => e.id !== seg[1]);
      data.assignments = data.assignments.filter((a) => a.employeeId !== seg[1]);
      saveData(data);
      return send(res, 200, { ok: true });
    }
  }

  // 班次类型
  if (seg[0] === 'shiftType') {
    if (method === 'POST') {
      const b = await readBody(req);
      if (!b.name) return send(res, 400, { error: 'name required' });
      const s = { id: uid(), name: String(b.name).trim(), color: String(b.color || '#2f6df6'), start: String(b.start || '08:00'), end: String(b.end || '16:00') };
      data.shiftTypes.push(s); saveData(data);
      return send(res, 200, s);
    }
    if (method === 'DELETE' && seg[1]) {
      data.shiftTypes = data.shiftTypes.filter((s) => s.id !== seg[1]);
      data.assignments = data.assignments.filter((a) => a.shiftTypeId !== seg[1]);
      saveData(data);
      return send(res, 200, { ok: true });
    }
  }

  // 排班分配
  if (seg[0] === 'assignment') {
    if (method === 'POST') {
      const b = await readBody(req);
      if (!b.employeeId || !b.date || !b.shiftTypeId) return send(res, 400, { error: 'employeeId, date, shiftTypeId required' });
      const a = { id: uid(), employeeId: b.employeeId, date: b.date, shiftTypeId: b.shiftTypeId };
      data.assignments.push(a); saveData(data);
      return send(res, 200, a);
    }
    if (method === 'DELETE' && seg[1]) {
      data.assignments = data.assignments.filter((a) => a.id !== seg[1]);
      saveData(data);
      return send(res, 200, { ok: true });
    }
  }

  // 设置周起始
  if (seg[0] === 'weekStart' && method === 'POST') {
    const b = await readBody(req);
    if (b.weekStart) { data.weekStart = b.weekStart; saveData(data); }
    return send(res, 200, { weekStart: data.weekStart });
  }

  // 重置
  if (seg[0] === 'reset' && method === 'POST') {
    data = seed(); saveData(data);
    return send(res, 200, data);
  }

  return send(res, 404, { error: 'not found', path: u.pathname });
}

// ---------- 静态文件 ----------
function serveStatic(req, res, u) {
  let p = decodeURIComponent(u.pathname);
  if (p === '/' || p === '') p = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      // SPA 回退
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, idx) => {
        if (e2) return send(res, 404, 'not found', 'text/plain');
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(idx);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}

// ---------- 路由 ----------
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname.startsWith('/api/')) {
    handleApi(req, res, u).catch((e) => send(res, 500, { error: String(e) }));
  } else {
    serveStatic(req, res, u);
  }
});

server.listen(PORT, () => {
  console.log(`Shift-plannning-system running at http://localhost:${PORT}`);
});
