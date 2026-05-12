import { TEAM_SCHEDULE } from "../../src/lib/team-schedule.js";
import { listRegistrations } from "../../src/lib/repository.js";
import { getSupabase } from "../../src/lib/supabase.js";

function sendJson(response: any, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(payload));
}

export default async function handler(_request: any, response: any) {
  try {
    const registrations = await listRegistrations(getSupabase());
    const registrationByMember = new Map(registrations.map((r) => [r.member_id, r]));

    const members = TEAM_SCHEDULE.map((member) => {
      const registration = registrationByMember.get(member.id);
      return {
        id: member.id,
        name: member.name,
        timezone: member.timezone,
        shift_start_utc: member.shiftStartUtc,
        shift_end_utc: member.shiftEndUtc,
        registered: Boolean(registration),
        telegram_username: registration?.telegram_username ?? null,
        telegram_user_id: registration?.telegram_user_id ?? null
      };
    });

    sendJson(response, 200, { ok: true, members });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
