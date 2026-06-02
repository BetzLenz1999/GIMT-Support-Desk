import { downloadFile, getFile } from "../../src/lib/telegram.js";

function sendError(response: any, statusCode: number, message: string) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify({ ok: false, error: message }));
}

export default async function handler(request: any, response: any) {
  try {
    const url = new URL(request.url ?? "/", "https://example.com");
    const fileId = url.searchParams.get("file_id")?.trim();
    if (!fileId) {
      sendError(response, 400, "Missing file_id.");
      return;
    }

    const telegramFile = await getFile(fileId);
    if (!telegramFile.file_path) {
      sendError(response, 404, "Telegram did not return a file path for this image.");
      return;
    }

    const downloaded = await downloadFile(telegramFile.file_path);
    response.statusCode = 200;
    response.setHeader("content-type", downloaded.contentType || "application/octet-stream");
    response.setHeader("cache-control", "public, max-age=3600");
    response.end(Buffer.from(downloaded.bytes));
  } catch (error) {
    sendError(response, 500, error instanceof Error ? error.message : String(error));
  }
}
