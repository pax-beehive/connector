/** Cloudflare Worker entry point for the PAX Console. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { verifyAccessAssertion } from "./access-auth";
import { handleOperatorRequest } from "./operator-proxy";

interface Env {
  ASSETS: Fetcher;
  CONSOLE_AUTH_MODE?: string;
  CONSOLE_ACCESS_AUDIENCE?: string;
  CONSOLE_ACCESS_ISSUER?: string;
  PLATFORM_EDGE_URL?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env | undefined, ctx: ExecutionContext): Promise<Response> {
    const authMode = env?.CONSOLE_AUTH_MODE;
    const accessAssertion = request.headers.get("cf-access-jwt-assertion") ?? "";
    if (authMode) {
      const allowed = authMode === "cloudflare_access"
        && await verifyAccessAssertion(
          accessAssertion,
          {
            audience: env.CONSOLE_ACCESS_AUDIENCE,
            issuer: env.CONSOLE_ACCESS_ISSUER,
          },
        );
      if (!allowed) return new Response("Forbidden", { status: 403 });
    }

    const url = new URL(request.url);
    const operatorResponse = await handleOperatorRequest(
      request,
      accessAssertion,
      env?.PLATFORM_EDGE_URL,
    );
    if (operatorResponse) return operatorResponse;

    if (url.pathname === "/_vinext/image") {
      if (!env) return new Response("Image bindings unavailable", { status: 503 });
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
