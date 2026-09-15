# Working Management Telegram Bot

A Vercel-ready Telegram attendance bot for the team's UTC schedule. The bot is buttons-first: team members use inline Telegram buttons for registration, Time In, Time Out, activity logs, excuses, absences, shift swaps, and dashboard refreshes.

Alongside the bot, the same Vercel deployment serves a read-only dashboard at the deployment root (`https://YOUR-VERCEL-DOMAIN.vercel.app/`) with three tabs:

- **Activity History** — sortable spreadsheet view of `activity_logs` (Time In, Time Out, Proof Submitted, Excuse, Absent, Shift Swap, etc.) with member + action filters and a search box.
- **Stats** — group message stats per member (`group_message_stats`) with date-range filters and totals.
- **Proof of Work** — full content of every proof-of-work submission (`proof_of_work_submissions`).

The dashboard is public read-only; all attendance actions (Time In, Time Out, Proof of Work, Excuse, Absent, Shift Swap) continue to be performed in the Telegram bot itself.

## Team schedule

| Member | UTC Shift | Local timezone |
| --- | --- | --- |
| Betz | 00:00–05:00 UTC | Asia/Manila |
| Omar | 05:00–10:00 UTC | Africa/Lagos |
| Moh | 10:00–15:00 UTC | Africa/Lagos |
| Pablo | 15:00–20:00 UTC | America/Argentina/Buenos_Aires |
| Dany | 20:00–01:00 UTC | America/Bogota |

Dany's shift crosses midnight, so the timekeeping logic treats the UTC end time as the next day.

## Vercel environment variables

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
# Optional primary group notifications
TEAM_GROUP_CHAT_ID=
# Optional public stats allowlist for multiple Telegram groups (comma- or space-separated)
TEAM_STATS_GROUP_CHAT_IDS=
# Optional support flow switch: old or ai
SUPPORT_MODE=old
```

`SUPABASE_ANON_KEY` is supported only as a fallback, but `SUPABASE_SERVICE_ROLE_KEY` is recommended because the bot runs server-side and performs trusted writes.

No Telegram personal chat ID environment variable is required. The bot saves each user's personal `telegram_chat_id` automatically when they open the bot and register.

`TEAM_GROUP_CHAT_ID` is optional. Set it to your primary Telegram group chat ID if you want the bot to also post team-wide 1-hour and 10-minute pre-shift, shift-start, late-alert, Time Out reminder, missing-Time-Out, and blocked-early-attendance warnings in that group. With this variable set, the primary group also receives a live broadcast each time someone uses the bot's private DM buttons for Time In, Time Out, Proof of Work submission, Excuse, Absent, or Shift Swap — so reminders are not the only messages the group sees.

`TEAM_STATS_GROUP_CHAT_IDS` is optional and controls public message-stat tracking when the bot is present in multiple Telegram groups. Set it to comma- or space-separated chat IDs, for example `TEAM_STATS_GROUP_CHAT_IDS=-1001111111111,-1002222222222`. When this env var is set, only those groups are counted in `group_message_stats` and shown on the dashboard. It also enables a public welcome message when a non-bot user joins one of those configured groups. When it is not set, the bot keeps the previous permissive behavior and counts registered-member messages from any group where the bot receives messages, but does not send automatic welcomes.

Changing `TEAM_GROUP_CHAT_ID` or adding IDs to `TEAM_STATS_GROUP_CHAT_IDS` does not reset Time In, Time Out, Activity History, or Proof of Work submissions. Those records stay member-based; only public message stats are separated by Telegram group chat ID.

If `TEAM_GROUP_CHAT_ID` is not set or its value is wrong, the bot also keeps a stored fallback chat ID in `public.app_settings` (key `team_group_chat_id`). The fallback is populated silently the first time the bot is added to a group (via the `my_chat_member` event) or, when no primary env var is set, the first time a registered member sends any message in a counted group. When `sendTeamGroupMessage` cannot post to the env-var chat (or no env var is set), it transparently retries against the stored fallback and logs a clear warning telling the operator which value to put in Vercel.

## Supabase setup

Run the SQL in [`supabase/schema.sql`](supabase/schema.sql) in your Supabase SQL editor before deploying. The script is idempotent (`create table if not exists`), so it is safe to re-run when new tables or indexes are added.

When upgrading an existing deployment, re-running `supabase/schema.sql` will add the `public.group_action_messages` table that tracks team-group prompt and ack message IDs so old prompts can be cleaned up automatically. It will also add `public.telegram_groups`, which stores each tracked Telegram group's actual title so the web dashboard can show names such as GIMT, GoodDollar, or Support instead of only numeric chat IDs.

Re-run `supabase/schema.sql` after deploying the support-ticket workflow as well. It adds `public.support_tickets`, `public.support_ticket_messages`, and `public.support_ticket_events`; these tables are separate from `activity_logs`, `time_logs`, `proof_of_work_submissions`, and `group_message_stats`.

## Telegram setup

After deployment, set the Telegram webhook:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://YOUR-VERCEL-DOMAIN.vercel.app/api/telegram/webhook","secret_token":"YOUR_TELEGRAM_WEBHOOK_SECRET"}'
```

