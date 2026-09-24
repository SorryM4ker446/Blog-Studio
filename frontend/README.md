# Blog Studio frontend

The Next.js frontend provides public article and file browsing, search, and the authenticated content editor. See the [project README](../README.md) for backend and PostgreSQL setup.

## Local development

Use Node.js 22 and the committed npm lockfile. From this directory:

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000>. `NEXT_PUBLIC_API_BASE_URL` is the browser API address; `API_INTERNAL_BASE_URL` is used by the Next.js server. Both default to `http://localhost:8080/api` for native development. Keep credentials out of these URLs.

Routes are in `src/app`, shared components in `src/components`, and global styles in `src/app/globals.css`.

## Checks

```bash
npm run lint
npm run test:unit
npm run test:coverage
npm run build
```

Playwright requires an isolated PostgreSQL test database and starts its own backend and frontend servers. See [testing](../docs/testing.md) for setup, commands and reports.

## Deployment

The production image uses Next.js standalone output behind Caddy. Follow [Docker Compose deployment](../docs/deployment.md) or the [automatic VPS upgrade procedure](../docs/automatic-deployment.md).
