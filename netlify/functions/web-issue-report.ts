import vercelHandler from "../../api/web/issue-report.js";
import { createNetlifyHandler } from "./_adapter.js";

export const handler = createNetlifyHandler(vercelHandler);