If Telegram says `Webhook is already set` but the bot still does not reply, first open the deployed webhook endpoint in a browser:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/api/telegram/webhook
```

It should return JSON showing that the endpoint is deployed and which required environment variables are present. For detailed Telegram diagnostics, pass either `TELEGRAM_WEBHOOK_SECRET` or `CRON_SECRET` as `?secret=`:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/api/telegram/webhook?secret=YOUR_TELEGRAM_WEBHOOK_SECRET
```

Check the returned `telegram.webhook.last_error_message` and `telegram.webhook.pending_update_count`. A common cause of a silent bot is a secret mismatch: if `TELEGRAM_WEBHOOK_SECRET` is configured in the deployment, the `setWebhook` call must include the exact same value as `secret_token`; otherwise this app will reject Telegram's POST requests with `401 Unauthorized`.


### Netlify dashboard API routes

On Vercel, files under [`api/`](api) become serverless routes automatically. Netlify does not serve Vercel-style `api/` files directly, so this repository includes [`netlify.toml`](netlify.toml) redirects plus thin wrappers under [`netlify/functions/`](netlify/functions) that forward Netlify Function events to the same API handlers used by Vercel.

If the dashboard loads on Netlify but a table shows an error such as `Failed to load: /api/web/activity?limit=200 → 404`, the static files deployed but the Netlify functions/redirects were not included in that deploy.

Netlify fix checklist:

1. Set the Netlify site base directory to the repository root, not `public/`.
2. Let Netlify use this repo's `netlify.toml`; it sets `publish = "public"` and `functions = "netlify/functions"`.
3. Add the same environment variables in Netlify that you use in Vercel (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, Telegram secrets, and optional group/cron variables).
4. Redeploy the latest commit, then open `https://YOUR-NETLIFY-SITE.netlify.app/api/web/activity?limit=1`; it should return JSON.

## Bot workflow

1. User sends `/start`.
2. Bot saves Telegram user/chat metadata and asks the user to select their name using buttons.
3. User sees the dashboard with UTC and local shift time.
4. User taps buttons for Time In, Time Out, Activity, Excuse, Absent, Shift Swap, Submit Proof, or Refresh.
5. Vercel cron routes send private shift reminders using the saved personal chat IDs, including 1-hour and 10-minute Time In reminders, a shift-start reminder, a 1-hour proof-of-work reminder, a 10-minute Time Out reminder, a shift-end reminder, and missing-Time-Out alerts. Time In and Time Out are gated in both DMs and group action buttons: Time In opens at the scheduled start and Time Out opens at the scheduled end, preventing early attendance records. When `TEAM_GROUP_CHAT_ID` is configured, blocked DM attempts also post a team-wide warning. Once a member’s shift is active, the bot also sends each member a one-time private shift-greeting nudge with a suggested intro message to post in the groups, so everyone knows who’s on support that day. It also posts a public "assistant today" intro in every group listed in `TEAM_STATS_GROUP_CHAT_IDS` — mentioning the on-duty member by `@username` (or a clickable name link when no username is registered) so the community knows who can help them with GoodDollar, face verification, swap, bridge,and more. The intro is deduplicated per group per member per day via `cron_events` (`support_intro:{chatId}:{memberId}:{workDateUtc}`), so it is sent at most once per shift even if the cron reruns. Proof-of-work reminders are sent only while the member has an active Time In and has not timed out, but proof submission remains available after scheduled Time Out and is marked Late when submitted late.
6. When `TEAM_GROUP_CHAT_ID` is configured, the bot also broadcasts each completed DM action (Time In, Time Out, Proof of Work, Excuse, Absent, Shift Swap requests and responses) to the team group so everyone can see attendance status in real time.
7. Group prompts with "Time In Now", "Time Out Now", or "Submit Proof of Work" buttons are tracked by `public.group_action_messages`. As soon as the assigned member completes the action (from either the DM dashboard or the group button), the bot automatically deletes the stale prompts in the group and posts a single unified success summary. The success summary is short-lived: every 5 minutes the timekeeping cron sweeps and removes acknowledgements older than 5 minutes so the group stays uncluttered.
8. When a member who is not the scheduled owner taps a group action button, the bot replies with a Telegram callback alert popup (visible only to that user) instead of posting a noisy "Only X can press this button." line to the group.

