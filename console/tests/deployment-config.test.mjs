import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generates a private production Cloudflare deployment", async () => {
  const config = JSON.parse(await readFile(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"));

  assert.equal(config.name, "fde-platform-prod-console-ui");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, [{ pattern: "fde-console.paxtech.net", custom_domain: true }]);
  assert.equal(config.vars.CONSOLE_AUTH_MODE, "cloudflare_access");
  assert.equal(config.vars.CONSOLE_DATA_MODE, "live");
  assert.equal(config.vars.ADMIN_EDGE_URL, "https://fde-console-api.paxtech.net");
  assert.equal("CF_ACCESS_CLIENT_ID" in config.vars, false);
  assert.equal("CF_ACCESS_CLIENT_SECRET" in config.vars, false);
});
