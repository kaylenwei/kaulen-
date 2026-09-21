// ============================================================
// 创建 / 重置管理员账号
// 用法：在项目目录下，先配置好 .env（SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY），
// 再设置 ADMIN_USERNAME / ADMIN_PASSWORD，然后执行：npm run create-admin
// ============================================================
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

(async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，请先配置 .env');
    process.exit(1);
  }
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.error('请先设置 ADMIN_USERNAME 与 ADMIN_PASSWORD 环境变量');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const username = ADMIN_USERNAME.trim();
  const password_hash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const { data: existing } = await supabase.from('users').select('id').eq('username', username).maybeSingle();

  if (existing) {
    const { error } = await supabase.from('users').update({ password_hash, role: 'admin' }).eq('username', username);
    if (error) {
      console.error('更新失败：', error.message);
      process.exit(1);
    }
    console.log(`已重置管理员「${username}」的密码与权限`);
  } else {
    const { error } = await supabase.from('users').insert({ username, password_hash, role: 'admin' });
    if (error) {
      console.error('创建失败：', error.message);
      process.exit(1);
    }
    console.log(`已创建管理员「${username}」`);
  }
})();