import { TEAM_SCHEDULE } from "./team-schedule.js";
import { eq, type SupabaseRestClient, type TimeLog, params } from "./supabase.js";
import { formatDuration, utcDateKey } from "./time.js";

export async function buildDailyReport(db: SupabaseRestClient, date = new Date()): Promise<string> {
  const reportDate = utcDateKey(new Date(date.getTime() - 24 * 60 * 60_000));
  const logs = await db.select<TimeLog>("time_logs", params(eq("work_date_utc", reportDate)));

  const lines = TEAM_SCHEDULE.map((member) => {
    const log = logs.find((item) => item.member_id === member.id);
    if (!log) return `${member.name} — No record`;
    if (log.status === "absent") return `${member.name} — Absent`;

    const late = Number(log.late_minutes ?? 0);
    const worked = Number(log.worked_minutes ?? 0);
    const status = log.actual_out_utc ? log.status : "incomplete";
    return `${member.name} — ${status}${late > 0 ? ` — Late ${formatDuration(late)}` : ""}${worked > 0 ? ` — Worked ${formatDuration(worked)}` : ""}`;
  });

  return `📊 Daily Attendance Report\nDate UTC: ${reportDate}\n\n${lines.join("\n")}`;
}
