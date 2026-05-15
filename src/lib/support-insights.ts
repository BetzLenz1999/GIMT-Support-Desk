import { detectAiSupportTemplate, type AiSupportCategory, type AiSupportDashboardStatus } from "./ai-support.js";
import type { SupportTicket, SupportTicketMessage } from "./supabase.js";

export type SupportDetectedLanguage = {
  code: string;
  name: string;
  confidence: "high" | "medium" | "low";
};

export type SupportTicketInsight = {
  category: AiSupportCategory;
  dashboard_status: AiSupportDashboardStatus | "Unknown";
  detected_language: SupportDetectedLanguage;
  english_translation_assist: string;
  summary: string;
  next_action: string;
  risk_flags: string[];
  evidence_checklist: string[];
  customer_message_count: number;
  attachment_count: number;
  latest_customer_message: string;
};

export type SupportIssueStat = {
  category: string;
  count: number;
  open_count: number;
  needs_moderator_count: number;
  closed_count: number;
  solved_count: number;
  not_solved_count: number;
  latest_at: string | null;
  sample_ticket_code: string | null;
  sample_summary: string;
};

const AI_PREFIX = "[AI Support]";

const LANGUAGE_RULES: Array<{ code: string; name: string; keywords: string[] }> = [
  { code: "tl", name: "Filipino/Tagalog", keywords: ["paano", "hindi", "di ako", "makapag", "wala", "saan", "bakit", "ba ", " po", "ko ", "ako ", "salamat"] },
  { code: "es", name: "Spanish", keywords: ["hola", "gracias", "no puedo", "reclamar", "billetera", "verificación", "ayuda", "error"] },
  { code: "fr", name: "French", keywords: ["bonjour", "merci", "je ne peux", "portefeuille", "vérification", "aide", "erreur"] },
  { code: "pt", name: "Portuguese", keywords: ["olá", "obrigado", "não consigo", "carteira", "verificação", "ajuda", "erro"] },
  { code: "id", name: "Indonesian", keywords: ["tidak bisa", "bagaimana", "dompet", "verifikasi", "bantuan", "terima kasih", "klaim"] }
];

const CATEGORY_EVIDENCE: Record<AiSupportCategory, string[]> = {
  "How to Claim G$": ["Confirm which app/wallet they use", "Ask for screenshot only if the guide did not solve it"],
  "GoodWallet Claiming Failed": ["Wallet address", "Screenshot", "Exact error message", "Claim date/time"],
  "Cannot Claim G$": ["Wallet address", "Screenshot", "Exact error message", "Whether face verification is complete"],
  "Face Verification Failed": ["Screenshot of error", "Phone model", "Camera permission status", "Lighting/network details"],
  "Wallet Connection Issue": ["Wallet type", "Wallet address", "Screenshot", "Browser/app version if available"],
  "MiniPay GoodDapp Swap Failed": ["Wallet address", "Transaction hash if available", "Swap pair/amount", "Screenshot/error message"],
  "Gas Fee Issue": ["Network being used", "Action attempted", "Screenshot/error message", "Wallet address if transaction-related"],
  "Importing Wallet / Importing G$ Token": ["Wallet app", "Network selected", "Token contract used", "Screenshot of token list"],
  "Reward Not Received": ["Wallet address", "Claim/transaction hash if available", "Claim date/time", "Screenshot of balance/history"],
  "Transaction Failed": ["Transaction hash if available", "Wallet address", "Action attempted", "Screenshot/error message"],
  "Pending Case Follow-Up": ["Ticket number", "Wallet address", "Short issue recap", "Latest screenshot/error if changed"],
  "User Provided Evidence": ["Review screenshot/photo", "Wallet address if relevant", "Exact action before the error"],
  "Unknown Issue": ["Short problem description", "Screenshot if available", "Wallet address if wallet/claim related", "Exact error message"]
};

