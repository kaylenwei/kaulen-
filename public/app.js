/* ============================================================
 * 前端交互逻辑（无框架、纯 JS）
 * ============================================================ */
const API = '/api';
const MAX_PER_DAY = 10;

const state = {
  token: localStorage.getItem('fh_token') || null,
  user: null,
};

const el = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = { ok: false, error: '请求失败' }; }
  if (!res.ok || !data.ok) {
    const err = new Error(data.error || `请求失败（${res.status}）`);
    err.status = res.status;
    throw err;
  }
  return data.data;
}

/* ---------- 登录 / 登出（带"跳转"过渡动画 + 地址栏变化） ---------- */
let viewTimer = null;

function showLogin() {
  clearTimeout(viewTimer);
  const app = el('app');
  const login = el('login-view');
  app.hidden = true;
  app.classList.remove('entering');
  login.hidden = false;
  login.classList.remove('leaving');
  state.user = null;
  setLoginStep('1');
  el('login-username').value = '';
  el('login-password').value = '';
  el('login-error').hidden = true;
  el('login-error1').hidden = true;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

function showApp() {
  clearTimeout(viewTimer);
  const login = el('login-view');
  const app = el('app');
  // 立刻彻底隐藏登录视图（不依赖动画定时器，杜绝残留遮挡）
  login.hidden = true;
  login.classList.remove('leaving');
  // 主界面整页进入，营造"跳转到新界面"的过渡感
  app.hidden = false;
  app.classList.remove('entering');
  void app.offsetWidth; // 强制重排以重启动画
  app.classList.add('entering');

  el('user-name').textContent = state.user ? state.user.username : '';
  el('admin-tab').hidden = state.user?.role !== 'admin';
  el('quota-badge').hidden = state.user?.role === 'admin';
  if (location.hash !== '#home') history.replaceState(null, '', '#home');
  window.scrollTo(0, 0);
}

/* ---------- 主题切换（亮 / 暗） ---------- */
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('fh_theme', theme);
  document.querySelectorAll('.theme-toggle').forEach((b) => {
    b.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  });
}
function initTheme() {
  const saved = localStorage.getItem('fh_theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(saved || (prefersDark ? 'dark' : 'light'));
}
document.querySelectorAll('.theme-toggle').forEach((b) => {
  b.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    setTheme(cur === 'dark' ? 'light' : 'dark');
  });
});

/* ---------- 登录两步流程 ---------- */
function setLoginStep(step) {
  document.querySelectorAll('.login-step').forEach((s) => {
    s.classList.toggle('active', s.dataset.step === String(step));
  });
  if (step === '2') {
    el('login-as').textContent = '登录为 ' + (el('login-username').value.trim() || '新用户');
    setTimeout(() => el('login-password').focus(), 120);
  } else if (step === '1') {
    setTimeout(() => el('login-username').focus(), 120);
  }
}
function goLoginNext() {
  const u = el('login-username').value.trim();
  if (!u) {
    el('login-error1').textContent = '请输入用户名';
    el('login-error1').hidden = false;
    el('login-username').classList.add('shake');
    setTimeout(() => el('login-username').classList.remove('shake'), 450);
    el('login-username').focus();
    return;
  }
  el('login-error1').hidden = true;
  setLoginStep('2');
}

async function init() {
  if (!state.token) { showLogin(); return; }
  try {
    state.user = await api('/me');
    showApp();
    await loadFiles();
    await loadMessages();
    if (state.user.role === 'admin') await loadUsers();
  } catch (e) {
    state.token = null;
    localStorage.removeItem('fh_token');
    showLogin();
  }
}

el('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = el('login-btn');
  btn.disabled = true;
  el('login-error').hidden = true;
  try {
    const data = await api('/login', {
      method: 'POST',
      body: { username: el('login-username').value, password: el('login-password').value },
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('fh_token', data.token);
    el('login-password').value = '';
    showApp();
    await loadFiles();
    await loadMessages();
    if (state.user.role === 'admin') await loadUsers();
  } catch (err) {
    el('login-error').textContent = err.message;
    el('login-error').hidden = false;
  } finally {
    btn.disabled = false;
  }
});

el('login-next').addEventListener('click', goLoginNext);
el('login-back').addEventListener('click', () => {
  el('login-error').hidden = true;
  el('login-password').value = '';
  setLoginStep('1');
});
el('login-username').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); goLoginNext(); }
});

