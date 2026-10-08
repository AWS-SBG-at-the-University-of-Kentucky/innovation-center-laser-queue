import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const bin = mkdtempSync(join(tmpdir(), "laser-deploy-test-"));
const root = fileURLToPath(new URL("../", import.meta.url));
const script = fileURLToPath(new URL("./deploy.mjs", import.meta.url));
after(() => rmSync(bin, { recursive: true, force: true }));

// Stub both external commands so these tests can never invoke CDK or AWS.
writeFileSync(join(bin, "git"), `#!/usr/bin/env node
if (process.env.TEST_GIT_FAIL) process.exit(1);
console.log(process.env.TEST_BRANCH);
`, { mode: 0o755 });
writeFileSync(join(bin, "npm"), `#!/usr/bin/env node
console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));
process.exit(Number(process.env.TEST_DEPLOY_EXIT || 0));
`, { mode: 0o755 });

function run(stage, branch, args = [], env = {}) {
  return spawnSync(process.execPath, [script, stage, ...args], {
    cwd: bin,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_BRANCH: branch, ...env },
  });
}

function assertDeployed(result, stage) {
  assert.equal(result.status, 0, result.stderr);
  const invocation = JSON.parse(result.stdout.trim().split("\n").at(-1));
  assert.equal(invocation.cwd, root.replace(/\/$/, ""));
  assert.deepEqual(invocation.args, [
    "run", "deploy", "--", `LaserQueue-${stage}`, "-c", `stage=${stage}`,
    "--profile", "innovation-center", "--region", "us-east-2",
  ]);
}

test("development deployment works on a feature branch", () => {
  assertDeployed(run("dev", "feature/test"), "dev");
});
test("production deployment works on main", () => {
  assertDeployed(run("prod", "main"), "prod");
});
test("production off main warns and never invokes the deployment", () => {
  const result = run("prod", "feature/test");
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /WARNING.*feature\/test/);
  assert.match(result.stderr, /--allow-non-main/);
});
test("explicit override retains the warning and deploys production", () => {
  const result = run("prod", "feature/test", ["--allow-non-main"]);
  assertDeployed(result, "prod");
  assert.match(result.stderr, /WARNING/);
});
test("detached HEAD requires an explicit override", () => {
  const blocked = run("prod", "HEAD");
  assert.equal(blocked.status, 1);
  assert.equal(blocked.stdout, "");
  assert.match(blocked.stderr, /detached HEAD/);
  assertDeployed(run("prod", "HEAD", ["--allow-non-main"]), "prod");
});
test("Git failures stop production even with an override", () => {
  const result = run("prod", "main", ["--allow-non-main"], { TEST_GIT_FAIL: "1" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Cannot determine/);
});
test("deployment failure exit status is preserved", () => {
  assert.equal(run("dev", "main", [], { TEST_DEPLOY_EXIT: "7" }).status, 7);
});
test("extra arguments cannot redirect the selected environment", () => {
  const result = run("dev", "main", ["-c", "stage=prod"]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
});
