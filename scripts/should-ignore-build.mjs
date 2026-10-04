import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function shouldIgnoreProductionBuild(status) {
  return !(
    status &&
    status.status === "success" &&
    status.attemptedDate &&
    status.dataDate === status.attemptedDate
  );
}

export async function main({ environment = process.env.VERCEL_ENV } = {}) {
  if (environment !== "production") {
    console.log("Discovery gate: preview or local build may proceed.");
    return 1;
  }

  try {
    const status = JSON.parse(await readFile(new URL("../discovery-status.json", import.meta.url), "utf8"));
    if (shouldIgnoreProductionBuild(status)) {
      console.log("Discovery gate: production build skipped because the latest refresh is not verified successful.");
      return 0;
    }
  } catch (error) {
    console.log(`Discovery gate: production build skipped because status could not be verified (${error.message}).`);
    return 0;
  }

  console.log("Discovery gate: verified refresh found; production build may proceed.");
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
