import vercelHandler from "../../api/web/activity.js";
import { createNetlifyHandler } from "./_adapter.js";

export const handler = createNetlifyHandler(vercelHandler);