el('logout-btn').addEventListener('click', () => {
  state.token = null;
  localStorage.removeItem('fh_token');
  showLogin();
});

/* ---------- Tab 切换 ---------- */
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    el(`panel-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'files') loadFiles();
    if (tab.dataset.tab === 'messages') loadMessages();
    if (tab.dataset.tab === 'admin') loadUsers();
  });
});

/* ---------- 文件 ---------- */
function renderQuota(quota) {
  if (!quota) return;
  if (quota.isAdmin) {
    el('quota-text').textContent = '管理员 · 上传次数不限';
    el('quota-badge').hidden = true;
    return;
  }
  el('quota-text').textContent = `今日已上传 ${quota.used} / ${quota.limit}（北京时间）`;
  el('quota-badge').hidden = false;
  el('quota-badge').textContent = `${quota.used}/${quota.limit}`;
}

async function loadFiles() {
  const body = el('files-body');
  body.innerHTML = '<tr><td colspan="6" class="empty">加载中…</td></tr>';
  try {
    const data = await api('/files');
    renderQuota(data.quota);
    if (!data.files.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty">还没有文件，快上传第一个吧</td></tr>';
      return;
    }
    body.innerHTML = data.files.map((f) => {
      const canManage = state.user.role === 'admin';
      const isOwn = f.owner === state.user.username;
      return `<tr>
        <td>${esc(f.original_name)}</td>
        <td>${esc(f.owner)}</td>
        <td>${fmtSize(f.size_bytes)}</td>
        <td><span class="note">${esc(f.note) || '—'}</span></td>
        <td>${fmtTime(f.created_at)}</td>
        <td class="row-actions">
          <button class="btn-link" data-act="download" data-id="${f.id}">下载</button>
          ${(canManage || isOwn) ? `<button class="btn-link" data-act="edit" data-id="${f.id}" data-name="${esc(f.original_name)}" data-note="${esc(f.note)}">编辑</button>` : ''}
          ${(canManage || isOwn) ? `<button class="btn-link danger" data-act="delete" data-id="${f.id}">删除</button>` : ''}
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    body.innerHTML = `<tr><td colspan="6" class="empty">${esc(e.message)}</td></tr>`;
  }
}

el('files-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  if (act === 'download') {
    try {
      const { url } = await api(`/files/download?id=${encodeURIComponent(id)}`);
      const a = document.createElement('a');
      a.href = url;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) { alert(err.message); }
  } else if (act === 'edit') {
    el('edit-id').value = id;
    el('edit-name').value = btn.dataset.name;
    el('edit-note').value = btn.dataset.note;
    el('edit-dialog').showModal();
  } else if (act === 'delete') {
    if (!confirm('确认删除该文件？此操作不可恢复。')) return;
    try { await api(`/files?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); loadFiles(); }
    catch (err) { alert(err.message); }
  }
});

el('edit-dialog').addEventListener('close', async () => {
  if (el('edit-dialog').returnValue !== 'ok') return;
  const id = el('edit-id').value;
  try {
    await api(`/files?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { original_name: el('edit-name').value, note: el('edit-note').value },
    });
    loadFiles();
  } catch (err) { alert(err.message); }
});

async function uploadFile(file) {
  const note = el('file-note').value.trim();
  const { fileId, uploadUrl } = await api('/files/upload', {
    method: 'POST',
    body: { name: file.name, note, size: file.size, mime: file.type || 'application/octet-stream' },
  });
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        const pct = Math.round((ev.loaded / ev.total) * 100);
        el('progress-bar').style.width = `${pct}%`;
        el('progress-text').textContent = `正在上传 ${file.name}（${pct}%）`;
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`上传失败（${xhr.status}）`));
    };
    xhr.onerror = () => reject(new Error('网络错误，上传失败'));
    xhr.send(file);
  });
  await api('/files/confirm', { method: 'POST', body: { fileId } });
}

