# Blog Studio - 开发使用说明指南

欢迎来到您的极客风博客全栈系统！以下是如何运行开发与维护项目的指南。

## 1. 结构概览
- **`frontend`**: Next.js 应用，提供公开博客和管理界面。
- **`backend`**: Go + Gin + GORM 构建的博客 API。

## 2. 前端服务运行
该应用大量使用 React Server Component 进行服务端渲染，且已经为您开启过了 `npm run dev`：
- 若服务已关闭，请打开新终端进入项目的 `frontend` 目录安装并运行：
  ```powershell
  npm install
  npm run dev
  ```
- 打开浏览器访问：`http://localhost:3000`

## 3. 后端服务运行及数据库配置
*目前前端设置了优雅降级（Fallback）展示 Mock 数据，因此不启动后端也不会导致前端崩溃报错。*但如果您准备好管理真实数据，请执行以下操作：
1. 请确保您的电脑上开启了 PostgreSQL 服务（默认运行在 5432 端口），并通过 pgAdmin 或命令行提前建立一个空的数据库：`CREATE DATABASE blog_db;`
2. 在 PowerShell 中进入项目的 `backend` 目录。
3. 设置 PostgreSQL、JWT、服务监听地址和本地浏览器来源。JWT 密钥至少需要 32 字节，生产环境请使用随机生成的独立密钥：
   ```powershell
   $env:DB_DSN = "host=localhost user=postgres password=您的密码 dbname=blog_db port=5432 sslmode=disable TimeZone=Asia/Shanghai"
   $env:JWT_SECRET = "请替换为至少32字节的随机密钥"
   $env:SERVER_ADDRESS = ":8080"
   $env:APP_ENV = "development"
   $env:ALLOWED_ORIGINS = "http://localhost:3000"
   $env:COOKIE_SECURE = "false"
   $env:TRUSTED_PROXIES = ""
   $env:UPLOAD_DIR = "uploads"
   $env:MAX_UPLOAD_BYTES = "10485760"
   ```
4. 启动 Go 进程指令：
   ```bash
   go run ./cmd/server
   ```
系统将在启动的瞬间，依靠 GORM 框架自动向数据库推入所有关联表（`users`、`categories`、`posts`），此后您便能在前后端真实联调！

首次创建管理员时还需要显式提供管理员账号和不少于 12 个字符的强密码：
```powershell
$env:ADMIN_USER = "admin"
$env:ADMIN_PASS = "请替换为不少于12个字符的强密码"
go run ./cmd/seed
```
种子命令不会覆盖已经存在的同名用户。密码为 12–128 个字符且不能超过 72 个 UTF-8 字节，不能使用常见弱密码，也不能包含用户名。

浏览器登录使用 HttpOnly Cookie，会话不会写入 localStorage。退出登录或修改密码会立即使旧会话失效。运行时健康检查、请求日志和关闭行为请参阅 [`docs/runtime-operations.md`](docs/runtime-operations.md)，生产安全配置请参阅 [`docs/security.md`](docs/security.md)，文件上传与存储规则请参阅 [`docs/file-storage.md`](docs/file-storage.md)，自动化测试说明请参阅 [`docs/testing.md`](docs/testing.md)。

## 4. 样式拓展
全站样式位于 `frontend/src/app/globals.css` 中：
- `var(--bg-sidebar)` 和 `var(--nav-active)` 控制着侧边栏明暗基调。
- 如需更改系统强调色，可修改 CSS 中的 `var(--accent-*)` 系列色卡。
