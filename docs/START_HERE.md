# Start Here

Use this file when continuing Cheap Tours Alerts from a new device, Codex
thread, or recovery session.

## Bootstrap Prompt For New Codex

```text
Continue the Cheap Tours Alerts Telegram bot project.

First read these files:
- docs/START_HERE.md
- docs/context.md
- docs/handoff-latest.md
- docs/daily-history.md
- OPERATIONS.md
- README.md
- package.json

Work style:
- explain steps in simple language;
- preserve behavior that already works;
- keep Telegram menus clean and avoid duplicate buttons;
- do not touch secrets, .env, SQLite data, dist, node_modules, raw reports, keys, or session files;
- before code changes, inspect the current repo and production service;
- after code changes, run npm run build on the server, restart systemd safely, check logs/status, then commit and push only GitHub-safe files;
- update handoff docs when product behavior or operations change.

Production facts:
- Bot: @CheapToursAlertsBot
- Repo: git@github.com:infoseoindex/cheap-tours-alerts.git
- Server path: /root/cheap-tours-alerts
- Service: cheap-tours-alerts via systemd
- Runtime: Node.js 20, dist/main.js
- Secrets: /root/cheap-tours-alerts/.env, never print or commit token values.

Start with:
cd /root/cheap-tours-alerts
git status --short --branch
systemctl is-active cheap-tours-alerts
journalctl -u cheap-tours-alerts --since '30 minutes ago' --no-pager
node scripts/db-summary.cjs
```

## First Checks

Run on the production server:

```bash
cd /root/cheap-tours-alerts
git status --short --branch
git log --oneline -10
systemctl status cheap-tours-alerts --no-pager -l
journalctl -u cheap-tours-alerts --since '30 minutes ago' --no-pager
node scripts/db-summary.cjs
```

## Safe Files To Commit

Usually safe:

- `README.md`
- `OPERATIONS.md`
- `docs/**`
- `src/**`
- `scripts/**`
- `.env.example`
- `.env.*.example`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `Dockerfile`
- `docker-compose.yml`

Never commit:

- `.env`
- `data/**`
- `dist/**`
- `node_modules/**`
- private keys
- raw browser/session dumps
- Telegram tokens or chat secrets

