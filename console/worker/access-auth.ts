import { createRemoteJWKSet, jwtVerify } from "jose";

interface AccessSettings {
  audience?: string;
  issuer?: string;
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verifyAccessAssertion(
  assertion: string,
  settings: AccessSettings,
): Promise<boolean> {
  const issuer = validIssuer(settings.issuer);
  const audience = validAudience(settings.audience);
  if (!issuer || !audience) return false;

  try {
    await jwtVerify(assertion, remoteKeySet(issuer), {
      algorithms: ["RS256"],
      audience,
      issuer,
    });
    return true;
  } catch {
    return false;
  }
}

function remoteKeySet(issuer: string) {
  const existing = keySets.get(issuer);
  if (existing) return existing;

  const created = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  keySets.set(issuer, created);
  return created;
}

function validIssuer(value?: string) {
  if (!value) return null;
  try {
    const issuer = new URL(value);
    const validHost = issuer.hostname.endsWith(".cloudflareaccess.com");
    const validShape = issuer.protocol === "https:"
      && issuer.pathname === "/"
      && !issuer.username
      && !issuer.password
      && !issuer.search
      && !issuer.hash;
    return validHost && validShape ? issuer.origin : null;
  } catch {
    return null;
  }
}

function validAudience(value?: string) {
  return value && /^[A-Za-z0-9_-]{16,255}$/.test(value) ? value : null;
}
