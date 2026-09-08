# AGENTS.md

## Project

Telegram work-management/support bot ("GIMT-Support-Desk"). TypeScript, NodeNext modules. Build check: `npm install` then `npm run typecheck` (tsc --noEmit). No test suite exists.

## Support/ticket flow

- Non-registered users in groups: old mode opens keyword support tickets; `ai` mode classifies every non-registered message into AI support tickets. Tickets are recorded silently (`support_tickets`, `support_ticket_messages`, `support_ticket_events`) without group replies.

- `TEAM_INBOX_MODE=on` (off by default) DMs every registered team member when a non-user support message/follow-up lands in a tracked group (`TEAM_STATS_GROUP_CHAT_IDS` or `TEAM_GROUP_CHAT_ID`). Member taps **💬 Reply** (callback `support:reply:<ticketId>`, keyboard `supportReplyKeyboard`), bot sets conversation state `awaiting_support_reply`, and the member's DM text is posted back in the group as the bot with a clickable member signature (`@username (Name)` or `tg://user?id=` link), logged as `support_reply_posted` event, first responder becomes assigned member. Text-only; other attachment types are recorded but not reposted.
- Core helpers in `src/lib/bot.ts`: `notifyTeamMembersOfSupportMessage`, `handleSupportReplyCallback`, `handleSupportReplyMessage`, `buildSupportMention`, `postSupportReplyAsBot`, `truncateMessage`, `isTeamInboxTargetChat`. Notify hooks run at end of `openSupportTicket`, `handleAiSupportMessage`, `recordCustomerTicketFollowUp`, and the reopened-branch of `handleAiSupportTicketFollowUp`.