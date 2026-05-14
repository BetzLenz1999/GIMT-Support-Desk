export type AiSupportDashboardStatus =
  | "Auto-Replied"
  | "Solved by Bot"
  | "Needs Moderator Review"
  | "Escalated to Moderator"
  | "Solved by Moderator"
  | "Pending User Response";

export type AiSupportCategory =
  | "How to Claim G$"
  | "GoodWallet Claiming Failed"
  | "Cannot Claim G$"
  | "Face Verification Failed"
  | "Wallet Connection Issue"
  | "Export GoodWallet to EVM Wallet"
  | "MiniPay GoodDapp Swap Failed"
  | "Gas Fee Issue"
  | "Reward Not Received"
  | "Transaction Failed"
  | "Pending Case Follow-Up"
  | "User Provided Evidence"
  | "Unknown Issue";

export type AiSupportTemplate = {
  category: AiSupportCategory;
  intentExamples: string[];
  response: string;
  defaultDashboardStatus: AiSupportDashboardStatus;
  alwaysEscalate: boolean;
  escalateIf: string;
};

export type AiSupportMatch = AiSupportTemplate & {
  matchedKeywords: string[];
};

const HOW_TO_CLAIM_RESPONSE = `Hi! To claim G$, please open your GoodWallet/GoodDollar app and make sure your account is properly connected and verified.

Then go to the claim section and follow the steps shown in the app.

Please also make sure you have enough gas if the action requires a blockchain transaction.

If you still cannot claim, please send a screenshot, your wallet address, and the exact error message so a moderator can check your case.

Helpful guides:
• Guide: Claiming G$ on GoodDapp using GoodWallet
https://discourse.gooddollar.org/t/guide-claiming-g-on-gooddapp-using-goodwallet/8792

• Guide: How to Claim G$ on GoodWallet
https://discourse.gooddollar.org/t/guide-how-to-claim-g-on-goodwallet/8788`;

const CLAIMING_FAILED_RESPONSE = `Hi! If claiming failed in GoodWallet, please check the following first:

• Make sure your account/wallet is properly connected.
• Make sure your face verification is completed successfully.
• Check if you already claimed for the current claim period.
• Refresh the app and try again.
• Make sure you have enough gas if the claim requires a blockchain transaction.

If the issue continues, please send your wallet address, screenshot, and the exact error message so a moderator can review it.

Helpful guides:
• Guide: Claiming G$ on GoodDapp using GoodWallet
https://discourse.gooddollar.org/t/guide-claiming-g-on-gooddapp-using-goodwallet/8792

• Guide: How to Claim G$ on GoodWallet
https://discourse.gooddollar.org/t/guide-how-to-claim-g-on-goodwallet/8788`;

const CANNOT_CLAIM_RESPONSE = `Hi! If you can’t claim G$, please check these common reasons:

• Your account may not be verified yet.
• Face verification may have failed or is incomplete.
• You may have already claimed for the current claim period.
• Your wallet/account may not be properly connected.
• The app may need to be refreshed or reopened.
• You may need enough gas if the action requires a blockchain transaction.

If you already checked these and still can’t claim, please send your wallet address, screenshot, and exact error message for moderator review.

Helpful guides:
• Guide: Claiming G$ on GoodDapp using GoodWallet
https://discourse.gooddollar.org/t/guide-claiming-g-on-gooddapp-using-goodwallet/8792

• Guide: How to Claim G$ on GoodWallet
https://discourse.gooddollar.org/t/guide-how-to-claim-g-on-goodwallet/8788`;

const FACE_VERIFICATION_RESPONSE = `Hi! If your face verification failed, please try the following:

• Make sure your face is clearly visible.
• Use good lighting and avoid shadows.
• Remove sunglasses, mask, or anything covering your face.
• Make sure your camera permission is enabled.
• Use a stable internet connection.
• Try refreshing or restarting the app before trying again.

If it still fails, please send a screenshot of the error message and explain what happens during verification so a moderator can help review your case.

Helpful guide:
• Tips to Pass Face Verification
https://discourse.gooddollar.org/t/tips-to-pass-face-verification/8787`;

const WALLET_CONNECTION_RESPONSE = `Hi! If your wallet is not connecting, please try these steps:

• Make sure you are using the correct wallet/account.
• Check your internet connection.
• Refresh the app or browser.
• Make sure your wallet app or browser extension is updated.
• Approve the connection request when prompted.
• Make sure you have enough gas if you are trying to perform a transaction after connecting.

If it still doesn’t work, please send your wallet address, wallet type, screenshot, and the error message you see.`;