el('upload-btn').addEventListener('click', async () => {
  const input = el('file-input');
  const files = Array.from(input.files || []);
  const errEl = el('upload-error');
  errEl.hidden = true;
  if (!files.length) { errEl.textContent = '请先选择文件'; errEl.hidden = false; return; }

  const btn = el('upload-btn');
  btn.disabled = true;
  el('progress-wrap').hidden = false;
  el('progress-bar').style.width = '0%';
  el('progress-text').textContent = '';
  try {
    for (let i = 0; i < files.length; i++) {
      await uploadFile(files[i]);
    }
    input.value = '';
    el('file-note').value = '';
    el('progress-text').textContent = '上传完成';
    loadFiles();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    setTimeout(() => { el('progress-wrap').hidden = true; el('progress-bar').style.width = '0%'; }, 1500);
  }
});

/* ---------- 留言墙 ---------- */
async function loadMessages() {
  const list = el('messages-list');
  list.innerHTML = '<p class="muted">加载中…</p>';
  try {
    const data = await api('/messages');
    if (!data.length) { list.innerHTML = '<p class="muted">还没有留言，来抢占沙发吧</p>'; return; }
    list.innerHTML = data.map((m) => `
      <div class="msg">
        <div class="msg-head">
          <span class="msg-user">${esc(m.username)}</span>
          <span class="msg-time">${fmtTime(m.created_at)}</span>
        </div>
        <div class="msg-content">${esc(m.content)}</div>
        ${state.user?.role === 'admin' ? `<div style="text-align:right"><button class="btn-link danger" data-del-msg="${m.id}">删除</button></div>` : ''}
      </div>`).join('');
  } catch (e) {
    list.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

el('message-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = el('message-input');
  const content = input.value.trim();
  if (!content) return;
  try {
    await api('/messages', { method: 'POST', body: { content } });
    input.value = '';
    loadMessages();
  } catch (err) { alert(err.message); }
});

el('messages-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-del-msg]');
  if (!btn) return;
  if (!confirm('确认删除这条留言？')) return;
  try {
    await api(`/messages?id=${encodeURIComponent(btn.dataset.delMsg)}`, { method: 'DELETE' });
    loadMessages();
  } catch (err) { alert(err.message); }
});

/* ---------- 成员管理（仅管理员） ---------- */
async function loadUsers() {
  const body = el('users-body');
  body.innerHTML = '<tr><td colspan="4" class="empty">加载中…</td></tr>';
  try {
    const data = await api('/users');
    if (!data.length) { body.innerHTML = '<tr><td colspan="4" class="empty">暂无成员</td></tr>'; return; }
    body.innerHTML = data.map((u) => `
      <tr>
        <td>${esc(u.username)}</td>
        <td>${u.role === 'admin' ? '管理员' : '成员'}</td>
        <td>${fmtTime(u.created_at)}</td>
        <td class="row-actions">
          <button class="btn-link" data-user="reset" data-id="${u.id}" data-name="${esc(u.username)}">重置密码</button>
          <button class="btn-link" data-user="role" data-id="${u.id}" data-role="${u.role}">${u.role === 'admin' ? '降为成员' : '升为管理员'}</button>
          <button class="btn-link danger" data-user="delete" data-id="${u.id}" data-name="${esc(u.username)}">删除</button>
        </td>
      </tr>`).join('');
  } catch (e) {
    body.innerHTML = `<tr><td colspan="4" class="empty">${esc(e.message)}</td></tr>`;
  }
}

el('add-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = el('user-error');
  errEl.hidden = true;
  try {
    await api('/users', {
      method: 'POST',
      body: {
        username: el('new-username').value.trim(),
        password: el('new-password').value,
        role: el('new-role').value,
      },
    });
    el('new-username').value = '';
    el('new-password').value = '';
    loadUsers();
  } catch (err) { errEl.textContent = err.message; errEl.hidden = false; }
});

el('users-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-user]');
  if (!btn) return;
  const { user: act, id, name, role } = btn.dataset;
  if (act === 'delete') {
    if (!confirm(`确认删除用户「${name}」？`)) return;
    try { await api(`/users?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); loadUsers(); }
    catch (err) { alert(err.message); }
  } else if (act === 'reset') {
    const pwd = prompt(`为「${name}」设置新密码：`);
    if (!pwd) return;
    try { await api('/users', { method: 'PATCH', body: { id, password: pwd } }); alert('密码已重置'); }
    catch (err) { alert(err.message); }
  } else if (act === 'role') {
    try {
      await api('/users', { method: 'PATCH', body: { id, role: role === 'admin' ? 'member' : 'admin' } });
      loadUsers();
    } catch (err) { alert(err.message); }
  }
});

initTheme();
init();