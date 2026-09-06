# Daily History

## 2026-06-16

- Created structured handoff docs for continuation from a new device/Codex:
  `docs/START_HERE.md`, `docs/context.md`, `docs/handoff-latest.md`, and this
  file.
- Verified production service is systemd-managed and active.
- Verified production path `/root/cheap-tours-alerts`.
- Verified recent logs show successful Telegram sends to the admin chat.
- Verified current DB summary with hourly interval, no-deal reports disabled,
  active Minsk -> Vietnam/Nha Trang preset, and recent USD observations.
- No secrets were copied into docs.


## 2026-09-06

- Investigated cheaper manual Tourvisor offer and reproduced GetDatabaseFail
  incorrectly treated as sold; also reproduced early polling and omitted blocks.
- Implemented full result polling, operator retry, uncertain availability handling,
  refreshed price ranking, local constraints and per-card skip diagnostics.
- Added eleven regression cases; tests and TypeScript build passed.
- Live corrected-card check retained the 2352 USD example with a warning.
- Current search settings are recorded in the latest handoff, replacing stale
  June settings. Production settings and database schema were not changed.
- Control search completed at 100%, retried missing operators, and returned
  113 merged unique offers. The exact Voyazhtur example was still absent.
- Deployed and restarted systemd successfully at 14:42 Moscow; service active.
- First automatic cycle received 73 tours and recorded 48 eligible observations.
  Detected Telegram rejection of relative operator booking links; fixed fallback
  to valid absolute URLs and accurate delivery counts. Added regression coverage.
- Added explicit operator service refusal to unavailable classification.
- Rebuilt and restarted with both follow-up fixes; 11 tests passed.
