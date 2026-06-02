import vercelHandler from "../../api/web/telegram-photo.js";
import { createNetlifyHandler } from "./_adapter.js";

export const handler = createNetlifyHandler(vercelHandler);