The primary UX is buttons. `/start`, `/menu`, and `/help` are kept only as fallback commands to reopen the dashboard.

## Web dashboard

The dashboard lives in the [`public/`](public) folder and is served as a static site at the deployment root URL. It calls these read-only JSON endpoints under [`api/web/`](api/web):

| Endpoint | Purpose |
| --- | --- |
| `GET /api/web/members` | Static team roster + registration state (used to populate the member filter). |
| `GET /api/web/activity?member_id=&action=&limit=` | Paginated `activity_logs` rows, newest first. |
| `GET /api/web/group-stats?member_id=&telegram_chat_id=&from=&to=&limit=` | `group_message_stats` rows enriched with Telegram group names, group list, per-member totals, and per-group totals. |
| `GET /api/web/proof-submissions?member_id=&from=&to=&limit=` | `proof_of_work_submissions` rows, newest first. |

The dashboard is intentionally read-only and has no authentication. Anything sensitive should stay in Supabase row-level security or be omitted from these endpoints.

## Cron routes

Vercel cron runs:

- `/api/cron/timekeeping` every 5 minutes for reminders and late/missing-time-out alerts.
- `/api/cron/daily-report` daily at 01:05 UTC to store a daily summary in activity logs.

On Netlify, configure scheduled calls to the same URLs (`/api/cron/timekeeping` and `/api/cron/daily-report`) with your preferred scheduler, or migrate these wrappers to Netlify Scheduled Functions if you want Netlify to own the schedule.

Both endpoints accept either `Authorization: Bearer $CRON_SECRET` or `?secret=$CRON_SECRET` when `CRON_SECRET` is configured.

## Telegram group chat ID setup

To get `TEAM_GROUP_CHAT_ID`:

1. Deploy the latest bot code first, then add the bot to your Telegram group.
2. If you need to request it manually, send `/chatid@YourBotUsername` in the group. The aliases `/id@YourBotUsername`, `/groupid@YourBotUsername`, and `/start@YourBotUsername` also reply with the same chat ID.
3. If the bot was already in the group before this code was deployed, send `/chatid@YourBotUsername`.
4. Copy the `Chat ID` value from the bot reply. Group IDs are usually negative, for example `-1001234567890`.
5. Add the primary notification group value as `TEAM_GROUP_CHAT_ID` in your Vercel environment variables and redeploy.
6. If you want stats for multiple groups, add every stats group ID to `TEAM_STATS_GROUP_CHAT_IDS`, separated by commas or spaces. Example: `TEAM_STATS_GROUP_CHAT_IDS=-1001111111111,-1002222222222`.

After this is set, `/api/cron/timekeeping` can post group reminders 1 hour and 10 minutes before a member's shift starts, when the shift starts, when a member is late, 1 hour before a member's shift ends for proof-of-work submission, 10 minutes before a member's shift ends for Time Out, when the shift ends, and when a member is missing Time Out. Private DM attempts to Time In before the scheduled start or Time Out before the scheduled end also post a group warning when blocked.

### Timekeeping cron schedule

The reminders are only automatic when the host runs the timekeeping cron on a schedule. Vercel uses `vercel.json` to call `/api/cron/timekeeping` every 5 minutes. Netlify uses `netlify.toml` to run the `cron-timekeeping` scheduled function every 5 minutes; after deploy, confirm the function has a **Scheduled** badge in the Netlify Functions page. The daily report cron runs at 01:05 UTC in both hosts, and the repeated issue report cron runs at 01:15 UTC.

