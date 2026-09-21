// ============================================================
// 门卫 API —— 部署于 Netlify Functions 的服务端接口
// 负责：登录鉴权、角色校验、每日上传限流、文件/留言/用户管理
// ============================================================
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || 'files';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const MAX_PER_DAY = 10;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

function js(statusCode, payload) {
  return {
    statusCode,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  };
}
const ok = (data) => js(200, { ok: true, data });
const fail = (message, statusCode = 400) => js(statusCode, { ok: false, error: message });

function parseBody(event) {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch {
    return null;
  }
}

// 从 /api/xxxx 或 /.netlify/functions/api/xxxx 中取出子路径
function routeOf(event) {
  const p = event.path || '';
  const i = p.indexOf('/api');
  let r = i >= 0 ? p.slice(i + 4) : p;
  if (!r) r = '/';
  if (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
  return r;
}

function signToken(user) {
  return jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

async function userFromRequest(event) {
  const auth = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!auth) return null;
  try {
    const payload = jwt.verify(auth, JWT_SECRET);
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('username', payload.username)
      .maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}

const isAdmin = (u) => !!u && u.role === 'admin';

// 北京时间（Asia/Shanghai，UTC+8）当天的时间边界
function shanghaiDayBounds() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const day = fmt.format(new Date());
  const start = new Date(`${day}T00:00:00+08:00`);
  const end = new Date(`${day}T23:59:59.999+08:00`);
  return { start, end };
}

async function usedToday(username) {
  const { start, end } = shanghaiDayBounds();
  const { count, error } = await supabase
    .from('files')
    .select('id', { count: 'exact', head: true })
    .eq('owner', username)
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString());
  if (error) return 0;
  return count ?? 0;
}

// 存储 signed URL 可能是相对路径，补全为完整 URL
const abs = (u) => (u && u.startsWith('http') ? u : `${SUPABASE_URL}${u}`);