const EXPORT_GOODWALLET_RESPONSE = `Hi! If you want to export your GoodWallet to an EVM/Web3 wallet such as MetaMask or TrustWallet, please follow the official guide below.

Guide: Exporting GoodWallet to EVM/Web3 Wallets (MetaMask and TrustWallet)
https://discourse.gooddollar.org/t/guide-exporting-goodwallet-to-evm-web3-wallets-metamask-and-trustwallet/7936

Please be careful with wallet export/import steps. Never share your private key, recovery phrase, seed phrase, or secret wallet information with anyone, including moderators or support.`;

const MINIPAY_SWAP_RESPONSE = `Hi! If swapping failed in GoodDapp while using MiniPay, please check the following:

• Make sure your MiniPay wallet is properly connected.
• Check if you have enough balance for the swap amount.
• Make sure you have enough gas for the transaction.
• Refresh GoodDapp and try again.
• Check if the network is stable and not congested.
• Make sure you are using the correct token and network.

If the swap still fails, please send your wallet address, screenshot, transaction hash if available, swap pair, amount, and the exact error message so a moderator can review it.

Helpful swap guides:
• Guide: How to Swap G$ (XDC) from GoodReserve
https://discourse.gooddollar.org/t/guide-how-to-swap-g-xdc-from-goodreserve/8863

• Guide: Swapping G$ Celo Using GoodDapp From GoodReserve
https://discourse.gooddollar.org/t/guide-swapping-g-celo-using-gooddapp-from-goodreserve/8816

• Guide: Swapping G$ on Mini Pay
https://discourse.gooddollar.org/t/guide-swapping-g-on-mini-pay/8794`;

const GAS_RESPONSE = `Hi! Some actions may require gas to complete a blockchain transaction.

Please make sure your wallet has enough gas for the network you are using before trying again. If there is not enough gas, the transaction may fail or may not be submitted successfully.

If you are unsure, please send a screenshot of the error message, your wallet address, and what action you were trying to do, such as claim, swap, or transfer.`;

const REWARD_NOT_RECEIVED_RESPONSE = `Hi! If your G$ reward or balance is not showing, please try the following:

• Wait a few minutes and refresh your wallet/app.
• Check if the claim or transaction was completed successfully.
• Make sure you are viewing the correct wallet/account.
• Check your transaction history if available.
• Make sure you have enough gas if the action required a transaction.

If the balance still does not appear, please send your wallet address, screenshot, transaction hash if available, and the time/date when you claimed.`;

const TRANSACTION_FAILED_RESPONSE = `Hi! A transaction can fail for different reasons, such as not enough gas, network issues, wrong network, insufficient balance, or app connection problems.

Please check the following:

• Make sure you have enough gas.
• Make sure your wallet is connected.
• Check if you are using the correct network.
• Confirm that you have enough balance for the action.
• Refresh the app and try again.

If it still fails, please send your wallet address, screenshot, transaction hash if available, and the exact error message.`;

const PENDING_CASE_RESPONSE = `Hi! Thanks for following up. Your case may still be under review by the support team.

Please provide your ticket number if you have one, or send your wallet address and a short description of your issue so we can check the status of your case.

A moderator will review your pending case as soon as possible.`;

const USER_EVIDENCE_RESPONSE = `Thank you for sending the screenshot/error message.

A moderator will review it together with your case details. If you haven’t sent it yet, please also provide your wallet address and explain what action you were trying to do before the error appeared.`;

const UNKNOWN_RESPONSE = `Hi! Thanks for your message. I may need more details to understand your issue.

Please send the following information:

• Short description of the problem.
• Screenshot if available.
• Wallet address if the issue is related to claim, reward, wallet, swap, or transaction.
• Exact error message if there is one.

A moderator will review your case.`;

