import type { ConsoleSnapshot } from "../domain/console";
import { verifiedAccessAssertionHeader } from "../access-boundary";
import { prototypeRepository } from "./mock-console-repository";
import { PlatformConsoleRepository } from "./platform-console-repository";

interface LiveConsoleOptions {
  requestHeaders: Headers;
  environment: Record<string, string | undefined>;
  fetcher?: typeof fetch;
}

export async function loadConsoleSnapshot(options: LiveConsoleOptions): Promise<ConsoleSnapshot> {
  const mode = options.environment.CONSOLE_DATA_MODE ?? "prototype";
  if (mode === "prototype") return prototypeRepository.getSnapshot();
  if (mode !== "live") throw new Error("Console data mode is invalid");
  requireConsoleIdentity(options.requestHeaders, options.environment.CONSOLE_AUTH_MODE ?? "sites");

  return new PlatformConsoleRepository({
    edgeUrl: requiredSetting(options.environment.ADMIN_EDGE_URL, "admin edge URL"),
    clientId: requiredSetting(options.environment.CF_ACCESS_CLIENT_ID, "client id"),
    clientSecret: requiredSetting(options.environment.CF_ACCESS_CLIENT_SECRET, "client secret"),
    accessAssertion: options.requestHeaders.get(verifiedAccessAssertionHeader) ?? undefined,
    fetcher: options.fetcher,
  }).getSnapshot();
}

function requireConsoleIdentity(requestHeaders: Headers, mode: string) {
  if (mode === "cloudflare_access") {
    const assertion = requestHeaders.get(verifiedAccessAssertionHeader);
    if (!assertion || assertion.length > 16_384) {
      throw new Error("Verified Cloudflare Access identity is required");
    }
    return;
  }
  if (mode !== "sites") throw new Error("Console auth mode is invalid");

  const userID = requestHeaders.get("oai-authenticated-user-id");
  if (!userID || userID.trim() !== userID || userID.length > 256) {
    throw new Error("Authenticated Sites identity is required");
  }
}

function requiredSetting(value: string | undefined, label: string) {
  if (!value) throw new Error(`Console ${label} is not configured`);
  return value;
}
