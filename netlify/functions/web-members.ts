import vercelHandler from "../../api/web/members.js";
import { createNetlifyHandler } from "./_adapter.js";

export const handler = createNetlifyHandler(vercelHandler);