export const AI_SUPPORT_TEMPLATES: AiSupportTemplate[] = [
  {
    category: "How to Claim G$",
    intentExamples: ["how to claim g$", "where can i claim g$", "how can i get gooddollar", "how do i claim in goodwallet", "paano mag claim"],
    response: HOW_TO_CLAIM_RESPONSE,
    defaultDashboardStatus: "Auto-Replied",
    alwaysEscalate: false,
    escalateIf: "user says still not working / sends error / has failed transaction"
  },
  {
    category: "GoodWallet Claiming Failed",
    intentExamples: ["claiming failed in goodwallet", "i can't claim in goodwallet", "goodwallet claim failed", "claim button not working", "my claim failed"],
    response: CLAIMING_FAILED_RESPONSE,
    defaultDashboardStatus: "Auto-Replied",
    alwaysEscalate: false,
    escalateIf: "user provides error screenshot or says issue continues"
  },
  {
    category: "Cannot Claim G$",
    intentExamples: ["why i can't claim g$", "i cannot claim", "claim not working", "unable to claim", "g$ claim failed", "hindi ako makapag claim"],
    response: CANNOT_CLAIM_RESPONSE,
    defaultDashboardStatus: "Auto-Replied",
    alwaysEscalate: false,
    escalateIf: "user cannot resolve after checklist"
  },
  {
    category: "Face Verification Failed",
    intentExamples: ["face verification failed", "i failed face verification", "verification not working", "selfie verification failed", "gooddollar verification failed", "my face scan failed"],
    response: FACE_VERIFICATION_RESPONSE,
    defaultDashboardStatus: "Auto-Replied",
    alwaysEscalate: false,
    escalateIf: "repeated failure / error screenshot / user unable to proceed"
  },
  {
    category: "Wallet Connection Issue",
    intentExamples: ["how to connect wallet", "wallet not connecting", "i can't connect my wallet", "how to connect goodwallet", "metamask not connecting", "minipay wallet not connecting"],
    response: WALLET_CONNECTION_RESPONSE,
    defaultDashboardStatus: "Auto-Replied",
    alwaysEscalate: false,
    escalateIf: "user still cannot connect"
  },
  {
    category: "Export GoodWallet to EVM Wallet",
    intentExamples: ["export goodwallet to metamask", "export goodwallet to trustwallet", "how to import goodwallet", "goodwallet evm wallet", "move goodwallet to web3 wallet"],
    response: EXPORT_GOODWALLET_RESPONSE,
    defaultDashboardStatus: "Auto-Replied",
    alwaysEscalate: false,
    escalateIf: "user cannot export/import wallet or sees an error"
  },
  {
    category: "MiniPay GoodDapp Swap Failed",
    intentExamples: ["swap failed in gooddapp", "i can't swap using minipay", "minipay swap failed", "swapping failed", "gooddapp swap not working", "why my swap failed"],
    response: MINIPAY_SWAP_RESPONSE,
    defaultDashboardStatus: "Auto-Replied",
    alwaysEscalate: false,
    escalateIf: "user provides transaction hash / balance deducted / repeated failure"
  },
  {
    category: "Gas Fee Issue",
    intentExamples: ["what is gas", "not enough gas", "gas fee problem", "transaction failed because of gas", "do i need gas", "how much gas needed"],
    response: GAS_RESPONSE,
    defaultDashboardStatus: "Auto-Replied",
    alwaysEscalate: false,
    escalateIf: "user cannot identify required gas / transaction failed repeatedly"
  },
  {
    category: "Reward Not Received",
    intentExamples: ["i didn't receive my g$", "my reward is missing", "balance not showing", "i claimed but no balance", "where is my g$", "claimed but not received"],
    response: REWARD_NOT_RECEIVED_RESPONSE,
    defaultDashboardStatus: "Auto-Replied",
    alwaysEscalate: false,
    escalateIf: "claim completed but no balance / transaction hash provided"
  },
  {
    category: "Transaction Failed",
    intentExamples: ["transaction failed", "my transaction didn't go through", "failed transaction", "why my transaction failed", "transfer failed", "swap transaction failed"],
    response: TRANSACTION_FAILED_RESPONSE,
    defaultDashboardStatus: "Auto-Replied",
    alwaysEscalate: false,
    escalateIf: "funds affected / repeated failure / transaction hash available"
  },
  {
    category: "Pending Case Follow-Up",
    intentExamples: ["any update on my case", "follow up my ticket", "my issue is still pending", "can someone check my ticket", "no update yet", "pending case"],
    response: PENDING_CASE_RESPONSE,
    defaultDashboardStatus: "Needs Moderator Review",
    alwaysEscalate: true,
    escalateIf: "always escalate, because follow-up needs human check"
  },
  {
    category: "User Provided Evidence",
    intentExamples: ["here is the screenshot", "this is the error", "i got this message", "see image", "error shown"],
    response: USER_EVIDENCE_RESPONSE,
    defaultDashboardStatus: "Needs Moderator Review",
    alwaysEscalate: true,
    escalateIf: "yes, always"
  },
  {
    category: "Unknown Issue",
    intentExamples: [],
    response: UNKNOWN_RESPONSE,
    defaultDashboardStatus: "Needs Moderator Review",
    alwaysEscalate: true,
    escalateIf: "yes"
  }
];