If the cron is not scheduled, manual Time In/Out and Proof of Work submissions can still work, but the group reminder messages will not be sent automatically, including the daily "assistant today" intros in the stats groups.

The "assistant today" intro fires while a member's shift is active and targets only the chat IDs listed in `TEAM_STATS_GROUP_CHAT_IDS`. It never targets `TEAM_GROUP_CHAT_ID` unless that same ID is explicitly included in `TEAM_STATS_GROUP_CHAT_IDS`. It is sent at most once per member per group per UTC work date — tracked by `cron_events` — so each of the 5 daily shift starts posts exactly one intro per group.

### Multiple group stats setup

Use `TEAM_GROUP_CHAT_ID` for the one group that should receive reminders and attendance broadcasts. Use `TEAM_STATS_GROUP_CHAT_IDS` for all groups whose message counts should appear publicly in the Stats dashboard.

Example with one primary notification group plus two additional stats groups:

```env
TEAM_GROUP_CHAT_ID=-1001111111111
TEAM_STATS_GROUP_CHAT_IDS=-1001111111111,-1002222222222,-1003333333333
```

In this example, reminders go to `-1001111111111`, while the dashboard can show separate stats for all three groups. The bot saves group titles from Telegram silently when it is added to a group or receives a registered member's message there, so the Stats tab can display actual group names.

Historical attendance data is not tied to these group IDs. You can move the primary notification group later by changing `TEAM_GROUP_CHAT_ID`; existing Time In, Time Out, Activity History, and Proof of Work rows remain unchanged. New message stats continue under the group chat ID where each message was sent.

### Diagnosing `Bad Request: chat not found` errors

If `/api/cron/timekeeping` logs `Failed to send team group message ... Bad Request: chat not found`, the bot configured by `TELEGRAM_BOT_TOKEN` cannot access the chat in `TEAM_GROUP_CHAT_ID`. Hit the debug endpoint to find out which side is wrong:

```
GET https://<your-deployment>/api/debug/group-chat?secret=<CRON_SECRET>
```

The response includes:

- `bot.username` — the username of the bot the deployment is actually using. Compare with the bot username inside your Telegram group. If they differ, `TELEGRAM_BOT_TOKEN` points to a different bot than the one in your group.
- `team_group_chat_id.configured` — the chat ID the deployment parsed from the env var. Compare with the value `/chatid@YourBotUsername` returns in the target group.
- `chat` — the result of calling Telegram's `getChat` against that chat ID. On success it includes the group's `title` and `type`. On failure it includes the exact Telegram error (`chat not found`, `bot was kicked`, etc.) and a hint.
- `stored_fallback_chat_id` — the chat ID the bot has remembered automatically (from `public.app_settings`). If `value` is null, the bot has not yet observed a registered member message in any group; ask such a member to send any message in the team group and the next call will return a value. When the env-var `getChat` call fails, the endpoint also calls `getChat` on the stored fallback and returns the result as `stored_fallback_chat` so you can confirm the fallback chat is reachable.
- `registrations.members` — the list of team members currently registered with the bot (one entry per row in `public.team_registrations`). Each entry has `member_id`, `member_name`, `telegram_user_id`, `telegram_username`, and `registered_at`. If a member is missing from this list, group messages from their Telegram account will be silently skipped by the per-day message counter — have them DM the bot and `/start` to register.

If `CRON_SECRET` is not set in Vercel, the endpoint is open; otherwise pass it as `?secret=...` or `Authorization: Bearer <CRON_SECRET>`.


## Support mode switch

Set `SUPPORT_MODE=old` to keep keyword-triggered in-group support ticket creation. Set `SUPPORT_MODE=ai` to classify every non-registered group message throughthe AI support flow instead. Both modes now record support tickets silently in the backend without automatic group replies, and switching the env var does not require a Supabase schema change.

Team inbox: when `TEAM_INBOX_MODE=on` (default), support messages from non-registered users in `TEAM_STATS_GROUP_CHAT_IDS` are forwarded via DM to every registered team member, who can tap "💬 Reply" and answer in the group with a clickable name signature. Every customer follow-up is forwarded, and pressing Reply always posts against that ticket's latest customer message rather than the original opening message. When a customer writes during a scheduled shift, only that scheduled responder can reply for the first 10 minutes; other registered members are allowed to cover only after the responder has not replied within that window, even if the scheduled responder has not yet timed in. The inbox sends the complete customer message; messages too long for Telegram's single-message limit continue in additional DMs rather than being shortened. Set `TEAM_INBOX_MODE=off` to disable the forwarding without changing `SUPPORT_MODE` or the AI background classification.

