type HeaderValue = number | string | readonly string[];
type VercelStyleHandler = (request: any, response: any) => unknown | Promise<unknown>;

type NetlifyEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
  isScheduled?: boolean;
  path?: string;
  queryStringParameters?: Record<string, string | undefined> | null;
  rawQuery?: string;
  rawUrl?: string;
};

function isScheduledInvocation(event: NetlifyEvent): boolean {
  if (event.isScheduled === true) return true;
  const headers = event.headers ?? {};
  const userAgent = headers["user-agent"] ?? headers["User-Agent"];
  return typeof userAgent === "string" && /netlify.*cron/i.test(userAgent);
}

function normalizeHeaders(headers: Record<string, string | undefined> = {}): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    normalized[key] = value;
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

function getRequestUrl(event: NetlifyEvent): string {
  if (event.rawUrl) return event.rawUrl;
  const path = event.path || "/";
  if (event.rawQuery) return `${path}?${event.rawQuery}`;

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(event.queryStringParameters ?? {})) {
    if (value !== undefined) query.set(key, value);
  }
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

function getRequestBody(event: NetlifyEvent): Buffer {
  if (!event.body) return Buffer.alloc(0);
  return Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8");
}

function createVercelStyleRequest(event: NetlifyEvent): any {
  const body = getRequestBody(event);
  return {
    method: event.httpMethod || "GET",
    url: getRequestUrl(event),
    headers: normalizeHeaders(event.headers),
    async *[Symbol.asyncIterator]() {
      if (body.length > 0) yield body;
    }
  };
}

function createVercelStyleResponse() {
  const headers: Record<string, string> = {};
  let body = "";
  return {
    get body() {
      return body;
    },
    headers,
    statusCode: 200,
    setHeader(name: string, value: HeaderValue) {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
    },
    end(payload?: unknown) {
      if (payload !== undefined) body = Buffer.isBuffer(payload) ? payload.toString("utf8") : String(payload);
    }
  };
}

export function createNetlifyHandler(vercelHandler: VercelStyleHandler) {
  return async (event: NetlifyEvent) => {
    const request = createVercelStyleRequest(event);

    if (isScheduledInvocation(event)) {
      const cronSecret = process.env.CRON_SECRET;
      if (cronSecret && !request.headers.authorization) {
        request.headers.authorization = `Bearer ${cronSecret}`;
      }
    }

    const response = createVercelStyleResponse();

    await vercelHandler(request, response);

    return {
      statusCode: response.statusCode,
      headers: response.headers,
      body: response.body
    };
  };
}
