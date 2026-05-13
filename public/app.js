// Working Management — read-only dashboard SPA
// Plain ES module served from /public; no build step required.

const ACTION_LABEL = {
  time_in: "Time In",
  time_out: "Time Out",
  proof_submitted: "Proof Submitted",
  proof_reminder_sent: "Proof Reminder",
  excuse_requested: "Excuse Requested",
  absent_requested: "Absent Requested",
  shift_swap_requested: "Shift Swap Requested",
  shift_swap_response: "Shift Swap Response",
  registered: "Registered"
};

const ACTION_PILL = {
  time_in: "pill-green",
  time_out: "pill-blue",
  proof_submitted: "pill-green",
  proof_reminder_sent: "pill-yellow",
  excuse_requested: "pill-yellow",
  absent_requested: "pill-red",
  shift_swap_requested: "pill-slate",
  shift_swap_response: "pill-slate",
  registered: "pill-slate"
};

const PROOF_STATUS_PILL = {
  submitted: "pill-green",
  pending: "pill-yellow",
  failed: "pill-red"
};

const TICKET_STATUS_PILL = {
  open: "pill-yellow",
  accepted: "pill-blue",
  pending_user_resolution: "pill-yellow",
  pending_follow_up: "pill-yellow",
  solved_closed: "pill-green",
  not_solved_closed: "pill-red",
  closed_by_team: "pill-slate",
  expired: "pill-slate"
};

const TICKET_STATUS_LABEL = {
  open: "Open",
  accepted: "Accepted",
  pending_user_resolution: "Waiting for user",
  pending_follow_up: "Pending follow-up",
  solved_closed: "Solved",
  not_solved_closed: "Not solved",
  closed_by_team: "Closed by team",
  expired: "Expired"
};

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const state = {
  currentTab: "home",
  members: [],
  activity: {
    rows: [],
    sort: { key: "created_at", ascending: false },
    filters: { member_id: "", action: "", search: "" },
    expandedWeeks: new Set()
  },
  stats: {
    rows: [],
    groups: [],
    selectedGroupId: "",
    grouping: "date",
    expandedWeeks: new Set()
  },
  proof: {
    rows: [],
    expandedWeeks: new Set()
  },
  tickets: {
    rows: [],
    groups: [],
    filters: { assigned_member_id: "", scheduled_member_id: "", status: "", telegram_chat_id: "" },
    expandedIds: new Set()
  },
  memberDetail: {
    open: false,
    memberId: null,
    memberName: null
  }
};

// ---------- helpers ----------

function $(selector, root = document) { return root.querySelector(selector); }
function $all(selector, root = document) { return Array.from(root.querySelectorAll(selector)); }

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[ch]));
}