The `ai` flow uses the existing `public.support_tickets`, `public.support_ticket_messages`, and `public.support_ticket_events` tables only; it does not require a new Supabase table. AI cases are marked in ticket text/event metadata with `supportMode: "ai"`, the detected dashboard category, and the dashboard status for production tracking.

In `ai` mode, non-registered group users are classified silently in the backend for topics such as claiming G$, GoodWallet claiming failures, face verification failures, wallet connection issues, MiniPay GoodDapp swap failures, gas fee issues, importing wallets/G$ tokens, missing rewards, transaction failures, generic failures/errors, pending follow-ups, screenshots/errors, or unknown issues. The bot no longer posts AI support responses or solved/not-solved buttons in the group chat; it records the ticket, category metadata, attachments, and events so moderators can review the conversation in the dashboard.

The support dashboard also enriches each ticket with moderator-assist insights computed from the ticket history: a short conversation summary, suggested next action, evidence checklist, risk flags, and language/translation assist for common non-English messages. The support-ticket API returns `issue_stats` so the Support Tickets and Ticket Search views can show repeated issue counts by category, including open/needs-moderator/closed totals for the current filters. Each issue also carries its own report period (`period_from`/`period_to`) and a `daily_counts` breakdown, so the panel shows both the total reports and the exact date range the issue spans. Bot-authored support messages are filtered out of the dashboard conversation view. These insights are generated from existing ticket rows and do not require extra Supabase tables.

## Repeated issue report

The repeated issue monitor answers two questions: how many reports did each issue get, and over what period. Every category in the Support Tickets and Ticket Search panels shows:

- `count` — total tickets for that issue inside the current ticket filter.
- `period_from` / `period_to` — the issue's own first and last ticket date, rendered as e.g. `September 1, 2025 to September 2, 2025`.
- `daily_counts` — per-UTC-day ticket counts across that period, so a spike on a single day is visible.
- `open_count`, `needs_moderator_count`, `closed_count` — status split for the issue.

### Daily Telegram report

`/api/cron/repeated-issue-report` runs at 01:15 UTC and posts a plain-text summary to `TEAM_GROUP_CHAT_ID`. The default window is the report date plus the six preceding UTC days (a rolling 7-day report), and the message states the period explicitly:

```text
📊 Repeated Issue Report
Report date: September 7, 2025
Period: September 1, 2025 to September 7, 2025 (7 days)
Tickets in period: 42
Tickets today: 6

Issues by total reports:
• MiniPay GoodDapp Swap Failed — 12 total (2 today, 4 open)
   Report period: September 1, 2025 to September 7, 2025
   Busiest days: 2025-09-03: 4 · 2025-09-05: 3 · 2025-09-02: 2
```

The run is recorded in `activity_logs` as `REPEATED_ISSUE_REPORT`, and the last delivered report date is stored in `app_settings.repeated_issue_report_last_date` so the cron never double-posts on the same UTC day.

Manual runs:

```bash
# Send today's default 7-day report (re-sends even if already sent today)
curl "https://<your-deployment>/api/cron/repeated-issue-report?force=1&secret=<CRON_SECRET>"

# Report a specific window, e.g. September 1 to September 7
curl "https://<your-deployment>/api/cron/repeated-issue-report?from=2025-09-01&to=2025-09-07&secret=<CRON_SECRET>"
```

### Detection coverage

User reports about `swap`, generic `failed`/`error` messages, `verification failed`, and `cannot claim` are classified into the AI support categories before they reach the report. Common misspellings (`fialed`, `faild`, `eror`, `verificationfailed`) and Tagalog variants (`hindi maka swap`, `di maka claim`, `hindi ma verify`, `ayaw gumana`) map to the same categories as their correct-English equivalents. Generic failure text that does not match a specific category falls into `General Failure / Error` and is flagged for moderator review. Tickets created before the AI flow are classified with the same rules at report time, so historical rows appear in the report without backfilling.

## In-group support ticket workflow

