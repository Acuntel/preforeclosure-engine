// A2 P0-1: `vince-track.js --dry-run --from` prints the pick and never writes
// state or sends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, statSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pick = await import("./fixtures/a2-fake-pick.js");

function dry(extraEnv = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "vince-a2dry-"));
  const leadsFile = path.join(dir, "leads.json");
  const stateFile = path.join(dir, "state.json");
  writeFileSync(leadsFile, JSON.stringify({ leads: pick.fakeLeads() }));
  const state = { sentKeys: [], outcomes: {}, lastDigestDate: "2026-09-28" };
  writeFileSync(stateFile, JSON.stringify(state));
  const before = statSync(stateFile).mtimeMs;
  const r = spawnSync(process.execPath, ["vince-track.js", "--dry-run", "--from", leadsFile, "--as-of", "2026-09-29"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      VINCE_PING_OFF: "1",
      VINCE_EMAIL_OFF: "1",
      VINCE_STATE_FILE: stateFile,
      VINCE_ARCHIVE_DIR: dir,
      VINCE_TEST: "1",
      VINCE_PICK_MODULE: path.join(ROOT, "test", "fixtures", "a2-fake-pick.js"),
      ...extraEnv,
    },
  });
  return { r, dir, stateFile, before, state };
}

test("dry run prints the pick + runners-up with EV terms and leaves state untouched", () => {
  const { r, dir, stateFile, before, state } = dry();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /#1 PICK {2}132 S LINDEN AVE, ELMHURST/);
  assert.match(r.stdout, /EV \$250k \| equity \$250k/);
  assert.match(r.stdout, /pStage 1\.00 pContact 1\.00 pConf 1\.00 pProx 1\.00/);
  assert.match(r.stdout, /#2 {6}1 OAK ST/);
  assert.match(r.stdout, /gate drops: none/);
  assert.match(r.stdout, /not sent: dry run/);
  assert.doesNotMatch(r.stdout, /emailed/);
  assert.equal(statSync(stateFile).mtimeMs, before);
  assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), state);
  assert.ok(existsSync(path.join(dir, "picks", "2026-09-29.dryrun.json")));
  assert.ok(!existsSync(path.join(dir, "picks", "2026-09-29.json")));
});

test("dry run with every gate failing prints the no-deal message", () => {
  const { r } = dry({ FAKE_PICK_NONE: "1" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /#1 PICK {2}none/);
  assert.match(r.stdout, /No deal worth your time today\. Closest miss: 132 S LINDEN AVE, ELMHURST\./);
  assert.match(r.stdout, /gate drops: small_gap 3/);
});

test("dry run with a degraded pool says the digest would defer", () => {
  const { r } = dry({ FAKE_HEALTH_BAD: "1" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /pool health: DEGRADED/);
});
