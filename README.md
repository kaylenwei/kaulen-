# 团队文件储存平台 + 留言墙

用于团队内部的文件储存与共享：成员以各自账号上传任意后缀文件并添加备注，团队内可下载；
附带留言墙。**文件仅供保存，不在服务器上运行。**

- 前端 + 门卫 API：Netlify（静态页面 + Netlify Functions，门卫逻辑就是 JS）
- 文件本体 + 数据库 + 存储：Supabase（PostgreSQL + Storage）

## 功能

- 任意后缀文件上传 + 备注，团队内可下载
- 保存时间大于 1 年（不设过期策略，按需备份）
- 留言墙显示用户名 + 发送时间（北京时间）
- 每名成员每日（北京时间 UTC+8）最多上传 10 个文件
- 管理员（最高决策者）无限上传、可编辑/删除任何文件与留言、管理成员
- 账号密码由管理员在后台添加/重置

## 安全模型

- 浏览器**不接触** Supabase 密钥，所有数据库与存储操作都在 Netlify Functions（服务端）完成。
- 文件上传/下载使用服务端签发的短时签名 URL，实现"只存不运行"（下载强制 `Content-Disposition: attachment`）。
- 密码使用 bcrypt 单向哈希存储；会话使用 JWT。
- 每日配额在**服务端**按北京时间计算，无法通过改浏览器时区绕过。

## 目录结构

```
├── netlify.toml               # Netlify 构建与路由配置
├── package.json
├── .env.example               # 环境变量模板
├── public/                    # 前端（index.html / style.css / app.js）
├── netlify/functions/api.js   # 门卫 API（唯一后端接口）
├── scripts/create-admin.js    # 创建/重置管理员
└── supabase/schema.sql        # 数据库初始化脚本
```

## 部署步骤

### 1. 准备 Supabase

1. 前往 [supabase.com](https://supabase.com) 注册并新建项目。
2. 打开 **SQL Editor**，把 `supabase/schema.sql` 的内容整体粘贴执行一次（自动建三张表 + 私有存储桶 `files`）。
3. 在 **Project Settings → API** 中复制：
   - `Project URL`（对应 `SUPABASE_URL`）
   - `service_role` 密钥（对应 `SUPABASE_SERVICE_ROLE_KEY`，务必保密）

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，填好：

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=你的service_role密钥
SUPABASE_BUCKET=files
JWT_SECRET=一段足够长的随机字符串
```

### 3. 创建初始管理员

```bash
npm install
ADMIN_USERNAME=你的账号 ADMIN_PASSWORD=你的密码 npm run create-admin
```

> Windows（PowerShell）请改为先 `$env:ADMIN_USERNAME="..."`、`$env:ADMIN_PASSWORD="..."`，再 `npm run create-admin`。

### 4. 部署到 Netlify

选择一个方式：

- **A. 拖动上传**：在 Netlify 的 **Deploys** 里拖入本目录文件夹；记得在 **Site settings → Environment variables** 中填入上述 4 个环境变量，并设置 **Build command 留空、Publish directory 填 `public`**。
- **B. Git 连接**：把项目推送到 GitHub/GitLab，在 Netlify 关联仓库；`netlify.toml` 已配置好 发布目录与函数目录，同样需要在站点里配置环境变量。

### 5. 本地调试（可选）

```bash
npm install
npm run dev        # 会启动 netlify dev，自动加载 .env 并代理 /api
```

## 使用说明

1. 用管理员账号登录后，进入「成员管理」添加成员账号与初始密码，分发给他们。
2. 成员登录后即可上传文件、添加备注、下载文件、发表留言。
3. 管理员可编辑/删除任何文件与留言，并可重置成员密码、调整角色。

## 常见问题

- **上传返回 400/403**：确认已在 Supabase 执行过 `schema.sql`，且存储桶名与 `SUPABASE_BUCKET` 一致。
- **登录 401**：确认账号已通过 `create-admin` 或后台创建。
- **文件上传失败但已扣次数**：签名直传有效期 2 小时；中断造成的残留由管理员删除即可。
- **安全问题**：本项目默认允许任意来源调用 API（方便本地调试）。正式上线后建议在 `netlify/functions/api.js` 中的 `corsHeaders` 把 `Access-Control-Allow-Origin` 改为你的站点域名。

## 部署后的数据保存说明

文件本体保存在 Supabase Storage 私有桶中，元数据保存在 Supabase PostgreSQL 中；两者均**不设过期时间**，因此保存时间可超过一年。Supabase 免费额度有限，长期大量使用建议在 Supabase 控制台开启备份，并按需升级。