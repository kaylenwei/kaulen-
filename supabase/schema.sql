-- ============================================================
-- 团队文件储存平台 · 数据库初始化脚本
-- 在 Supabase 控制台 → SQL Editor 中整体执行一次即可
-- ============================================================

-- 用户表：账号、密码哈希、角色（admin / member）
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  role text not null default 'member' check (role in ('admin','member')),
  created_at timestamptz not null default now()
);

-- 文件表：文件元数据（文件本体存于 Storage 桶）
create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  storage_path text not null,
  original_name text not null,
  note text not null default '',
  size_bytes bigint not null default 0,
  mime_type text not null default 'application/octet-stream',
  status text not null default 'pending' check (status in ('pending','uploaded')),
  created_at timestamptz not null default now()
);

-- 留言墙
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_files_owner_created on public.files (owner, created_at desc);
create index if not exists idx_files_created on public.files (created_at desc);
create index if not exists idx_messages_created on public.messages (created_at desc);

-- 私有存储桶（文件仅通过服务端签名的 URL 上传/下载，不对公网开放）
insert into storage.buckets (id, name, public)
values ('files', 'files', false)
on conflict (id) do nothing;

-- 说明：
-- 本项目不向浏览器暴露 Supabase anon key，所有读写均由 Netlify Functions（服务端）
-- 使用 service_role 密钥完成，并通过 signed URL 让浏览器直传/直下文件。
-- 因此无需为 storage.objects 额外配置 RLS 策略（service_role 与签名令牌自动放行）。