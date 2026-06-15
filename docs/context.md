# Project Context

## Product

Cheap Tours Alerts is a Telegram bot that monitors Tourvisor public search for
cheap vacation tours and sends actionable alerts.

Current production bot:

- Telegram bot: `@CheapToursAlertsBot`
- Public link: `https://t.me/CheapToursAlertsBot`
- Main search: Minsk to Vietnam/Nha Trang
- Current budget currency: USD
- Current provider: `tourvisor-public`

The bot:

- searches Tourvisor periodically;
- filters by departure, country, resort, dates, nights, people, meal, stars,
  budget, hotel filters, and discount baseline;
- verifies Tourvisor tour availability before alerting;
- skips sold/unavailable tours;
- sends deal alerts to the admin and active subscribers;
- stores price history and clean deal observations in SQLite;
- supports `/best` for best 24-hour deals and `/besthour` for best 1-hour
  deals;
- sends an hourly best-deals digest when there are clean deals in the last hour;
- keeps no-deal reports disabled and hidden from Telegram settings.

## Repository And Runtime

- GitHub: `git@github.com:infoseoindex/cheap-tours-alerts.git`
- Branch: `main`
- Production path: `/root/cheap-tours-alerts`
- Runtime: Node.js 20
- Entrypoint: `/root/cheap-tours-alerts/dist/main.js`
- Database: `/root/cheap-tours-alerts/data/tour-deals.sqlite`
- Secrets: `/root/cheap-tours-alerts/.env`

Do not print, copy, or commit real token values from `.env`.

## How It Is Run

Production is systemd, not PM2, Docker, cron, or Vercel.

Service:

```text
cheap-tours-alerts
```

Unit:

```ini
[Unit]
Description=Cheap Tours Telegram Alerts Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/root/cheap-tours-alerts
EnvironmentFile=/root/cheap-tours-alerts/.env
ExecStart=/usr/local/bin/node /root/cheap-tours-alerts/dist/main.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## Commands

Install/build:

```bash
cd /root/cheap-tours-alerts
npm ci
npm run build
```

Restart safely:

```bash
systemctl restart cheap-tours-alerts
systemctl is-active cheap-tours-alerts
journalctl -u cheap-tours-alerts --since '5 minutes ago' --no-pager
```

Check production:

```bash
cd /root/cheap-tours-alerts
git status --short --branch
git log --oneline -10
node scripts/db-summary.cjs
systemctl status cheap-tours-alerts --no-pager -l
journalctl -u cheap-tours-alerts --since '30 minutes ago' --no-pager
```

Deploy code:

```bash
cd /root/cheap-tours-alerts
npm run build
systemctl restart cheap-tours-alerts
systemctl is-active cheap-tours-alerts
journalctl -u cheap-tours-alerts --since '5 minutes ago' --no-pager
git status --short
git add <safe files only>
git commit -m 'Describe change'
git push
```

## Environment Variables

Required names only, no secret values:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_CHAT_ID`
- `CHECK_INTERVAL_SECONDS`
- `DATABASE_PATH`
- `PROVIDER`
- `LOG_LEVEL`
- `TOURVISOR_MODSEARCH_URL`
- `TOURVISOR_MODRESULT_URL`
- `TOURVISOR_API_BASE_URL`
- `TOURVISOR_API_KEY`
- `TOURVISOR_SEARCH_URL_TEMPLATE`
- `USD_TO_RUB`
- `EUR_TO_RUB`
- `SEARCH_PRESETS_JSON`

## Logs

System logs:

```bash
journalctl -u cheap-tours-alerts --since '30 minutes ago' --no-pager
```

Useful successful-send lines:

```text
Sent deal message to chat <chat_id>
Preset <preset_id>: sent <N> deal alerts
```

Tourvisor may intermittently return 401, 500, or 502. The bot restarts via
systemd if the process dies, and the worker schedules the next check after
errors.

## Safety Rules

- Never commit `.env`, `data/`, `dist/`, `node_modules/`, keys, or raw session
  artifacts.
- Never paste real Telegram tokens into docs or chat.
- Treat the SQLite database as production state, not source code.
- Use GitHub for code/docs/config examples only.
- Check `git status --short --branch` before and after edits.
- If the worktree is dirty, identify whether changes are user changes before
  touching them.
- Prefer server-side `npm run build` before restarting production.
- Do not run destructive git commands such as `git reset --hard` unless the user
  explicitly requests them.

