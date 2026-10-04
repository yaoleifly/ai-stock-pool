import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const files = [
  "index.html",
  "app.js",
  "styles.css",
  "stock-pool.csv",
  "discovery-candidates.csv",
  "discovery-signals.csv",
  "arxiv-papers.csv",
  "discovery-history.csv",
  "discovery-status.json",
  "tpi-latest.json",
  "institutional-crowding-history.json",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of files) {
  await cp(resolve(root, file), resolve(output, file));
}

await cp(resolve(root, "reports"), resolve(output, "reports"), { recursive: true });
console.log(`Built Cloudflare static bundle: ${files.length} files + reports/`);
