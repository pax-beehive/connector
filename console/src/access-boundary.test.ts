import { describe, expect, it } from "vitest";
import {
  verifiedAccessAssertionHeader,
  withVerifiedAccessAssertion,
} from "./access-boundary";

describe("withVerifiedAccessAssertion", () => {
  it("overwrites an untrusted assertion with the Worker-verified value", () => {
    const forwarded = withVerifiedAccessAssertion(new Request("https://console.example.invalid", {
      headers: { [verifiedAccessAssertionHeader]: "untrusted" },
    }), "verified");

    expect(forwarded.headers.get(verifiedAccessAssertionHeader)).toBe("verified");
  });

  it("removes an untrusted assertion when no verified value exists", () => {
    const forwarded = withVerifiedAccessAssertion(new Request("https://console.example.invalid", {
      headers: { [verifiedAccessAssertionHeader]: "untrusted" },
    }), "");

    expect(forwarded.headers.has(verifiedAccessAssertionHeader)).toBe(false);
  });
});
