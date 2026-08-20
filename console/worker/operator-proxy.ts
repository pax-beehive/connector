const operatorPrefix = "/api/operator/connections/";
const createPath = `${operatorPrefix}instagram`;
const adminPrefix = "/api/admin/";
const createTenantPath = `${adminPrefix}tenants`;
const enrollLlmModelPath = `${adminPrefix}llm/models`;
const setLlmRoutePath = `${adminPrefix}llm/routes`;
const bodyLimit = 32 * 1024;
const accessAssertionHeader = "Cf-Access-Jwt-Assertion";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AdminServiceAccess {
  clientId?: string;
  clientSecret?: string;
}

export async function handleOperatorRequest(
  request: Request,
  assertion: string,
  platformEdgeUrl: string | undefined,
  adminEdgeUrl: string | undefined,
  adminAccess: AdminServiceAccess | undefined,
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  const incoming = new URL(request.url);
  const admin = incoming.pathname.startsWith(adminPrefix);
  if (!admin && !incoming.pathname.startsWith(operatorPrefix)) return null;

  const origin = validOrigin(admin ? adminEdgeUrl : platformEdgeUrl);
  if (!origin) return operatorError(503, "operator_configuration_unavailable");
  const serviceAccess = admin ? validServiceAccess(adminAccess) : null;
  if (admin && !serviceAccess) return operatorError(503, "operator_configuration_unavailable");
  if (incoming.search) return operatorError(404, "not_found");
  if (request.method !== "POST") return operatorError(405, "method_not_allowed");
  if (!validPath(incoming.pathname)) return operatorError(404, "not_found");
  if (!assertion || assertion.length > 16_384) return operatorError(401, "access_invalid");
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return operatorError(415, "content_type_required");
  }

  const body = await readBoundedBody(request);
  if (!body) return operatorError(413, "request_too_large");
  const target = new URL(admin ? adminPath(incoming.pathname) : operatorPath(incoming.pathname), origin);
  const headers = new Headers({ "Content-Type": "application/json" });
  if (serviceAccess) {
    // The admin edge sits behind Cloudflare Access: authenticate the Worker
    // with the Access service token and delegate the operator identity via a
    // bearer assertion, which the admin edge forwards as the delegated
    // assertion header. Access injects its own service JWT assertion.
    headers.set("CF-Access-Client-Id", serviceAccess.clientId);
    headers.set("CF-Access-Client-Secret", serviceAccess.clientSecret);
    headers.set("Authorization", `Bearer ${assertion}`);
  } else {
    headers.set(accessAssertionHeader, assertion);
  }
  const requestID = request.headers.get("X-Request-ID");
  if (requestID && uuidPattern.test(requestID)) headers.set("X-Request-ID", requestID);

  try {
    const response = await fetcher(new Request(target, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
    }));
    if (response.status >= 300 && response.status < 400) {
      return operatorError(502, "origin_redirect_rejected");
    }
    return sanitizedResponse(response);
  } catch {
    return operatorError(502, "origin_unavailable");
  }
}

async function readBoundedBody(request: Request) {
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > bodyLimit) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > bodyLimit) {
      await reader.cancel();
      return null;
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function validServiceAccess(access: AdminServiceAccess | undefined) {
  const clientId = access?.clientId ?? "";
  const clientSecret = access?.clientSecret ?? "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function validOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const origin = new URL(value);
    return origin.protocol === "https:"
      && !origin.username
      && !origin.password
      && origin.pathname === "/"
      && !origin.search
      && !origin.hash
      ? origin
      : null;
  } catch {
    return null;
  }
}

function validPath(path: string) {
  if (path === createPath || path === createTenantPath || path === enrollLlmModelPath || path === setLlmRoutePath) return true;
  const match = path.match(/^\/api\/operator\/connections\/([^/]+)\/checks$/);
  return Boolean(match && uuidPattern.test(match[1]));
}

function operatorPath(path: string) {
  return path.replace(/^\/api\/operator/, "/v1/operator");
}

function adminPath(path: string) {
  return path.replace(/^\/api\/admin/, "/v1/admin");
}

function sanitizedResponse(response: Response) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": response.headers.get("Content-Type") ?? "application/json",
    "X-Content-Type-Options": "nosniff",
  });
  const requestID = response.headers.get("X-Request-ID");
  if (requestID && uuidPattern.test(requestID)) headers.set("X-Request-ID", requestID);
  return new Response(response.body, { status: response.status, headers });
}

function operatorError(status: number, kind: string) {
  return Response.json({ error: { kind } }, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
