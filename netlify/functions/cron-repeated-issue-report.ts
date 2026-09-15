import vercelHandler from "../../api/cron/repeated-issue-report.js";
import { createNetlifyHandler } from "./_adapter.js";

export const handler = createNetlifyHandler(vercelHandler);
