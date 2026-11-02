---
status: dormant
last_touched: 2026-06-04
deploy: railway up
---

# MMP — Model Messaging Protocol

Reference implementation of MMP, an open protocol for person-to-person messaging through AI assistants with E2E encryption.

## Structure

- `server/` — Node.js/TypeScript server (Express, better-sqlite3, TweetNaCl)
- `app/` — React inbox UI (Vite)
- `spec/` — Protocol specification docs
- `mmp-stdio-bridge.mjs` / `mmp-local-bridge.mjs` — MCP bridge adapters
- `Dockerfile` — Container deployment

## Commands

```bash
cd server && npm run dev   # Start dev server
cd server && npm test      # Run tests (vitest)
cd server && npm run build # Compile TypeScript
```
