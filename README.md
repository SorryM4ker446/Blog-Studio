# Blog Studio - 开发使用说明指南

欢迎来到您的极客风博客全栈系统！以下是如何运行开发与维护项目的指南。

## 1. 结构概览
- **[Frontend] `d:\blog\frontend`**: Next.js 14 应用框架，构建了顶级 AI Studio 观感的深色系统 UI。
- **[Backend] `d:\blog\backend`**: Go 1.22 + Gin + GORM 构建的轻量级博客后端。

## 2. 前端服务运行
该应用大量使用 React Server Component 进行服务端渲染，且已经为您开启过了 `npm run dev`：
- 若服务已关闭，请打开新终端进入 `d:\blog\frontend` 安装/运行：
  ```bash
  npm install
  npm run dev
  ```
- 打开浏览器访问：`http://localhost:3000`

## 3. 后端服务运行及数据库配置
*目前前端设置了优雅降级（Fallback）展示 Mock 数据，因此不启动后端也不会导致前端崩溃报错。*但如果您准备好管理真实数据，请执行以下操作：
1. 请确保您的电脑上开启了 PostgreSQL 服务（默认运行在 5432 端口），并通过 pgAdmin 或命令行提前建立一个空的数据库：`CREATE DATABASE blog_db;`
2. 在任意支持 `.exe` 变量的 CLI 中，进入 `d:\blog\backend`
3. 设置您的 PostgreSQL 配置环境变量：
   ```bash
   set DB_DSN=host=localhost user=postgres password=您的密码 dbname=blog_db port=5432 sslmode=disable TimeZone=Asia/Shanghai
   ```
4. 启动 Go 进程指令：
   ```bash
   go run ./cmd/server/main.go
   ```
系统将在启动的瞬间，依靠 GORM 框架自动向数据库推入所有关联表（`users`、`categories`、`posts`），此后您便能在前后端真实联调！

## 4. 样式拓展
全站样式位于 `d:\blog\frontend\src\app\globals.css` 中：
- `var(--bg-sidebar)` 和 `var(--nav-active)` 控制着侧边栏明暗基调。
- 如需更改系统强调色，可修改 CSS 中的 `var(--accent-*)` 系列色卡。