The bot can open lightweight support tickets directly inside Telegram groups without mixing that history into attendance, activity, or proof-of-work records. When a non-registered group participant sends a support-style text such as `/support`, `/ticket`, `help`, `hello`, `hi`, `complaint`, `issue`, `problem`, or `not working`, the bot creates a row in `public.support_tickets`, records the opening message in `public.support_ticket_messages`, and records a `ticket_opened` event in `public.support_ticket_events` without posting an automatic support reply in the group.

Backend-only flow:

1. The requester sends a support-style message in a group.
2. The bot silently records the ticket and customer message for dashboard review.
3. If the scheduled support member is actively timed in, the ticket is automatically assigned to that member in the backend; otherwise it remains open for a registered support member to handle.
4. When a registered support member replies to an active ticket thread, the bot records the reply and connects the ticket to that responder in the backend. If a different member handles the ticket during another member's scheduled duty window, the scheduled-duty owner and coverage handoff are still saved for dashboard audit history.
5. Solved/not-solved resolution prompts are disabled. The dashboard conversation is the source of truth for review.
6. The timekeeping cron automatically closes active support tickets as `expired` with `closed_at` when the requester has not sent another message on that current ticket for 1 hour. The bot does not post a group notification for this auto-close.
7. If the requester messages again after that auto-close, there is no active ticket for that user/chat anymore, so the bot creates a new ticket and starts a new backend-only history.

Support ticket history is intentionally independent from attendance and activity history. Non-registered requesters are not counted in team stats, while registered team members’ ordinary group replies can still be counted in `group_message_stats` as normal team activity. The dashboard has a **Support Tickets** tab for reviewing assigned responders, scheduled-duty owners, and off-duty coverage handoffs.

## Group chat activity analytics

When `TEAM_GROUP_CHAT_ID` is configured, the bot keeps a daily counter of how many messages each registered team member sends in the team group. Counts are stored in `public.group_message_stats` (one row per `(member_id, telegram_chat_id, work_date_utc)`) and incremented atomically via the SQL function `public.increment_group_message_count`. Rows are never deleted, so the table acts as a permanent, per-day activity log you can query directly in Supabase.

Example query — last 7 days of activity per member:

```sql
select member_name, work_date_utc, message_count, last_message_at_utc
from public.group_message_stats
where work_date_utc >= current_date - interval '7 days'
order by work_date_utc desc, message_count desc;
```

Behavior:

- Any message in a group from a registered team member is counted, and the bot remembers that chat as the team group fallback in `public.app_settings`. If `TEAM_GROUP_CHAT_ID` is set to a different chat, the bot still counts the message and logs a one-time warning so the operator can update the env var.
- Only messages from team members who have registered with the bot in DM are counted; messages from visitors / non-registered users are skipped silently.
- Slash commands (`/start`, `/menu`, `/help`, `/chatid*`, etc.) handled by the bot are NOT counted, since they are intercepted before the tracking step.
- Every other message type that Telegram delivers (text, photos, videos, stickers, GIFs, voice notes, etc.) increments the day's counter for that member.
- The day boundary is UTC, matching the rest of the timekeeping system.

**Important — bot must see group messages.** Telegram bots in Group Privacy mode only receive commands and direct mentions, so the message counter would always be zero. Disable Group Privacy in BotFather: open `@BotFather`, send `/setprivacy`, select the bot, then choose **Disable**. Alternatively, promote the bot to admin in the group — admin bots always receive every message regardless of the privacy setting. After changing the setting, remove the bot from the group and re-add it for the change to take effect.

## Proof of work reminders

The timekeeping cron sends proof-of-work reminders 1 hour before each member's scheduled out time, within the existing 5-minute cron window, but only when that member is already timed in and has not timed out. The reminder is sent to the member's personal Telegram chat and, when `TEAM_GROUP_CHAT_ID` is configured, to the team group.

Reminder text:

```text
Hi Betz, please attach your proof of work here. Links, notes, user/respondent links, screenshot links, or any valid proof are accepted.

⚠️ Important: one proof submission is accepted per work date. Proof sent after your scheduled Time Out will be marked Late.
```

Team members can tap **Submit Proof of Work** from the reminder or **Submit Proof** from the dashboard. Any non-empty text is accepted and saved to `proof_of_work_submissions` after the member has timed in for that work date, even if the scheduled out time or actual Time Out has already passed. Only one proof submission is accepted per team member per work date; submissions after the scheduled out time are stored with `status = late`, and sent reminder tracking is saved to `proof_of_work_reminders`.