export function buildSupportTicketInsight(ticket: SupportTicket, messages: SupportTicketMessage[] = []): SupportTicketInsight {
  const originalQuestion = extractOriginalQuestion(ticket.opened_message_text) || ticket.opened_message_text;
  const category = extractAiCategory(ticket.opened_message_text) ?? detectAiSupportTemplate(originalQuestion).category;
  const dashboardStatus = extractDashboardStatus(ticket.opened_message_text) ?? statusToDashboardStatus(ticket.status);
  const customerMessages = messages.filter((message) => message.sender_type === "customer");
  const latestCustomer = [...customerMessages].reverse().find((message) => message.message_text)?.message_text || originalQuestion;
  const attachmentCount = messages.reduce((sum, message) => sum + (Array.isArray(message.attachments) ? message.attachments.length : 0), 0);
  const detectedLanguage = detectSupportLanguage(customerMessages.map((message) => message.message_text).join("\n") || originalQuestion);
  const riskFlags = buildRiskFlags(ticket, messages, category);

  return {
    category,
    dashboard_status: dashboardStatus,
    detected_language: detectedLanguage,
    english_translation_assist: buildEnglishTranslationAssist(latestCustomer, detectedLanguage, category),
    summary: buildSummary(ticket, category, customerMessages, attachmentCount),
    next_action: buildNextAction(ticket, category, attachmentCount),
    risk_flags: riskFlags,
    evidence_checklist: CATEGORY_EVIDENCE[category],
    customer_message_count: customerMessages.length,
    attachment_count: attachmentCount,
    latest_customer_message: latestCustomer
  };
}

export function buildSupportIssueStats(tickets: Array<SupportTicket & { insight?: SupportTicketInsight }>): SupportIssueStat[] {
  const stats = new Map<string, SupportIssueStat>();

  for (const ticket of tickets) {
    const category = ticket.insight?.category ?? extractAiCategory(ticket.opened_message_text) ?? "Unknown Issue";
    const current = stats.get(category) ?? {
      category,
      count: 0,
      open_count: 0,
      needs_moderator_count: 0,
      closed_count: 0,
      solved_count: 0,
      not_solved_count: 0,
      latest_at: null,
      sample_ticket_code: null,
      sample_summary: ""
    };

    current.count += 1;
    if (["open", "accepted", "pending_user_resolution", "pending_follow_up"].includes(ticket.status)) current.open_count += 1;
    if (ticket.insight?.dashboard_status === "Needs Moderator Review" || ticket.status === "open" || ticket.status === "accepted") current.needs_moderator_count += 1;
    if (ticket.closed_at || ticket.status === "expired" || ticket.status.endsWith("_closed")) current.closed_count += 1;
    if (ticket.status === "solved_closed") current.solved_count += 1;
    if (ticket.status === "not_solved_closed") current.not_solved_count += 1;
    if (!current.latest_at || new Date(ticket.created_at).getTime() > new Date(current.latest_at).getTime()) {
      current.latest_at = ticket.created_at;
      current.sample_ticket_code = ticket.ticket_code ?? ticket.id.slice(0, 8);
      current.sample_summary = ticket.insight?.summary ?? summarizeText(extractOriginalQuestion(ticket.opened_message_text) || ticket.opened_message_text, 120);
    }

    stats.set(category, current);
  }

  return [...stats.values()].sort((a, b) => b.count - a.count || (new Date(b.latest_at ?? 0).getTime() - new Date(a.latest_at ?? 0).getTime()));
}

function extractAiCategory(text: string): AiSupportCategory | null {
  const value = extractLineValue(text, "Category");
  return isAiSupportCategory(value) ? value : null;
}

function extractDashboardStatus(text: string): AiSupportDashboardStatus | null {
  const value = extractLineValue(text, "Dashboard status");
  return isAiDashboardStatus(value) ? value : null;
}

function extractOriginalQuestion(text: string): string {
  if (!text.startsWith(AI_PREFIX)) return text;
  const marker = "Original question:";
  const index = text.indexOf(marker);
  return index >= 0 ? text.slice(index + marker.length).trim() : text;
}

function extractLineValue(text: string, label: string): string | null {
  const line = text.split(/\r?\n/).find((item) => item.toLowerCase().startsWith(`${label.toLowerCase()}:`));
  return line ? line.slice(label.length + 1).trim() : null;
}

function isAiSupportCategory(value: string | null): value is AiSupportCategory {
  return Boolean(value && CATEGORY_EVIDENCE[value as AiSupportCategory]);
}

function isAiDashboardStatus(value: string | null): value is AiSupportDashboardStatus {
  return Boolean(value && ["Auto-Replied", "Solved by Bot", "Needs Moderator Review", "Escalated to Moderator", "Solved by Moderator", "Pending User Response"].includes(value));
}

function statusToDashboardStatus(status: SupportTicket["status"]): AiSupportDashboardStatus | "Unknown" {
  if (status === "pending_user_resolution") return "Pending User Response";
  if (status === "solved_closed") return "Solved by Bot";
  if (status === "not_solved_closed" || status === "open" || status === "accepted" || status === "pending_follow_up") return "Needs Moderator Review";
  if (status === "closed_by_team") return "Solved by Moderator";
  return "Unknown";
}

