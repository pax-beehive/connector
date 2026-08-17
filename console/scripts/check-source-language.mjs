import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const roots = ["app", "src", "tests", "worker", "scripts"];
const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".css"]);
const disallowed = /\p{Script=Han}|\p{Extended_Pictographic}/u;
const violations = [];

async function inspect(path) {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) {
      await inspect(target);
    } else if (extensions.has(extname(entry.name))) {
      const source = await readFile(target, "utf8");
      if (disallowed.test(source)) violations.push(target);
    }
  }
}

await Promise.all(roots.map(inspect));

if (violations.length > 0) {
  console.error(`Disallowed source characters in: ${violations.join(", ")}`);
  process.exitCode = 1;
}
