// @vitest-environment node
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyAccessAssertion } from "../worker/access-auth";

describe("verifyAccessAssertion", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts a signed token for the configured issuer and audience", async () => {
    const issuer = "https://unit-test.cloudflareaccess.com";
    const audience = "console-audience-1";
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const publicJWK = { ...await exportJWK(publicKey), alg: "RS256", kid: "test-key", use: "sig" };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ keys: [publicJWK] }), {
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetcher);

    const assertion = await new SignJWT({ email: "viewer@example.invalid" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setAudience(audience)
      .setExpirationTime("2h")
      .setIssuedAt()
      .setIssuer(issuer)
      .sign(privateKey);

    await expect(verifyAccessAssertion(assertion, { audience, issuer })).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects an untrusted issuer before making a network request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);

    await expect(verifyAccessAssertion("token", {
      audience: "console-audience-1",
      issuer: "https://example.invalid",
    })).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
