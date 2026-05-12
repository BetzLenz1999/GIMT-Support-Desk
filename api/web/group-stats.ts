import { eq, inList, limit, order, params, type GroupMessageStat, type GroupMessageStatWithGroup, type TelegramGroup } from "../../src/lib/supabase.js";
import { getSupabase } from "../../src/lib/supabase.js";
import { getStatsGroupChatIds } from "../../src/lib/group-notifications.js";

function sendJson(response: any, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(payload));
}

function parseInteger(value: string | null, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseChatId(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function gteParam(field: string, value: string): [string, string] {
  return [field, `gte.${value}`];
}

function lteParam(field: string, value: string): [string, string] {
  return [field, `lte.${value}`];
}

function groupDisplayName(group: Pick<TelegramGroup, "telegram_chat_id" | "title">): string {
  return group.title?.trim() || `Chat ${group.telegram_chat_id}`;
}

export default async function handler(request: any, response: any) {
  try {
    const url = new URL(request.url ?? "/", "https://example.com");
    const memberId = url.searchParams.get("member_id");
    const groupChatId = parseChatId(url.searchParams.get("telegram_chat_id"));
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const rowLimit = parseInteger(url.searchParams.get("limit"), 200, 1, 1000);

    const configuredStatsGroupIds = getStatsGroupChatIds();
    const allowedGroupIds = groupChatId !== null ? [groupChatId] : configuredStatsGroupIds;

    const filters: [string, string][] = [order("work_date_utc", false), limit(rowLimit)];
    if (memberId) filters.push(eq("member_id", memberId));
    if (allowedGroupIds.length > 0) filters.push(inList("telegram_chat_id", allowedGroupIds));
    if (from) filters.push(gteParam("work_date_utc", from));
    if (to) filters.push(lteParam("work_date_utc", to));

    const db = getSupabase();
    const rows = await db.select<GroupMessageStat>("group_message_stats", params(...filters));

    let groups: TelegramGroup[] = [];
    try {
      const groupFilters: [string, string][] = [order("title", true)];
      if (configuredStatsGroupIds.length > 0) groupFilters.push(inList("telegram_chat_id", configuredStatsGroupIds));
      groups = await db.select<TelegramGroup>("telegram_groups", params(...groupFilters));
    } catch (error) {
      console.warn(`Could not load telegram_groups metadata: ${error instanceof Error ? error.message : String(error)}`);
    }

    const groupMap = new Map(groups.map((group) => [group.telegram_chat_id, group]));
    for (const row of rows) {
      if (!groupMap.has(row.telegram_chat_id)) {
        groupMap.set(row.telegram_chat_id, {
          telegram_chat_id: row.telegram_chat_id,
          title: null,
          type: "unknown",
          is_active: true,
          first_seen_at: row.created_at,
          last_seen_at: row.updated_at,
          updated_at: row.updated_at
        });
      }
    }

    const enrichedRows: GroupMessageStatWithGroup[] = rows.map((row) => {
      const group = groupMap.get(row.telegram_chat_id);
      return {
        ...row,
        group_title: group?.title ?? null,
        group_type: group?.type ?? null
      };
    });

    const totalsByMember = new Map<string, { member_id: string; member_name: string; total: number }>();
    const totalsByGroup = new Map<number, { telegram_chat_id: number; title: string | null; display_name: string; total: number }>();
    for (const row of enrichedRows) {
      const memberEntry = totalsByMember.get(row.member_id) ?? {
        member_id: row.member_id,
        member_name: row.member_name,
        total: 0
      };
      memberEntry.total += row.message_count;
      totalsByMember.set(row.member_id, memberEntry);

      const group = groupMap.get(row.telegram_chat_id) ?? { telegram_chat_id: row.telegram_chat_id, title: null };
      const groupEntry = totalsByGroup.get(row.telegram_chat_id) ?? {
        telegram_chat_id: row.telegram_chat_id,
        title: group.title ?? null,
        display_name: groupDisplayName(group),
        total: 0
      };
      groupEntry.total += row.message_count;
      totalsByGroup.set(row.telegram_chat_id, groupEntry);
    }

    sendJson(response, 200, {
      ok: true,
      count: enrichedRows.length,
      group_stats: enrichedRows,
      groups: Array.from(groupMap.values())
        .map((group) => ({
          telegram_chat_id: group.telegram_chat_id,
          title: group.title,
          display_name: groupDisplayName(group),
          type: group.type,
          is_active: group.is_active
        }))
        .sort((a, b) => a.display_name.localeCompare(b.display_name)),
      totals_by_member: Array.from(totalsByMember.values()).sort((a, b) => b.total - a.total),
      totals_by_group: Array.from(totalsByGroup.values()).sort((a, b) => b.total - a.total)
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
