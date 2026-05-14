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
  | "MiniPay GoodDapp Swap Failed"
  | "Gas Fee Issue"
  | "Importing Wallet / Importing G$ Token"
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

const HOW_TO_CLAIM_RESPONSE = `Hi! You can claim G$ using GoodWallet or GoodDapp.

Please follow the guide that matches your setup:

• Guide: How to claim G$ on GoodDapp from any Web3 wallet
https://discourse.gooddollar.org/t/guide-how-to-claim-g-on-gooddapp-from-any-web3-wallet/8818

• Guide: Claiming G$ on GoodDapp using GoodWallet
https://discourse.gooddollar.org/t/guide-claiming-g-on-gooddapp-using-goodwallet/8792

• Guide: How to Claim G$ on GoodWallet
https://discourse.gooddollar.org/t/guide-how-to-claim-g-on-goodwallet/8788

If you already followed the guide but still cannot claim, please send a screenshot and the exact error message.`;

const CLAIMING_FAILED_RESPONSE = `Hi! If claiming failed in GoodWallet, please check these first:

• Make sure you have enough gas to claim your G$.
• Make sure your GoodWallet is properly connected.
• Make sure your face verification is completed.
• Check if you already claimed for the current claim period.
• Refresh or reopen GoodWallet, then try again.

If it still fails, please send your wallet address, a screenshot, and the exact error message so a moderator can review it.`;

const CANNOT_CLAIM_RESPONSE = `Hi! If you can’t claim G$, please check these common reasons:

• You may need enough gas to complete the claim.
• Your account may not be verified yet.
• Face verification may have failed or is incomplete.
• You may have already claimed for the current claim period.
• Your wallet/account may not be properly connected.
• The app may need to be refreshed or reopened.

If you already checked these and still can’t claim, please send your wallet address, screenshot, and exact error message for moderator review.`;

const FACE_VERIFICATION_RESPONSE = `Hi! If your face verification failed, please try these tips:

• Use bright, even lighting.
• Keep your face centered and clearly visible.
• Remove sunglasses, mask, hat, or anything covering your face.
• Clean your front camera lens.
• Make sure camera permission is enabled.
• Use a stable internet connection.
• Restart the app and try again.

Full guide:
Tips to Pass Face Verification
https://discourse.gooddollar.org/t/tips-to-pass-face-verification/8787

If it still fails, please send a screenshot of the error message, your wallet address, and your phone model so a moderator can review it.`;

const WALLET_CONNECTION_RESPONSE = `Hi! If your wallet is not connecting, please try these steps:

• Make sure you are using the correct wallet/account.
• Check your internet connection.
• Refresh the app or browser.
• Make sure your wallet app or browser extension is updated.
• Approve the connection request when prompted.
• Make sure you have enough gas if you are trying to perform a transaction after connecting.

If it still doesn’t work, please send your wallet address, wallet type, screenshot, and the error message you see.`;

const MINIPAY_SWAP_RESPONSE = `Hi! If swapping failed in GoodDapp while using MiniPay, please check the following:

• Make sure your MiniPay wallet is properly connected.
• Check if you have enough balance for the swap amount.
• Make sure you have enough gas for the transaction.
• Refresh GoodDapp and try again.
• Check if the network is stable and not congested.
• Make sure you are using the correct token and network.

Optional alternative:
You may also check the community initiative GoodMarket swapping tutorial:
https://t.me/GoodDollarX/311491

If the swap still fails, please send your wallet address, screenshot, transaction hash if available, swap pair, amount, and the exact error message so a moderator can review it.`;

const GAS_RESPONSE = `Hi! Some actions may require gas to complete a blockchain transaction.

Please make sure your wallet has enough gas for the network you are using before trying again. If there is not enough gas, the transaction may fail or may not be submitted successfully.

If you are unsure, please send a screenshot of the error message, your wallet address, and what action you were trying to do, such as claim, swap, or transfer.`;