function detectSupportLanguage(text: string): SupportDetectedLanguage {
  const normalized = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  const scored = LANGUAGE_RULES
    .map((rule) => ({ ...rule, matches: rule.keywords.filter((keyword) => normalized.includes(keyword)) }))
    .filter((rule) => rule.matches.length > 0)
    .sort((a, b) => b.matches.length - a.matches.length);

  if (!scored.length) return { code: "en", name: "English/Unknown", confidence: "low" };
  const best = scored[0];
  return { code: best.code, name: best.name, confidence: best.matches.length >= 2 ? "high" : "medium" };
}

function buildEnglishTranslationAssist(text: string, language: SupportDetectedLanguage, category: AiSupportCategory): string {
  const issue = category === "Unknown Issue" ? "an issue that needs more details" : category.toLowerCase();
  const concise = summarizeText(text.replace(/\[photo attachment\]/gi, "").trim(), 180);
  if (language.code === "en") {
    return `Likely English or mixed-language message. User appears to report ${issue}. Latest message: ${concise || "No text provided."}`;
  }

  return `Detected ${language.name} (${language.confidence}). English assist: user appears to report ${issue}. Latest message, untranslated/raw: ${concise || "No text provided."}`;
}

function buildSummary(ticket: SupportTicket, category: AiSupportCategory, customerMessages: SupportTicketMessage[], attachmentCount: number): string {
  const first = customerMessages[0]?.message_text || extractOriginalQuestion(ticket.opened_message_text) || ticket.opened_message_text;
  const latest = customerMessages[customerMessages.length - 1]?.message_text || first;
  const evidence = attachmentCount > 0 ? `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"} provided` : "no attachment yet";
  const ticketCode = ticket.ticket_code ?? ticket.id.slice(0, 8);

  if (customerMessages.length <= 1) {
    return `Ticket #${ticketCode}: ${category}. User message: ${summarizeText(first, 180)} (${evidence}).`;
  }

  return `Ticket #${ticketCode}: ${category}. ${customerMessages.length} customer messages. First: ${summarizeText(first, 100)} Latest: ${summarizeText(latest, 120)} (${evidence}).`;
}

function buildNextAction(ticket: SupportTicket, category: AiSupportCategory, attachmentCount: number): string {
  if (ticket.status === "expired") return "No action needed; ticket auto-closed after 30 minutes without a requester message.";
  if (ticket.status === "solved_closed") return "No action needed; requester confirmed solved.";
  if (ticket.status === "not_solved_closed") return "Review as not solved; check history and re-open with a moderator reply if needed.";
  if (ticket.status === "pending_user_resolution" || ticket.status === "pending_follow_up") return "Legacy ticket state; review the conversation and wait for auto-close or a new requester message.";
  if (category === "Unknown Issue") return "Ask for a short issue description, screenshot, wallet address if relevant, and exact error message.";
  if (attachmentCount === 0 && ["Face Verification Failed", "GoodWallet Claiming Failed", "Cannot Claim G$", "Transaction Failed", "Reward Not Received"].includes(category)) {
    return "Ask for screenshot/error details and verify the evidence checklist before escalating.";
  }
  return "Moderator should review evidence checklist, confirm missing details, then reply with the next troubleshooting step.";
}

function buildRiskFlags(ticket: SupportTicket, messages: SupportTicketMessage[], category: AiSupportCategory): string[] {
  const text = `${ticket.opened_message_text}\n${messages.map((message) => message.message_text).join("\n")}`.toLowerCase();
  const flags: string[] = [];

  if (/seed phrase|private key|recovery phrase|secret phrase|mnemonic/.test(text)) flags.push("Sensitive wallet credential mentioned — remind user never to share seed/private keys.");
  if (/https?:\/\/\S+/i.test(text)) flags.push("Contains link(s) — moderator should verify link safety before opening.");
  if (/scam|phish|fake|hacked|stolen/.test(text)) flags.push("Possible scam/security concern.");
  if (/deduct|lost|missing|not received|balance/.test(text) || ["Reward Not Received", "Transaction Failed"].includes(category)) flags.push("Possible funds/balance impact.");
  if (ticket.status === "open" || ticket.status === "accepted") flags.push("Needs human follow-up.");

  return [...new Set(flags)];
}

function summarizeText(text: string, maxLength: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}
