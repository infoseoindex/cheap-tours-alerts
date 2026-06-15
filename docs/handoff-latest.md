# Latest Handoff

Date: 2026-06-16  
Timezone: Europe/Moscow

## Current State

- Production service: `cheap-tours-alerts`
- Status at handoff: active via systemd
- Runtime: `/usr/local/bin/node /root/cheap-tours-alerts/dist/main.js`
- Project path: `/root/cheap-tours-alerts`
- Repo branch: `main`
- Last known production commit before this handoff work: `8d663bb Add-deal-send-diagnostics`
- Production DB: `/root/cheap-tours-alerts/data/tour-deals.sqlite`
- Current provider: `tourvisor-public`

Recent production observations from `node scripts/db-summary.cjs`:

- `last_run_at`: `2026-06-15T23:10:16.847Z`
- `check_interval_seconds`: `3600`
- `max_alerts_per_check`: `10`
- `no_deal_reports_enabled`: `0`
- `last_best_digest_at`: `2026-06-15T23:10:16.708Z`
- Price history count: `51725`
- Sent alert history count: `225`

Current active preset summary:

- ID: `minsk-vietnam-nhatrang-june`
- Route: Minsk to Vietnam, Nha Trang
- Dates: `2026-06-07` to `2026-06-25`
- Nights: `12-18`
- People: `2 adults, 0 children`
- Meal: `BB`
- Budget: `3000 USD`
- Stars: from `3*`
- Discount threshold: `20%`

## Recent Changes

Recent commits:

- `8d663bb Add-deal-send-diagnostics`
- `d04f68a Add-collaboration-style-notes`
- `4a33865 Hide-duplicate-settings-button`
- `b2d7eb4 Add-currency-param-to-tour-links`
- `7128832 Hide-no-deal-report-controls`
- `5b9fdab Tune-best-deals-menu-and-disable-no-deal-reports`
- `2540d3d Rename-best-tours-menu-button`
- `97127ce Clarify hourly best tours digest title`
- `0451af5 Show explicit links in best tours digest`
- `a92bbdb Add best tours digest`

Product behavior now:

- Immediate deal alerts still send when clean good tours are found.
- No-deal reports are disabled and hidden from Telegram settings.
- `/best` shows the best clean deals from the last 24 hours.
- `/besthour` shows the best clean deals from the last hour.
- Hourly best digest sends once per hour when there are clean deals in the last
  hour.
- Tour links include Tourvisor currency query parameters where possible:
  `currency=5` for USD, `currency=6` for EUR, `currency=0` for RUB.
- Telegram menu uses the current-search button as the main settings entry; the
  duplicate settings button is hidden.
- Logging now includes successful sends:
  `Sent deal message to chat ...` and `Preset ... sent N deal alerts`.

## Open Tasks / Watch Items

- Verify whether Tourvisor public `/t/<shortId>` pages always honor
  `currency=5`. If they still display RUB, this may be a Tourvisor UI limitation
  and not fully fixable by URL alone.
- README still mentions configurable no-deal reports as a visible feature; align
  it with current behavior if docs cleanup is requested.
- Consider adding a Telegram-visible subscriber count or subscriber management
  screen if public usage grows.
- Consider pruning or rotating SQLite history if `price_history` grows too much.
- If more destinations are needed, extend `src/tourvisorDirectory.ts` with safe
  IDs and update validation docs.

## Commands To Check Now

```bash
cd /root/cheap-tours-alerts
git status --short --branch
git log --oneline -10
systemctl is-active cheap-tours-alerts
systemctl status cheap-tours-alerts --no-pager -l
journalctl -u cheap-tours-alerts --since '30 minutes ago' --no-pager
node scripts/db-summary.cjs
```

## Safe Next Step

If continuing from a new Codex/device:

1. Read `docs/START_HERE.md`, `docs/context.md`, this file, `OPERATIONS.md`,
   `README.md`, and `package.json`.
2. Check production with the commands above.
3. If the user asks for UI/menu changes, inspect `src/telegram.ts`.
4. If the user asks for Tourvisor search/link/status changes, inspect
   `src/providers/tourvisorPublicProvider.ts`, `src/worker.ts`, and
   `src/storage.ts`.
5. Make small scoped changes, build on the server, restart systemd, check logs,
   then commit/push GitHub-safe files only.
