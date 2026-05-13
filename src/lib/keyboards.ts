import { TEAM_SCHEDULE, getOtherMembers } from "./team-schedule.js";
import type { InlineKeyboardMarkup } from "./telegram-types.js";

export function registrationKeyboard(registeredMemberIds: Set<string> = new Set()): InlineKeyboardMarkup {
  const buttons = TEAM_SCHEDULE
    .filter((member) => !registeredMemberIds.has(member.id))
    .map((member) => ({ text: member.name, callback_data: `register:${member.id}` }));

  const rows = [];
  for (let index = 0; index < buttons.length; index += 2) {
    rows.push(buttons.slice(index, index + 2));
  }

  return { inline_keyboard: rows };
}

export function dashboardKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🟢 Time In", callback_data: "time:in" },
        { text: "🔴 Time Out", callback_data: "time:out" }
      ],
      [
        { text: "📋 My Status", callback_data: "status:me" },
        { text: "📢 Activity", callback_data: "activity:list" }
      ],
      [
        { text: "📝 Excuse", callback_data: "excuse:start" },
        { text: "🚫 Absent", callback_data: "absent:start" }
      ],
      [
        { text: "🔁 Shift Swap", callback_data: "swap:start" },
        { text: "📎 Submit Proof", callback_data: "proof:start" }
      ],
      [{ text: "🔄 Refresh", callback_data: "dashboard:refresh" }]
    ]
  };
}

export function homeKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: "🏠 Dashboard", callback_data: "dashboard:refresh" }]]
  };
}

export function excuseTypeKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "Late", callback_data: "excuse:type:late" },
        { text: "Early Out", callback_data: "excuse:type:early_out" }
      ],
      [
        { text: "Absent", callback_data: "excuse:type:absent" },
        { text: "Other", callback_data: "excuse:type:other" }
      ],
      [{ text: "❌ Cancel", callback_data: "dashboard:refresh" }]
    ]
  };
}

export function confirmAbsentKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "✅ Yes, Mark Absent", callback_data: "absent:confirm" }],
      [{ text: "❌ Cancel", callback_data: "dashboard:refresh" }]
    ]
  };
}

export function swapTargetKeyboard(memberId: string): InlineKeyboardMarkup {
  const rows = getOtherMembers(memberId).map((member) => [
    { text: member.name, callback_data: `swap:target:${member.id}` }
  ]);

  return { inline_keyboard: [...rows, [{ text: "❌ Cancel", callback_data: "dashboard:refresh" }]] };
}

export function swapResponseKeyboard(requestId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: "✅ Accept Swap", callback_data: `swap:accept:${requestId}` },
      { text: "❌ Reject Swap", callback_data: `swap:reject:${requestId}` }
    ]]
  };
}


export function proofOfWorkKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "📎 Submit Proof of Work", callback_data: "proof:start" }],
      [{ text: "🏠 Dashboard", callback_data: "dashboard:refresh" }]
    ]
  };
}

export function groupProofOfWorkKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: "📎 Submit Proof of Work", callback_data: "proof:start" }]]
  };
}

export function groupTimeInKeyboard(memberId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: "🟢 Time In Now", callback_data: `group:time:in:${memberId}` }]]
  };
}

export function groupTimeOutKeyboard(memberId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: "🔴 Time Out Now", callback_data: `group:time:out:${memberId}` }]]
  };
}

export function ticketAcceptKeyboard(ticketId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: "✅ Accept Ticket", callback_data: `t:acc:${ticketId}` }]]
  };
}

export function ticketResolutionRequestKeyboard(ticketId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: "🧾 Ask User If Solved", callback_data: `t:res:${ticketId}` }]]
  };
}

export function ticketUserResolutionKeyboard(ticketId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: "✅ Solved", callback_data: `t:sol:${ticketId}` },
      { text: "❌ Not Solved", callback_data: `t:nsol:${ticketId}` }
    ]]
  };
}
