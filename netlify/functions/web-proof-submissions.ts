import vercelHandler from "../../api/web/proof-submissions.js";
import { createNetlifyHandler } from "./_adapter.js";

export const handler = createNetlifyHandler(vercelHandler);
