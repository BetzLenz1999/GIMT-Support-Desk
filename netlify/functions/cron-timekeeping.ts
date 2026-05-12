import vercelHandler from "../../api/cron/timekeeping.js";
import { createNetlifyHandler } from "./_adapter.js";

export const handler = createNetlifyHandler(vercelHandler);