exports.handler = async (event) => {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  const path = routeOf(event);
  const qs = event.queryStringParameters || {};

  try {
    // ---------- 登录 ----------
    if (path === '/login' && method === 'POST') {
      const body = parseBody(event);
      if (!body || !body.username || !body.password) return fail('缺少用户名或密码');
      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', String(body.username).trim())
        .maybeSingle();
      if (error || !user) return fail('用户名或密码错误', 401);
      const match = await bcrypt.compare(String(body.password), user.password_hash);
      if (!match) return fail('用户名或密码错误', 401);
      return ok({
        token: signToken(user),
        user: { username: user.username, role: user.role },
      });
    }

    // ---------- 当前用户 ----------
    if (path === '/me') {
      const u = await userFromRequest(event);
      if (!u) return fail('未登录或会话已过期', 401);
      return ok({ username: u.username, role: u.role });
    }

    // ---------- 用户管理（仅管理员） ----------
    if (path === '/users') {
      const u = await userFromRequest(event);
      if (!u) return fail('未登录', 401);
      if (!isAdmin(u)) return fail('无权限', 403);

      if (method === 'GET') {
        const { data, error } = await supabase
          .from('users')
          .select('id, username, role, created_at')
          .order('created_at', { ascending: true });
        if (error) return fail(error.message, 500);
        return ok(data);
      }

      if (method === 'POST') {
        const body = parseBody(event);
        if (!body || !body.username || !body.password) return fail('缺少用户名或密码');
        const username = String(body.username).trim();
        if (!username) return fail('用户名不能为空');
        const role = body.role === 'admin' ? 'admin' : 'member';
        const password_hash = await bcrypt.hash(String(body.password), 10);
        const { data, error } = await supabase
          .from('users')
          .insert({ username, password_hash, role })
          .select('id, username, role, created_at')
          .single();
        if (error) {
          if (error.code === '23505') return fail('该用户名已存在');
          return fail(error.message, 500);
        }
        return ok(data);
      }

      if (method === 'PATCH') {
        const body = parseBody(event);
        if (!body || !body.id) return fail('缺少用户 id');
        const patch = {};
        if (body.password) patch.password_hash = await bcrypt.hash(String(body.password), 10);
        if (body.role === 'admin' || body.role === 'member') patch.role = body.role;
        if (Object.keys(patch).length === 0) return fail('没有需要更新的字段');
        if (body.id === u.id && patch.role === 'member') return fail('不能降级当前登录账号');
        const { data, error } = await supabase
          .from('users')
          .update(patch)
          .eq('id', body.id)
          .select('id, username, role, created_at')
          .single();
        if (error) return fail(error.message, 500);
        return ok(data);
      }

      if (method === 'DELETE') {
        const id = qs.id;
        if (!id) return fail('缺少用户 id');
        if (id === u.id) return fail('不能删除当前登录账号');
        const { error } = await supabase.from('users').delete().eq('id', id);
        if (error) return fail(error.message, 500);
        return ok({ deleted: true });
      }
    }

    // ---------- 文件列表 ----------
    if (path === '/files' && method === 'GET') {
      const u = await userFromRequest(event);
      if (!u) return fail('未登录', 401);
      const { data, error } = await supabase
        .from('files')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) return fail(error.message, 500);
      return ok({
        files: data || [],
        quota: isAdmin(u)
          ? { isAdmin: true, used: await usedToday(u.username), limit: MAX_PER_DAY }
          : { isAdmin: false, used: await usedToday(u.username), limit: MAX_PER_DAY },
      });
    }

    // ---------- 申请上传（签发直传 URL + 预占配额） ----------
    if (path === '/files/upload' && method === 'POST') {
      const u = await userFromRequest(event);
      if (!u) return fail('未登录', 401);
      const body = parseBody(event);
      if (!body || !body.name) return fail('缺少文件名');

      if (!isAdmin(u)) {
        const used = await usedToday(u.username);
        if (used >= MAX_PER_DAY) return fail(`今日上传次数已达上限（${MAX_PER_DAY} 个/天，北京时间）`, 429);
      }

      const fileId = randomUUID();
      const storagePath = `${u.username}/${Date.now()}-${fileId}`;
      const { data: up, error: upErr } = await supabase.storage.from(BUCKET).createSignedUploadUrl(storagePath);
      if (upErr || !up) return fail(`创建上传授权失败：${(upErr && upErr.message) || '未知错误'}`, 500);

      const original_name = String(body.name).slice(0, 255);
      const note = String(body.note || '').slice(0, 1000);
      const mime_type = body.mime || 'application/octet-stream';
      const size_bytes = Number(body.size) || 0;

      const { error: insErr } = await supabase.from('files').insert({
        id: fileId,
        owner: u.username,
        storage_path: storagePath,
        original_name,
        note,
        size_bytes,
        mime_type,
        status: 'pending',
      });
      if (insErr) return fail(insErr.message, 500);

      return ok({
        fileId,
        uploadUrl: abs(up.signedUrl),
        path: storagePath,
        quota: isAdmin(u) ? null : { used: await usedToday(u.username), limit: MAX_PER_DAY },
      });
    }

    // ---------- 确认上传完成 ----------
    if (path === '/files/confirm' && method === 'POST') {
      const u = await userFromRequest(event);
      if (!u) return fail('未登录', 401);
      const body = parseBody(event);
      if (!body || !body.fileId) return fail('缺少 fileId');
      const { data: f } = await supabase.from('files').select('*').eq('id', body.fileId).maybeSingle();
      if (!f) return fail('记录不存在', 404);
      if (f.owner !== u.username && !isAdmin(u)) return fail('无权限', 403);
      const { error } = await supabase.from('files').update({ status: 'uploaded' }).eq('id', body.fileId);
      if (error) return fail(error.message, 500);
      return ok({ confirmed: true });
    }

    // ---------- 下载（签发附件下载 URL） ----------
    if (path === '/files/download' && method === 'GET') {
      const u = await userFromRequest(event);
      if (!u) return fail('未登录', 401);
      const id = qs.id;
      if (!id) return fail('缺少文件 id');
      const { data: f } = await supabase.from('files').select('*').eq('id', id).maybeSingle();
      if (!f) return fail('记录不存在', 404);
      if (f.status !== 'uploaded') return fail('文件尚未上传完成', 409);
      const { data: s, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(f.storage_path, 3600, { download: f.original_name });
      if (error || !s) return fail('生成下载链接失败', 500);
      return ok({ url: abs(s.signedUrl), name: f.original_name });
    }

    // ---------- 修改文件备注 / 文件名（管理员或本人） ----------
    if (path === '/files' && method === 'PATCH') {
      const u = await userFromRequest(event);
      if (!u) return fail('未登录', 401);
      const id = qs.id;
      const body = parseBody(event);
      if (!id || !body) return fail('缺少参数');
      const { data: f } = await supabase.from('files').select('*').eq('id', id).maybeSingle();
      if (!f) return fail('记录不存在', 404);
      if (f.owner !== u.username && !isAdmin(u)) return fail('无权限', 403);
      const patch = {};
      if (body.note !== undefined) patch.note = String(body.note).slice(0, 1000);
      if (body.original_name !== undefined) patch.original_name = String(body.original_name).slice(0, 255);
      if (Object.keys(patch).length === 0) return fail('没有需要更新的字段');
      const { error } = await supabase.from('files').update(patch).eq('id', id);
      if (error) return fail(error.message, 500);
      return ok({ updated: true });
    }

    // ---------- 删除文件（管理员或本人） ----------
    if (path === '/files' && method === 'DELETE') {
      const u = await userFromRequest(event);
      if (!u) return fail('未登录', 401);
      const id = qs.id;
      if (!id) return fail('缺少文件 id');
      const { data: f } = await supabase.from('files').select('*').eq('id', id).maybeSingle();
      if (!f) return fail('记录不存在', 404);
      if (f.owner !== u.username && !isAdmin(u)) return fail('无权限', 403);
      await supabase.storage.from(BUCKET).remove([f.storage_path]);
      const { error } = await supabase.from('files').delete().eq('id', id);
      if (error) return fail(error.message, 500);
      return ok({ deleted: true });
    }

    // ---------- 留言墙 ----------
    if (path === '/messages') {
      if (method === 'GET') {
        const u = await userFromRequest(event);
        if (!u) return fail('未登录', 401);
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200);
        if (error) return fail(error.message, 500);
        return ok(data || []);
      }
      if (method === 'POST') {
        const u = await userFromRequest(event);
        if (!u) return fail('未登录', 401);
        const body = parseBody(event);
        const content = String((body && body.content) || '').trim();
        if (!content) return fail('留言内容不能为空');
        if (content.length > 1000) return fail('留言内容过长');
        const { data, error } = await supabase
          .from('messages')
          .insert({ username: u.username, content })
          .select('*')
          .single();
        if (error) return fail(error.message, 500);
        return ok(data);
      }
      if (method === 'DELETE') {
        const u = await userFromRequest(event);
        if (!u) return fail('未登录', 401);
        if (!isAdmin(u)) return fail('无权限', 403);
        const id = qs.id;
        if (!id) return fail('缺少留言 id');
        const { error } = await supabase.from('messages').delete().eq('id', id);
        if (error) return fail(error.message, 500);
        return ok({ deleted: true });
      }
    }

    return fail('接口不存在', 404);
  } catch (e) {
    return fail(e && e.message ? e.message : '服务器内部错误', 500);
  }
};