const KEYWORD_RULES: Array<{ category: AiSupportCategory; keywords: string[]; score: number }> = [
  { category: "User Provided Evidence", keywords: ["screenshot", "screen shot", "see image", "photo", "this is the error", "error shown", "got this message"], score: 100 },
  { category: "Pending Case Follow-Up", keywords: ["update on my case", "follow up", "follow-up", "ticket", "pending case", "no update", "check my case"], score: 95 },
  { category: "Export GoodWallet to EVM Wallet", keywords: ["export goodwallet", "export wallet", "import goodwallet", "goodwallet to metamask", "goodwallet to trustwallet", "goodwallet to trust wallet", "export to metamask", "export to trustwallet", "export to trust wallet", "evm wallet", "web3 wallet", "private key", "recovery phrase", "seed phrase"], score: 92 },
  { category: "MiniPay GoodDapp Swap Failed", keywords: ["minipay", "gooddapp", "goodreserve", "swap", "swapping", "swap failed", "swap g$", "g$ xdc", "g$ celo", "xdc", "celo"], score: 90 },
  { category: "Face Verification Failed", keywords: ["face verification", "face scan", "selfie", "verification failed", "verify failed", "camera permission"], score: 85 },
  { category: "GoodWallet Claiming Failed", keywords: ["goodwallet", "claim failed", "claiming failed", "claim button", "can't claim in goodwallet"], score: 82 },
  { category: "Cannot Claim G$", keywords: ["cannot claim", "can't claim", "cant claim", "unable to claim", "claim not working", "hindi ako makapag", "di ako makapag", "g$ claim failed"], score: 80 },
  { category: "How to Claim G$", keywords: ["how to claim", "where can i claim", "how can i get gooddollar", "paano mag claim", "paano mag-claim"], score: 78 },
  { category: "Wallet Connection Issue", keywords: ["wallet not connecting", "connect wallet", "can't connect", "cant connect", "metamask not connecting", "wallet connection"], score: 76 },
  { category: "Gas Fee Issue", keywords: ["not enough gas", "gas fee", "need gas", "what is gas", "how much gas", "gas problem"], score: 74 },
  { category: "Reward Not Received", keywords: ["didn't receive", "did not receive", "reward missing", "balance not showing", "claimed but no balance", "where is my g$", "not received"], score: 72 },
  { category: "Transaction Failed", keywords: ["transaction failed", "failed transaction", "transaction didn't go", "didn't go through", "transfer failed", "tx failed"], score: 70 }
];

const TEMPLATES_BY_CATEGORY = new Map(AI_SUPPORT_TEMPLATES.map((template) => [template.category, template]));

export function detectAiSupportTemplate(messageText: string, hasPhoto = false): AiSupportMatch {
  const normalized = normalizeText(messageText);
  if (hasPhoto && !normalized) {
    return buildMatch("User Provided Evidence", ["photo"]);
  }

  const matches = KEYWORD_RULES
    .map((rule) => ({ ...rule, matchedKeywords: rule.keywords.filter((keyword) => normalized.includes(keyword)) }))
    .filter((rule) => rule.matchedKeywords.length > 0)
    .sort((a, b) => (b.score + b.matchedKeywords.length) - (a.score + a.matchedKeywords.length));

  if (hasPhoto && !matches.length) {
    return buildMatch("User Provided Evidence", ["photo"]);
  }

  const best = matches[0];
  return best ? buildMatch(best.category, best.matchedKeywords) : buildMatch("Unknown Issue", []);
}

function buildMatch(category: AiSupportCategory, matchedKeywords: string[]): AiSupportMatch {
  const template = TEMPLATES_BY_CATEGORY.get(category) ?? TEMPLATES_BY_CATEGORY.get("Unknown Issue");
  if (!template) throw new Error(`Missing AI support template for ${category}`);
  return { ...template, matchedKeywords };
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