function sanitizeTicketMessageText(value) {
  return String(value ?? "")
    .replace(/<a\s+href=["']tg:\/\/user\?id=\d+["']\s*>(.*?)<\/a>/gi, "$1")
    .replace(/tg:\/\/user\?id=\d+/gi, "Telegram user")
    .replace(/\b(?:id=)?\d{7,}\b/g, "")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderTicketAttachment(message) {
  if (!message.attachment_url) return "";
  const label = message.attachment_name || message.attachment_type || "Attachment";
  const isImage = ["photo", "image"].includes(message.attachment_type);
  const link = `<a href="${escapeHtml(message.attachment_url)}" target="_blank" rel="noopener" class="text-xs text-blue-600 dark:text-blue-300 hover:underline">Open ${escapeHtml(label)}</a>`;
  if (!isImage) return `<div class="mt-2">${link}</div>`;
  return `
    <div class="mt-2">
      <a href="${escapeHtml(message.attachment_url)}" target="_blank" rel="noopener" class="inline-block">
        <img src="${escapeHtml(message.attachment_url)}" alt="${escapeHtml(label)}" loading="lazy" class="max-h-64 rounded border border-slate-200 dark:border-slate-700 object-contain" />
      </a>
      <div>${link}</div>
    </div>
  `;
}

function fmtTimeUtc(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16) + "Z";
}

function fmtRelative(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function fmtDateHuman(workDateUtc) {
  if (!workDateUtc) return "—";
  const d = new Date(`${workDateUtc}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return workDateUtc;
  return `${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} (${DOW_SHORT[d.getUTCDay()]})`;
}

function pill(cls, text) {
  return `<span class="pill ${cls}">${escapeHtml(text)}</span>`;
}

function memberLink(memberId, memberName) {
  if (!memberId) return escapeHtml(memberName);
  return `<button type="button" class="member-link" data-member-id="${escapeHtml(memberId)}" data-member-name="${escapeHtml(memberName)}">${escapeHtml(memberName)}</button>`;
}

function groupName(row) {
  return row.group_title || `Chat ${row.telegram_chat_id}`;
}

function groupPill(row) {
  return `<span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 mono" title="${escapeHtml(row.telegram_chat_id)}">${escapeHtml(groupName(row))}</span>`;
}

function renderStatsGroupFilter(groups) {
  const select = $("#stats-group-filter");
  const current = state.stats.selectedGroupId;
  select.innerHTML = '<option value="">All groups</option>' + groups
    .map((group) => `<option value="${escapeHtml(group.telegram_chat_id)}">${escapeHtml(group.display_name || group.title || `Chat ${group.telegram_chat_id}`)}</option>`)
    .join("");
  if (current && groups.some((group) => String(group.telegram_chat_id) === current)) {
    select.value = current;
  } else {
    state.stats.selectedGroupId = "";
    select.value = "";
  }
}

function renderTicketsGroupFilter(groups) {
  const select = $("#tickets-group-filter");
  const current = state.tickets.filters.telegram_chat_id;
  select.innerHTML = '<option value="">All groups</option>' + groups
    .map((group) => `<option value="${escapeHtml(group.telegram_chat_id)}">${escapeHtml(group.display_name || group.title || `Chat ${group.telegram_chat_id}`)}</option>`)
    .join("");
  if (current && groups.some((group) => String(group.telegram_chat_id) === current)) {
    select.value = current;
  } else if (current) {
    select.innerHTML += `<option value="${escapeHtml(current)}">Chat ${escapeHtml(current)}</option>`;
    select.value = current;
  } else {
    select.value = "";
  }
}

async function fetchJson(path) {
  const r = await fetch(path, { headers: { accept: "application/json" } });
  if (!r.ok) {
    const deployHint = r.status === 404 && path.startsWith("/api/")
      ? " (API route not found. On Netlify, make sure netlify.toml and netlify/functions are deployed from the repository root; on Vercel, make sure the /api folder is included.)"
      : "";
    throw new Error(`${path} → ${r.status}${deployHint}`);
  }
  const body = await r.json();
  if (body && body.ok === false) throw new Error(body.error || "Request failed");
  return body;
}

function setLastUpdated() {
  $("#last-updated").textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function applySortIndicators(tableSelector, sortKey, ascending) {
  for (const th of $all(`${tableSelector} thead th`)) {
    const key = th.dataset.sortKey;
    if (!key) continue;
    const indicator = th.querySelector(".sort-indicator");
    if (key === sortKey) {
      th.setAttribute("aria-sort", ascending ? "ascending" : "descending");
      if (indicator) indicator.textContent = ascending ? "▲" : "▼";
    } else {
      th.removeAttribute("aria-sort");
      if (indicator) indicator.textContent = "↕";
    }
  }
}

function wireSorting(tableSelector, sortRef, rerender) {
  for (const th of $all(`${tableSelector} thead th`)) {
    th.addEventListener("click", () => {
      const key = th.dataset.sortKey;
      if (!key) return;
      if (sortRef.key === key) {
        sortRef.ascending = !sortRef.ascending;
      } else {
        sortRef.key = key;
        sortRef.ascending = true;
      }
      rerender();
    });
  }
}

// ---------- ISO week helpers (Mon = day 1) ----------

function utcDay(d) {
  const day = d.getUTCDay();
  return day === 0 ? 7 : day; // make Sunday = 7
}

function isoWeekStart(date) {
  // Returns the Monday 00:00 UTC of date's ISO week.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDay(d);
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

function isoWeekEnd(start) {
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 6);
  return end;
}

function isoWeekKey(date) {
  const start = isoWeekStart(date);
  return start.toISOString().slice(0, 10); // YYYY-MM-DD of Monday
}

function weekKeyFromIso(iso) {
  return isoWeekKey(new Date(iso));
}

function weekKeyFromDateString(workDateUtc) {
  return isoWeekKey(new Date(`${workDateUtc}T00:00:00Z`));
}

function currentWeekKey() {
  return isoWeekKey(new Date());
}

function fmtWeekLabel(weekKey) {
  const start = new Date(`${weekKey}T00:00:00Z`);
  const end = isoWeekEnd(start);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const startStr = `${MONTH_SHORT[start.getUTCMonth()]} ${start.getUTCDate()}`;
  const endStr = sameMonth
    ? `${end.getUTCDate()}`
    : `${MONTH_SHORT[end.getUTCMonth()]} ${end.getUTCDate()}`;
  return `${startStr}–${endStr}, ${end.getUTCFullYear()}`;
}

function groupByWeek(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

// ---------- shared: members ----------

async function loadMembers() {
  if (state.members.length) return state.members;
  const data = await fetchJson("/api/web/members");
  state.members = data.members;
  for (const select of $all("[data-members-select]")) {
    select.innerHTML =
      '<option value="">All members</option>' +
      state.members
        .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`)
        .join("");
  }
  return state.members;
}

function memberById(memberId) {
  return state.members.find((m) => m.id === memberId);
}

// ---------- Activity History ----------

function filterActivityRows(rows, filters) {
  const search = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.member_id && row.member_id !== filters.member_id) return false;
    if (filters.action && row.action !== filters.action) return false;
    if (search && !`${row.message ?? ""} ${row.member_name ?? ""} ${row.action ?? ""}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

function sortActivityRows(rows, sort) {
  return rows.slice().sort((a, b) => {
    const cmp = compareValues(a[sort.key], b[sort.key]);
    return sort.ascending ? cmp : -cmp;
  });
}

function renderActivityRow(row) {
  const label = ACTION_LABEL[row.action] || row.action;
  const pillCls = ACTION_PILL[row.action] || "pill-slate";
  const when = fmtTimeUtc(row.created_at);
  const rel = fmtRelative(row.created_at);
  return `
    <tr>
      <td class="mono whitespace-nowrap">
        <div>${escapeHtml(when)}</div>
        <div class="text-[10px] text-slate-400">${escapeHtml(rel)}</div>
      </td>
      <td class="whitespace-nowrap">${memberLink(row.member_id, row.member_name)}</td>
      <td class="whitespace-nowrap">${pill(pillCls, label)}</td>
      <td class="whitespace-pre-wrap break-words">${escapeHtml(row.message)}</td>
    </tr>
  `;
}

function summarizeActionCounts(rows) {
  const counts = new Map();
  for (const r of rows) {
    counts.set(r.action, (counts.get(r.action) || 0) + 1);
  }
  const order = Object.keys(ACTION_LABEL).filter((a) => counts.has(a));
  for (const a of counts.keys()) if (!order.includes(a)) order.push(a);
  return order.map((a) => ({ action: a, label: ACTION_LABEL[a] || a, count: counts.get(a) }));
}

function renderActivity() {
  const { rows, sort, filters, expandedWeeks } = state.activity;
  const filtered = filterActivityRows(rows, filters);
  applySortIndicators("#activity-table", sort.key, sort.ascending);

  const currentKey = currentWeekKey();
  const weekMap = groupByWeek(filtered, (r) => weekKeyFromIso(r.created_at));
  const weekKeys = Array.from(weekMap.keys()).sort().reverse();

  const currentRows = weekMap.get(currentKey) || [];
  const sortedCurrent = sortActivityRows(currentRows, sort);

  const tbody = $("#activity-body");
  if (!sortedCurrent.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-sm text-slate-500 dark:text-slate-400 py-4">No activity in the current week.</td></tr>';
  } else {
    tbody.innerHTML = sortedCurrent.map(renderActivityRow).join("");
  }

  const pastKeys = weekKeys.filter((k) => k !== currentKey);
  const pastContainer = $("#activity-past");
  if (!pastKeys.length) {
    pastContainer.innerHTML = '<p class="text-xs text-slate-500 dark:text-slate-400">No past weeks in the loaded data.</p>';
  } else {
    pastContainer.innerHTML = pastKeys
      .map((key) => {
        const weekRows = weekMap.get(key);
        const sortedWeek = sortActivityRows(weekRows, sort);
        const isOpen = expandedWeeks.has(key);
        const summary = summarizeActionCounts(weekRows);
        const summaryText = summary.length
          ? summary.map((s) => `${s.count} ${s.label}`).join(" · ")
          : `${weekRows.length} entries`;
        return `
          <article class="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <button class="week-toggle" data-week="${escapeHtml(key)}" data-week-section="activity" aria-expanded="${isOpen}">
              <span class="week-chevron">${isOpen ? "▼" : "▶"}</span>
              <span class="week-label">Week ${escapeHtml(fmtWeekLabel(key))}</span>
              <span class="week-meta">${escapeHtml(summaryText)}</span>
            </button>
            ${isOpen ? `
              <div class="overflow-x-auto border-t border-slate-200 dark:border-slate-800">
                <table class="sheet">
                  <thead>
                    <tr>
                      <th>When (UTC)</th>
                      <th>Member</th>
                      <th>Action</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>${sortedWeek.map(renderActivityRow).join("")}</tbody>
                </table>
              </div>
            ` : ""}
          </article>
        `;
      })
      .join("");
  }

  $("#activity-count").textContent =
    `${sortedCurrent.length} current-week row${sortedCurrent.length === 1 ? "" : "s"}` +
    (pastKeys.length ? ` · ${pastKeys.length} past week${pastKeys.length === 1 ? "" : "s"}` : "") +
    (filters.member_id || filters.action || filters.search ? ` (filtered from ${rows.length})` : "");
}

async function loadActivity() {
  const qs = new URLSearchParams({ limit: "200" });
  $("#activity-body").innerHTML = '<tr><td colspan="4" class="text-center text-sm text-slate-500 dark:text-slate-400 py-4">Loading…</td></tr>';
  $("#activity-past").innerHTML = "";
  try {
    const data = await fetchJson(`/api/web/activity?${qs.toString()}`);
    state.activity.rows = data.activities;
    renderActivity();
  } catch (error) {
    $("#activity-body").innerHTML = `<tr><td colspan="4" class="text-center text-sm text-red-600 dark:text-red-400 py-4">Failed to load: ${escapeHtml(error.message)}</td></tr>`;
  }
}

// ---------- Stats ----------

function renderTotalsAside(rows) {
  const totals = new Map();
  const groupTotals = new Map();
  for (const row of rows) {
    const entry = totals.get(row.member_id) ?? { member_id: row.member_id, member_name: row.member_name, total: 0 };
    entry.total += row.message_count;
    totals.set(row.member_id, entry);

    const groupEntry = groupTotals.get(row.telegram_chat_id) ?? { name: groupName(row), total: 0 };
    groupEntry.total += row.message_count;
    groupTotals.set(row.telegram_chat_id, groupEntry);
  }
  const groupSummary = Array.from(groupTotals.values()).sort((a, b) => b.total - a.total);
  $("#stats-group-summary").textContent = groupSummary.length
    ? groupSummary.map((g) => `${g.name}: ${g.total} msg${g.total === 1 ? "" : "s"}`).join(" · ")
    : "";
  const totalList = Array.from(totals.values()).sort((a, b) => b.total - a.total);
  const max = totalList[0]?.total || 1;
  const totalsEl = $("#stats-totals");
  if (!totalList.length) {
    totalsEl.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">No data in this range.</p>';
    return;
  }
  totalsEl.innerHTML = totalList
    .map((t) => {
      const pct = Math.round((t.total / max) * 100);
      return `
        <div class="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5">
          <div class="flex items-center justify-between text-sm">
            <span>${memberLink(t.member_id, t.member_name)}</span>
            <span class="mono text-xs text-slate-500 dark:text-slate-400">${t.total} msgs</span>
          </div>
          <div class="mt-1.5 h-1.5 bg-slate-200 dark:bg-slate-800 rounded overflow-hidden">
            <div class="h-full bg-slate-700 dark:bg-slate-300" style="width:${pct}%"></div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderStatsByDateBody(rows) {
  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.work_date_utc)) byDate.set(row.work_date_utc, []);
    byDate.get(row.work_date_utc).push(row);
  }
  const dates = Array.from(byDate.keys()).sort().reverse();
  if (!dates.length) {
    return '<p class="text-sm text-slate-500 dark:text-slate-400 px-2 py-2">No daily data.</p>';
  }
  return dates
    .map((date) => {
      const dateRows = byDate.get(date).slice().sort((a, b) => b.message_count - a.message_count);
      const total = dateRows.reduce((sum, r) => sum + r.message_count, 0);
      const maxCount = dateRows[0]?.message_count || 1;
      const peakCount = dateRows[0]?.message_count || 0;
      return `
        <div class="px-3 py-2 border-t border-slate-100 dark:border-slate-800 first:border-t-0">
          <div class="flex items-center justify-between mb-1">
            <h5 class="text-sm font-medium">${escapeHtml(fmtDateHuman(date))}</h5>
            <span class="text-xs text-slate-500 dark:text-slate-400 mono">Total: ${total} msgs</span>
          </div>
          <div class="space-y-0.5">
            ${dateRows
              .map((r) => {
                const isPeak = r.message_count === peakCount && peakCount > 0;
                const pct = Math.round((r.message_count / maxCount) * 100);
                return `
                  <div class="stat-row${isPeak ? " peak" : ""}">
                    <span class="stat-name">${isPeak ? '<span class="peak-star" title="Top messenger this day">★</span> ' : ""}${memberLink(r.member_id, r.member_name)} ${groupPill(r)}</span>
                    <div class="stat-bar"><div class="stat-bar-fill" style="width:${pct}%"></div></div>
                    <span class="stat-count">${r.message_count}</span>
                    <span class="stat-last">${escapeHtml(fmtTimeUtc(r.last_message_at_utc))}</span>
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderSparkline(days, max) {
  if (!days.length) return "";
  const width = 80;
  const height = 18;
  const n = days.length;
  const step = n > 1 ? width / (n - 1) : 0;
  const points = days
    .map((d, i) => {
      const x = i * step;
      const y = height - (d.message_count / max) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `
    <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" class="text-slate-500 dark:text-slate-300" />
    </svg>
  `;
}

function renderStatsByMemberBody(rows) {
  const byMember = new Map();
  for (const row of rows) {
    const key = `${row.member_id}:${row.telegram_chat_id}`;
    if (!byMember.has(key)) {
      byMember.set(key, { member_id: row.member_id, member_name: row.member_name, group_name: groupName(row), days: [] });
    }
    byMember.get(key).days.push(row);
  }
  const members = Array.from(byMember.values()).sort((a, b) => {
    const totA = a.days.reduce((s, d) => s + d.message_count, 0);
    const totB = b.days.reduce((s, d) => s + d.message_count, 0);
    return totB - totA;
  });
  if (!members.length) {
    return '<p class="text-sm text-slate-500 dark:text-slate-400 px-2 py-2">No data.</p>';
  }
  return members
    .map((m) => {
      const days = m.days.slice().sort((a, b) => a.work_date_utc.localeCompare(b.work_date_utc));
      const total = days.reduce((s, d) => s + d.message_count, 0);
      const max = Math.max(...days.map((d) => d.message_count), 1);
      const sparkline = renderSparkline(days, max);
      return `
        <div class="px-3 py-2 border-t border-slate-100 dark:border-slate-800 first:border-t-0">
          <div class="flex items-center justify-between mb-1 gap-3">
            <h5 class="text-sm font-medium">${memberLink(m.member_id, m.member_name)} <span class="text-xs text-slate-500 dark:text-slate-400">· ${escapeHtml(m.group_name)}</span></h5>
            <div class="flex items-center gap-3">
              ${sparkline}
              <span class="text-xs text-slate-500 dark:text-slate-400 mono whitespace-nowrap">Total: ${total} msgs</span>
            </div>
          </div>
          <div class="space-y-0.5">
            ${days
              .slice()
              .reverse()
              .map((d) => {
                const pct = Math.round((d.message_count / max) * 100);
                return `
                  <div class="sparkline-row">
                    <span class="spark-date">${escapeHtml(fmtDateHuman(d.work_date_utc))}</span>
                    <div class="spark-bar"><div class="spark-fill" style="width:${pct}%"></div></div>
                    <span class="spark-count">${d.message_count}</span>
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderWeeklyStatsTotals(rows) {
  const totals = new Map();
  for (const row of rows) {
    const entry = totals.get(row.member_id) ?? { member_id: row.member_id, member_name: row.member_name, total: 0 };
    entry.total += row.message_count;
    totals.set(row.member_id, entry);
  }
  const list = Array.from(totals.values()).sort((a, b) => b.total - a.total);
  if (!list.length) return "";
  const max = list[0].total || 1;
  return list
    .map((t) => {
      const pct = Math.round((t.total / max) * 100);
      return `
        <div class="stat-row">
          <span class="stat-name">${memberLink(t.member_id, t.member_name)}</span>
          <div class="stat-bar"><div class="stat-bar-fill" style="width:${pct}%"></div></div>
          <span class="stat-count">${t.total}</span>
          <span class="stat-last">msgs</span>
        </div>
      `;
    })
    .join("");
}

function renderStats() {
  const { rows, grouping, expandedWeeks, selectedGroupId } = state.stats;
  renderTotalsAside(rows);
  const selectedGroup = state.stats.groups.find((group) => String(group.telegram_chat_id) === selectedGroupId);
  const groupSuffix = selectedGroup ? ` · ${selectedGroup.display_name || selectedGroup.title || selectedGroup.telegram_chat_id}` : " · All groups";
  $("#stats-section-title").textContent =
    (grouping === "date" ? "Weekly log (grouped by date)" : "Weekly log (grouped by member)") + groupSuffix;

  const currentKey = currentWeekKey();
  const weekMap = groupByWeek(rows, (r) => weekKeyFromDateString(r.work_date_utc));
  const weekKeys = Array.from(weekMap.keys()).sort().reverse();

  const log = $("#stats-log");
  if (!weekKeys.length) {
    log.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">No data in this range.</p>';
    $("#stats-count").textContent = "";
    return;
  }

  log.innerHTML = weekKeys
    .map((key) => {
      const weekRows = weekMap.get(key);
      const isCurrent = key === currentKey;
      const isOpen = isCurrent || expandedWeeks.has(key);
      const total = weekRows.reduce((s, r) => s + r.message_count, 0);
      const body = grouping === "date" ? renderStatsByDateBody(weekRows) : renderStatsByMemberBody(weekRows);
      const summaryRows = renderWeeklyStatsTotals(weekRows);

      return `
        <article class="rounded-lg border ${isCurrent ? "border-slate-300 dark:border-slate-700" : "border-slate-200 dark:border-slate-800"} bg-white dark:bg-slate-900">
          <button class="week-toggle" data-week="${escapeHtml(key)}" data-week-section="stats" aria-expanded="${isOpen}" ${isCurrent ? 'data-week-current="true"' : ""}>
            <span class="week-chevron">${isOpen ? "▼" : "▶"}</span>
            <span class="week-label">${isCurrent ? "This week" : "Week"} ${escapeHtml(fmtWeekLabel(key))}</span>
            <span class="week-meta">Total: ${total} msgs</span>
          </button>
          ${!isOpen ? `<div class="px-3 pb-2">${summaryRows}</div>` : ""}
          ${isOpen ? `<div class="border-t border-slate-200 dark:border-slate-800">${body}</div>` : ""}
        </article>
      `;
    })
    .join("");

  $("#stats-count").textContent = `${rows.length} row${rows.length === 1 ? "" : "s"} loaded · ${weekKeys.length} week${weekKeys.length === 1 ? "" : "s"}`;
}

async function loadStats() {
  const from = $("#stats-from").value;
  const to = $("#stats-to").value;
  const qs = new URLSearchParams({ limit: "1000" });
  if (state.stats.selectedGroupId) qs.set("telegram_chat_id", state.stats.selectedGroupId);
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  $("#stats-log").innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">Loading…</p>';
  $("#stats-totals").innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">Loading…</p>';
  try {
    const data = await fetchJson(`/api/web/group-stats?${qs.toString()}`);
    state.stats.rows = data.group_stats;
    state.stats.groups = data.groups || [];
    renderStatsGroupFilter(state.stats.groups);
    renderStats();
  } catch (error) {
    $("#stats-log").innerHTML = `<p class="text-sm text-red-600 dark:text-red-400">Failed: ${escapeHtml(error.message)}</p>`;
    $("#stats-totals").innerHTML = "";
  }
}

function setStatsGrouping(grouping) {
  state.stats.grouping = grouping;
  $("#stats-group-date").setAttribute("aria-selected", grouping === "date" ? "true" : "false");
  $("#stats-group-member").setAttribute("aria-selected", grouping === "member" ? "true" : "false");
  renderStats();
}

// ---------- Proof of Work ----------

function renderProofCard(row) {
  const statusCls = PROOF_STATUS_PILL[row.status] || "pill-slate";
  return `
    <article class="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
      <header class="flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2 flex-wrap">
          ${pill("pill-slate", row.work_date_utc)}
          <span>${memberLink(row.member_id, row.member_name)}</span>
          ${pill(statusCls, row.status)}
          ${row.proof_type ? pill("pill-blue", row.proof_type) : ""}
        </div>
        <div class="text-xs text-slate-500 dark:text-slate-400 mono">${escapeHtml(fmtTimeUtc(row.submitted_at_utc))}</div>
      </header>
      <pre class="mt-2 text-sm whitespace-pre-wrap break-words text-slate-800 dark:text-slate-100 font-sans">${escapeHtml(row.proof_content)}</pre>
    </article>
  `;
}

function renderProof() {
  const list = $("#proof-list");
  const rows = state.proof.rows;
  const { expandedWeeks } = state.proof;

  if (!rows.length) {
    list.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">No proof of work submissions in this view.</p>';
    $("#proof-count").textContent = "0 submissions";
    return;
  }

  const currentKey = currentWeekKey();
  const weekMap = groupByWeek(rows, (r) => weekKeyFromDateString(r.work_date_utc));
  const weekKeys = Array.from(weekMap.keys()).sort().reverse();

  list.innerHTML = weekKeys
    .map((key) => {
      const weekRows = weekMap.get(key);
      const isCurrent = key === currentKey;
      const isOpen = isCurrent || expandedWeeks.has(key);

      const byMember = new Map();
      for (const r of weekRows) {
        byMember.set(r.member_id, (byMember.get(r.member_id) || 0) + 1);
      }
      const memberSummary = Array.from(byMember.entries())
        .map(([memberId, count]) => {
          const name = weekRows.find((r) => r.member_id === memberId)?.member_name || memberId;
          return `${escapeHtml(name)}: ${count}`;
        })
        .join(" · ");

      return `
        <article class="rounded-lg border ${isCurrent ? "border-slate-300 dark:border-slate-700" : "border-slate-200 dark:border-slate-800"} bg-white dark:bg-slate-900">
          <button class="week-toggle" data-week="${escapeHtml(key)}" data-week-section="proof" aria-expanded="${isOpen}">
            <span class="week-chevron">${isOpen ? "▼" : "▶"}</span>
            <span class="week-label">${isCurrent ? "This week" : "Week"} ${escapeHtml(fmtWeekLabel(key))}</span>
            <span class="week-meta">${weekRows.length} submission${weekRows.length === 1 ? "" : "s"}${memberSummary ? ` · ${memberSummary}` : ""}</span>
          </button>
          ${isOpen ? `
            <div class="p-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
              ${weekRows.map(renderProofCard).join("")}
            </div>
          ` : ""}
        </article>
      `;
    })
    .join("");

  $("#proof-count").textContent = `${rows.length} submission${rows.length === 1 ? "" : "s"} · ${weekKeys.length} week${weekKeys.length === 1 ? "" : "s"}`;
}

async function loadProof() {
  const memberId = $("#proof-member").value;
  const from = $("#proof-from").value;
  const to = $("#proof-to").value;
  const qs = new URLSearchParams({ limit: "500" });
  if (memberId) qs.set("member_id", memberId);
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  $("#proof-list").innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">Loading…</p>';
  try {
    const data = await fetchJson(`/api/web/proof-submissions?${qs.toString()}`);
    state.proof.rows = data.submissions;
    renderProof();
  } catch (error) {
    $("#proof-list").innerHTML = `<p class="text-sm text-red-600 dark:text-red-400">Failed: ${escapeHtml(error.message)}</p>`;
  }
}

// ---------- Member detail modal ----------

async function openMemberDetail(memberId, memberName) {
  state.memberDetail.open = true;
  state.memberDetail.memberId = memberId;
  state.memberDetail.memberName = memberName;
  $("#member-modal-name").textContent = memberName;
  $("#member-modal-section-messages").innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">Loading…</p>';
  $("#member-modal-section-activity").innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">Loading…</p>';
  $("#member-modal-section-proof").innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">Loading…</p>';
  const modal = $("#member-modal");
  modal.classList.add("open");
  document.body.classList.add("modal-open");

  const qs = new URLSearchParams({ member_id: memberId, limit: "200" });
  try {
    const [stats, activity, proof] = await Promise.all([
      fetchJson(`/api/web/group-stats?${new URLSearchParams({ member_id: memberId, limit: "200" }).toString()}`),
      fetchJson(`/api/web/activity?${new URLSearchParams({ member_id: memberId, limit: "200" }).toString()}`),
      fetchJson(`/api/web/proof-submissions?${qs.toString()}`)
    ]);
    renderMemberMessages(stats.group_stats);
    renderMemberActivity(activity.activities);
    renderMemberProof(proof.submissions);
  } catch (error) {
    const msg = `<p class="text-sm text-red-600 dark:text-red-400">Failed: ${escapeHtml(error.message)}</p>`;
    $("#member-modal-section-messages").innerHTML = msg;
    $("#member-modal-section-activity").innerHTML = msg;
    $("#member-modal-section-proof").innerHTML = msg;
  }
}

function closeMemberDetail() {
  state.memberDetail.open = false;
  $("#member-modal").classList.remove("open");
  document.body.classList.remove("modal-open");
}

function renderMemberMessages(rows) {
  const el = $("#member-modal-section-messages");
  if (!rows.length) {
    el.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">No message data.</p>';
    return;
  }
  const total = rows.reduce((s, r) => s + r.message_count, 0);
  const max = Math.max(...rows.map((r) => r.message_count), 1);
  const sorted = rows.slice().sort((a, b) => b.work_date_utc.localeCompare(a.work_date_utc));
  el.innerHTML = `
    <div class="mb-2 text-sm text-slate-600 dark:text-slate-300"><span class="mono">${total}</span> messages across <span class="mono">${rows.length}</span> group-day row${rows.length === 1 ? "" : "s"}</div>
    <div class="space-y-0.5">
      ${sorted
        .map((d) => {
          const pct = Math.round((d.message_count / max) * 100);
          return `
            <div class="sparkline-row">
              <span class="spark-date">${escapeHtml(fmtDateHuman(d.work_date_utc))} · ${escapeHtml(groupName(d))}</span>
              <div class="spark-bar"><div class="spark-fill" style="width:${pct}%"></div></div>
              <span class="spark-count">${d.message_count}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderMemberActivity(rows) {
  const el = $("#member-modal-section-activity");
  if (!rows.length) {
    el.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">No activity entries.</p>';
    return;
  }
  el.innerHTML = `
    <div class="space-y-1.5">
      ${rows
        .map((row) => {
          const label = ACTION_LABEL[row.action] || row.action;
          const pillCls = ACTION_PILL[row.action] || "pill-slate";
          return `
            <div class="flex items-start gap-2 text-sm">
              <span class="mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap pt-0.5">${escapeHtml(fmtTimeUtc(row.created_at))}</span>
              ${pill(pillCls, label)}
              <span class="text-slate-700 dark:text-slate-200 break-words">${escapeHtml(row.message)}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderMemberProof(rows) {
  const el = $("#member-modal-section-proof");
  if (!rows.length) {
    el.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">No proof of work submissions.</p>';
    return;
  }
  el.innerHTML = `
    <div class="space-y-2">
      ${rows.map(renderProofCard).join("")}
    </div>
  `;
}


// ---------- Support Tickets ----------

function ticketDisplayCode(row) {
  return row.ticket_code || String(row.id || "").slice(0, 8) || "—";
}

function ticketGroupName(row) {
  return row.group_title || "Support chat";
}

function renderTicketMessages(row) {
  const messages = row.messages || [];
  if (!messages.length) {
    return '<p class="text-xs text-slate-500 dark:text-slate-400">No message history recorded for this ticket yet.</p>';
  }

  return `
    <div class="space-y-2">
      ${messages.map((message) => `
        <div class="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2">
          <div class="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span><strong>${escapeHtml(message.sender_name)}</strong> · ${escapeHtml(message.sender_type)}</span>
            <span class="mono whitespace-nowrap">${escapeHtml(fmtTimeUtc(message.message_date_utc))}</span>
          </div>
          <div class="mt-1 text-sm whitespace-pre-wrap break-words">${escapeHtml(sanitizeTicketMessageText(message.message_text))}</div>
          ${renderTicketAttachment(message)}
        </div>
      `).join("")}
    </div>
  `;
}

function renderTicketRow(row) {
  const status = pill(TICKET_STATUS_PILL[row.status] || "pill-slate", TICKET_STATUS_LABEL[row.status] || row.status);
  const assigned = row.assigned_member_name || "—";
  const scheduled = row.scheduled_member_name || "—";
  const coverage = row.covered_for_member_name
    ? `Covered for ${escapeHtml(row.covered_for_member_name)}${row.accepted_member_was_timed_in === false ? " · off-duty accept" : ""}`
    : row.accepted_member_was_timed_in === false
      ? "Accepted while not timed in"
      : "—";
  const isExpanded = state.tickets.expandedIds.has(row.id);
  const messageCount = (row.messages || []).length;
  const code = ticketDisplayCode(row);
  return `
    <tr>
      <td class="mono ticket-cell-nowrap">
        <div class="font-semibold">#${escapeHtml(code)}</div>
        <button type="button" class="ticket-history-toggle text-xs text-blue-600 dark:text-blue-300 hover:underline" data-ticket-id="${escapeHtml(row.id)}">
          ${isExpanded ? "Hide" : "View"} history (${messageCount})
        </button>
      </td>
      <td class="mono ticket-cell-nowrap">
        <div>${escapeHtml(fmtTimeUtc(row.created_at))}</div>
        <div class="text-[10px] text-slate-400">${escapeHtml(fmtRelative(row.created_at))}</div>
      </td>
      <td>
        <div class="font-medium">${escapeHtml(ticketGroupName(row))}</div>
        ${row.group_title ? "" : `<div class="text-[10px] text-slate-400">No group title saved</div>`}
      </td>
      <td>
        <div class="font-medium">${escapeHtml(row.opened_by_name)}</div>
        <div class="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap break-words">${escapeHtml(sanitizeTicketMessageText(row.opened_message_text))}</div>
        <div class="mt-1 text-[11px] text-slate-400">Conversation is hidden until you click View history.</div>
      </td>
      <td>${status}</td>
      <td>${escapeHtml(scheduled)}</td>
      <td>${escapeHtml(assigned)}</td>
      <td>${escapeHtml(coverage)}</td>
      <td class="mono ticket-cell-nowrap">${escapeHtml(fmtTimeUtc(row.closed_at))}</td>
    </tr>
    ${isExpanded ? `
      <tr>
        <td colspan="9" class="bg-slate-50 dark:bg-slate-950">
          <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Chat history for #${escapeHtml(code)}</div>
          ${renderTicketMessages(row)}
        </td>
      </tr>
    ` : ""}
  `;
}

function updateTicketQueueButtons() {
  for (const button of $all(".ticket-queue-btn")) {
    const status = button.dataset.ticketStatus || "";
    const isActive = state.tickets.filters.status === status;
    button.classList.toggle("bg-teal-600", isActive);
    button.classList.toggle("text-white", isActive);
    button.classList.toggle("border-teal-600", isActive);
    button.classList.toggle("bg-white", !isActive);
    button.classList.toggle("dark:bg-slate-900", !isActive);
  }
}

function renderTickets() {
  const tbody = $("#tickets-body");
  const rows = state.tickets.rows;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center text-sm text-slate-500 dark:text-slate-400 py-4">No support tickets in this view.</td></tr>';
  } else {
    tbody.innerHTML = rows.map(renderTicketRow).join("");
  }
  updateTicketQueueButtons();
  const solvedCount = rows.filter((row) => row.status === "solved_closed").length;
  const notSolvedCount = rows.filter((row) => row.status === "not_solved_closed").length;
  const pendingFollowUpCount = rows.filter((row) => row.status === "pending_follow_up").length;
  const coverageCount = rows.filter((row) => row.covered_for_member_id).length;
  const offDutyCount = rows.filter((row) => row.accepted_member_was_timed_in === false).length;
  const messageCount = rows.reduce((sum, row) => sum + (row.messages || []).length, 0);
  const selectedGroup = state.tickets.filters.telegram_chat_id
    ? state.tickets.groups.find((group) => String(group.telegram_chat_id) === state.tickets.filters.telegram_chat_id)
    : null;
  const groupLabel = selectedGroup
    ? selectedGroup.display_name || selectedGroup.title || selectedGroup.telegram_chat_id
    : state.tickets.filters.telegram_chat_id
      ? `Chat ${state.tickets.filters.telegram_chat_id}`
      : "All groups";
  $("#tickets-count").textContent = `${rows.length} ticket${rows.length === 1 ? "" : "s"} · ${groupLabel} · ${messageCount} logged message${messageCount === 1 ? "" : "s"} · ${solvedCount} solved · ${notSolvedCount} not solved · ${pendingFollowUpCount} pending follow-up · ${coverageCount} coverage handoff${coverageCount === 1 ? "" : "s"} · ${offDutyCount} off-duty accept${offDutyCount === 1 ? "" : "s"}`;
}

async function loadTickets() {
  const qs = new URLSearchParams({ limit: "500" });
  const { assigned_member_id, scheduled_member_id, status, telegram_chat_id } = state.tickets.filters;
  const from = $("#tickets-from").value;
  const to = $("#tickets-to").value;
  if (assigned_member_id) qs.set("assigned_member_id", assigned_member_id);
  if (scheduled_member_id) qs.set("scheduled_member_id", scheduled_member_id);
  if (status) qs.set("status", status);
  if (telegram_chat_id) qs.set("telegram_chat_id", telegram_chat_id);
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);

  $("#tickets-body").innerHTML = '<tr><td colspan="9" class="text-center text-sm text-slate-500 dark:text-slate-400 py-4">Loading…</td></tr>';
  try {
    const data = await fetchJson(`/api/web/support-tickets?${qs.toString()}`);
    state.tickets.rows = data.tickets;
    const groupsById = new Map(state.tickets.groups.map((group) => [String(group.telegram_chat_id), group]));
    for (const ticket of data.tickets) {
      if (!ticket.telegram_chat_id) continue;
      const key = String(ticket.telegram_chat_id);
      if (!groupsById.has(key)) {
        groupsById.set(key, {
          telegram_chat_id: ticket.telegram_chat_id,
          title: ticket.group_title || null,
          display_name: ticket.group_title || `Chat ${ticket.telegram_chat_id}`
        });
      }
    }
    state.tickets.groups = Array.from(groupsById.values()).sort((a, b) =>
      String(a.display_name || a.title || a.telegram_chat_id).localeCompare(String(b.display_name || b.title || b.telegram_chat_id))
    );
    renderTicketsGroupFilter(state.tickets.groups);
    renderTickets();
  } catch (error) {
    $("#tickets-body").innerHTML = `<tr><td colspan="9" class="text-center text-sm text-red-600 dark:text-red-400 py-4">Failed to load: ${escapeHtml(error.message)}</td></tr>`;
  }
}

// ---------- Tabs + init ----------

function switchTab(name) {
  state.currentTab = name;
  for (const btn of $all(".tab-btn")) {
    btn.setAttribute("aria-selected", btn.dataset.tab === name ? "true" : "false");
  }
  for (const panel of $all("[data-tab-panel]")) {
    panel.classList.toggle("active", panel.dataset.tabPanel === name);
  }
  refreshCurrent();
}

function refreshCurrent() {
  setLastUpdated();
  if (state.currentTab === "home") return;
  if (state.currentTab === "activity") loadActivity();
  else if (state.currentTab === "stats") loadStats();
  else if (state.currentTab === "proof") loadProof();
  else if (state.currentTab === "tickets") loadTickets();
}

function initDefaultDates() {
  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
  const iso = (d) => d.toISOString().slice(0, 10);
  $("#stats-from").value = iso(thirtyDaysAgo);
  $("#stats-to").value = iso(today);
  $("#proof-from").value = iso(thirtyDaysAgo);
  $("#proof-to").value = iso(today);
  $("#tickets-from").value = iso(thirtyDaysAgo);
  $("#tickets-to").value = iso(today);
}

function toggleWeek(section, key) {
  const target =
    section === "activity" ? state.activity.expandedWeeks :
    section === "stats" ? state.stats.expandedWeeks :
    section === "proof" ? state.proof.expandedWeeks :
    null;
  if (!target) return;
  if (target.has(key)) target.delete(key);
  else target.add(key);
  if (section === "activity") renderActivity();
  else if (section === "stats") renderStats();
  else if (section === "proof") renderProof();
}

async function init() {
  initDefaultDates();
  $("#activity-member").setAttribute("data-members-select", "1");
  $("#proof-member").setAttribute("data-members-select", "1");
  $("#tickets-assigned-member").setAttribute("data-members-select", "1");
  $("#tickets-scheduled-member").setAttribute("data-members-select", "1");

  try { await loadMembers(); } catch (error) { console.warn("Failed to load members", error); }

  // Tabs
  for (const btn of $all(".tab-btn")) {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  }
  for (const btn of $all("[data-menu-tab]")) {
    btn.addEventListener("click", () => switchTab(btn.dataset.menuTab));
  }
  $("#refresh-btn").addEventListener("click", refreshCurrent);

  // Activity filters (client-side over the loaded set)
  $("#activity-member").addEventListener("change", (e) => {
    state.activity.filters.member_id = e.target.value;
    renderActivity();
  });
  $("#activity-action").addEventListener("change", (e) => {
    state.activity.filters.action = e.target.value;
    renderActivity();
  });
  $("#activity-search").addEventListener("input", (e) => {
    state.activity.filters.search = e.target.value;
    renderActivity();
  });
  wireSorting("#activity-table", state.activity.sort, renderActivity);

  // Stats filters + grouping toggle
  $("#stats-group-filter").addEventListener("change", (e) => {
    state.stats.selectedGroupId = e.target.value;
    loadStats();
  });
  $("#stats-from").addEventListener("change", loadStats);
  $("#stats-to").addEventListener("change", loadStats);
  $("#stats-group-date").addEventListener("click", () => setStatsGrouping("date"));
  $("#stats-group-member").addEventListener("click", () => setStatsGrouping("member"));

  // Proof filters
  $("#proof-member").addEventListener("change", loadProof);
  $("#proof-from").addEventListener("change", loadProof);
  $("#proof-to").addEventListener("change", loadProof);

  // Ticket filters
  $("#tickets-assigned-member").addEventListener("change", (e) => {
    state.tickets.filters.assigned_member_id = e.target.value;
    loadTickets();
  });
  $("#tickets-scheduled-member").addEventListener("change", (e) => {
    state.tickets.filters.scheduled_member_id = e.target.value;
    loadTickets();
  });
  $("#tickets-status").addEventListener("change", (e) => {
    state.tickets.filters.status = e.target.value;
    loadTickets();
  });
  for (const button of $all(".ticket-queue-btn")) {
    button.addEventListener("click", () => {
      state.tickets.filters.status = button.dataset.ticketStatus || "";
      $("#tickets-status").value = state.tickets.filters.status;
      loadTickets();
    });
  }
  $("#tickets-group-filter").addEventListener("change", (e) => {
    state.tickets.filters.telegram_chat_id = e.target.value;
    loadTickets();
  });
  $("#tickets-from").addEventListener("change", loadTickets);
  $("#tickets-to").addEventListener("change", loadTickets);

  // Global delegated click handler for member links + week toggles + modal close
  document.addEventListener("click", (e) => {
    const ticketToggle = e.target.closest(".ticket-history-toggle");
    if (ticketToggle) {
      e.preventDefault();
      const id = ticketToggle.dataset.ticketId;
      if (id) {
        if (state.tickets.expandedIds.has(id)) state.tickets.expandedIds.delete(id);
        else state.tickets.expandedIds.add(id);
        renderTickets();
      }
      return;
    }

    const memberLink = e.target.closest(".member-link");
    if (memberLink) {
      e.preventDefault();
      const id = memberLink.dataset.memberId;
      const name = memberLink.dataset.memberName;
      if (id) openMemberDetail(id, name || id);
      return;
    }
    const weekBtn = e.target.closest(".week-toggle");
    if (weekBtn && !weekBtn.dataset.weekCurrent) {
      toggleWeek(weekBtn.dataset.weekSection, weekBtn.dataset.week);
      return;
    }
    if (e.target.closest("#member-modal-close") || e.target.classList.contains("modal-backdrop")) {
      closeMemberDetail();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.memberDetail.open) closeMemberDetail();
  });

  switchTab("home");
  setInterval(refreshCurrent, 60_000);
}

init();
