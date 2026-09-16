import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const minimumRows = {
  "stock-pool.csv": 1,
  "discovery-signals.csv": 1,
  "discovery-candidates.csv": 1,
  "discovery-history.csv": 1,
};

for (const [file, minimum] of Object.entries(minimumRows)) {
  const text = await readFile(resolve(root, file), "utf8");
  const rows = text.trim().split(/\r?\n/).length - 1;
  if (rows < minimum) throw new Error(`${file} contains ${rows} data rows; refusing to build`);
  console.log(`${file}: ${rows} data rows`);
}

const paperText = await readFile(resolve(root, "arxiv-papers.csv"), "utf8");
console.log(`arxiv-papers.csv: ${Math.max(0, paperText.trim().split(/\r?\n/).length - 1)} data rows`);

const discoveryStatus = JSON.parse(await readFile(resolve(root, "discovery-status.json"), "utf8"));
if (!["success", "failed", "reused"].includes(discoveryStatus.status)) {
  throw new Error("discovery-status.json contains an invalid status");
}
if (!discoveryStatus.attemptedDate || !Object.hasOwn(discoveryStatus, "dataDate")) {
  throw new Error("discovery-status.json must include attemptedDate and dataDate");
}
console.log(`discovery-status.json: ${discoveryStatus.status}, data ${discoveryStatus.dataDate || "unavailable"}`);

const policySnapshot = JSON.parse(await readFile(resolve(root, "tpi-latest.json"), "utf8"));
if (!Array.isArray(policySnapshot.pressureBreakdown) || policySnapshot.pressureBreakdown.length !== 4) {
  throw new Error("tpi-latest.json must contain four pressure decomposition groups");
}
if (!Array.isArray(policySnapshot.policyEvents)) {
  throw new Error("tpi-latest.json policyEvents must be an array");
}
if (!policySnapshot.institutionalCrowding || !Array.isArray(policySnapshot.institutionalCrowding.rows)) {
  throw new Error("tpi-latest.json must contain an institutional crowding fallback");
}
if (!policySnapshot.scenarioMatrix?.current || policySnapshot.scenarioMatrix?.scenarios?.length !== 4) {
  throw new Error("tpi-latest.json must contain the four policy and crowding scenarios");
}
console.log(`tpi-latest.json: ${policySnapshot.version} policy intelligence fallback`);

const crowdingHistory = JSON.parse(await readFile(resolve(root, "institutional-crowding-history.json"), "utf8"));
if (!Array.isArray(crowdingHistory.snapshots)) {
  throw new Error("institutional-crowding-history.json snapshots must be an array");
}
for (const snapshot of crowdingHistory.snapshots) {
  if (!snapshot.date || !Array.isArray(snapshot.rows) || snapshot.rows.length < 1) {
    throw new Error("institutional-crowding-history.json contains an invalid snapshot");
  }
}
console.log(`institutional-crowding-history.json: ${crowdingHistory.snapshots.length} point-in-time snapshots`);
