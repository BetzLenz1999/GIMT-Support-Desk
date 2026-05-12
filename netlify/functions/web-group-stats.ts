import vercelHandler from "../../api/web/group-stats.js";
import { createNetlifyHandler } from "./_adapter.js";

export const handler = createNetlifyHandler(vercelHandler);
