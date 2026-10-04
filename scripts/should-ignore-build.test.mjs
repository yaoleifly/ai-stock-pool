import assert from "node:assert/strict";
import test from "node:test";

import { main, shouldIgnoreProductionBuild } from "./should-ignore-build.mjs";

test("production build is ignored unless refresh is verified successful", () => {
  assert.equal(shouldIgnoreProductionBuild(null), true);
  assert.equal(
    shouldIgnoreProductionBuild({ status: "failed", attemptedDate: "2026-09-16", dataDate: "2026-09-04" }),
    true
  );
  assert.equal(
    shouldIgnoreProductionBuild({ status: "success", attemptedDate: "2026-09-16", dataDate: "2026-09-16" }),
    false
  );
});

test("preview builds remain available for acceptance", async () => {
  assert.equal(await main({ environment: "preview" }), 1);
});