const IMPORT_WALLET_TOKEN_RESPONSE = `Hi! If you want to import your wallet or add the G$ token, please follow these guides:

• Guide: Importing G$ token to a Web3 Wallet
https://discourse.gooddollar.org/t/guide-importing-g-token-to-a-web3-wallet/8817

• Guide: Exporting GoodWallet to EVM Web3 Wallets (MetaMask and TrustWallet)
See Step 1 inside the guide above.

Reminder: Keep your seed phrase/private key safe. Never share it with anyone.

If your G$ balance still does not show, please check that you are using the correct network and the correct G$ token contract address.`;

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
    intentExamples: ["how to claim", "where can i claim", "how can i get gooddollar", "how to claim g$", "how do i claim", "how to claim etc", "claim gooddollar", "claim g$", "paano mag claim", "paano mag-claim"],
    response: HOW_TO_CLAIM_RESPONSE,
    defaultDashboardStatus: "Auto-Replied",
    alwaysEscalate: false,
    escalateIf: "user says still not working / sends error / has failed transaction"
  },
  {
    category: "GoodWallet Claiming Failed",
    intentExamples: ["goodwallet claim failed", "claiming failed", "claim button", "can't claim in goodwallet", "cant claim in goodwallet", "goodwallet claim not working", "claim failed in goodwallet", "my claim failed", "claim button not working"],
    response: CLAIMING_FAILED_RESPONSE,
    defaultDashboardStatus: "Auto-Replied",
    alwaysEscalate: false,
    escalateIf: "user provides error screenshot or says issue continues"
  },
  {
    category: "Cannot Claim G$",
    intentExamples: ["cannot claim", "can't claim", "cant claim", "unable to claim", "claim not working", "hindi ako makapag", "di ako makapag", "g$ claim failed", "i cannot claim", "why i can't claim g$", "can't claim g$", "cant claim g$", "di ako makapag claim", "hindi ako makapag claim"],
    response: CANNOT_CLAIM_RESPONSE,
    defaultDashboardStatus: "Auto-Replied",
    alwaysEscalate: false,
    escalateIf: "user cannot resolve after checklist"
  },
  {
    category: "Face Verification Failed",
    intentExamples: ["face verification", "face scan", "selfie", "verification failed", "verify failed", "camera permission", "face verification failed", "selfie verification failed", "face scan failed", "camera access denied", "face not detected"],
    response: FACE_VERIFICATION_RESPONSE,
    defaultDashboardStatus: "Auto-Replied",
    alwaysEscalate: false,
    escalateIf: "repeated failure / error screenshot / user unable to proceed"
  },
  {
    category: "Wallet Connection Issue",
    intentExamples: ["wallet not connecting", "connect wallet", "can't connect", "cant connect", "metamask not connecting", "trustwallet not connecting", "wallet connection", "wallet connect", "walletconnect", "i can't connect my wallet", "how to connect wallet", "how to connect goodwallet", "minipay wallet not connecting"],
    response: WALLET_CONNECTION_RESPONSE,
    defaultDashboardStatus: "Auto-Replied",
    alwaysEscalate: false,
    escalateIf: "user still cannot connect"
  },
  {
    category: "MiniPay GoodDapp Swap Failed",
    intentExamples: ["minipay", "gooddapp", "swap", "swapping", "swap failed", "minipay swap failed", "swapping failed", "gooddapp swap not working", "swap failed in gooddapp", "i can't swap using minipay", "why my swap failed"],
    response: MINIPAY_SWAP_RESPONSE,
    defaultDashboardStatus: "Auto-Replied",
    alwaysEscalate: false,
    escalateIf: "user provides transaction hash / balance deducted / repeated failure"
  },
  {
    category: "Gas Fee Issue",
    intentExamples: ["not enough gas", "gas fee", "need gas", "what is gas", "how much gas", "gas problem", "gas fee problem", "transaction failed because of gas", "do i need gas", "how much gas needed"],
    response: GAS_RESPONSE,
    defaultDashboardStatus: "Auto-Replied",
    alwaysEscalate: false,
    escalateIf: "user cannot identify required gas / transaction failed repeatedly"
  },
  {
    category: "Importing Wallet / Importing G$ Token",
    intentExamples: ["how to import wallet", "import wallet to metamask", "import wallet to trustwallet", "how to import g$ token", "add g$ token", "import goodwallet", "export goodwallet", "goodwallet to metamask", "goodwallet to trustwallet", "import goodwallet to metamask", "import goodwallet to trust wallet", "export goodwallet to metamask", "export goodwallet to trustwallet", "add gooddollar token", "import gooddollar token", "g$ token not showing", "gooddollar token not showing"],
    response: IMPORT_WALLET_TOKEN_RESPONSE,
    defaultDashboardStatus: "Auto-Replied",
    alwaysEscalate: false,
    escalateIf: "user still cannot import wallet/token or balance does not show"
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
  { category: "MiniPay GoodDapp Swap Failed", keywords: ["minipay", "gooddapp", "swap", "swapping", "swap failed"], score: 90 },
  { category: "Importing Wallet / Importing G$ Token", keywords: ["how to import wallet", "import wallet to metamask", "import wallet to trustwallet", "import wallet to trust wallet", "how to import g$ token", "add g$ token", "import goodwallet", "export goodwallet", "goodwallet to metamask", "goodwallet to trustwallet", "goodwallet to trust wallet", "add gooddollar token", "import gooddollar token", "g$ token not showing", "gooddollar token not showing"], score: 88 },
  { category: "Face Verification Failed", keywords: ["face verification", "face scan", "selfie", "verification failed", "verify failed", "camera permission", "camera access denied", "face not detected"], score: 85 },
  { category: "GoodWallet Claiming Failed", keywords: ["goodwallet claim failed", "claiming failed", "claim button", "can't claim in goodwallet", "cant claim in goodwallet", "goodwallet claim not working", "claim failed in goodwallet", "my claim failed", "claim button not working"], score: 82 },
  { category: "Cannot Claim G$", keywords: ["cannot claim", "can't claim", "cant claim", "unable to claim", "claim not working", "hindi ako makapag", "di ako makapag", "g$ claim failed"], score: 80 },
  { category: "How to Claim G$", keywords: ["how to claim", "where can i claim", "how can i get gooddollar", "how do i claim", "how to claim etc", "claim gooddollar", "claim g$", "paano mag claim", "paano mag-claim"], score: 78 },
  { category: "Wallet Connection Issue", keywords: ["wallet not connecting", "connect wallet", "can't connect", "cant connect", "metamask not connecting", "trustwallet not connecting", "wallet connection", "wallet connect", "walletconnect"], score: 76 },
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
