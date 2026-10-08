import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const [stage, ...args] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!["dev", "prod"].includes(stage)) {
  fail("Choose dev or prod: npm run deploy:dev / npm run deploy:prod");
}
if (args.includes("--help")) {
  console.log(`Usage: npm run deploy:${stage}${stage === "prod" ? " -- [--allow-non-main]" : ""}`);
  process.exit(0);
}
if (args.some((arg) => arg !== "--allow-non-main")) {
  fail("Unknown argument. Use --help for deployment options.");
}
if (stage === "dev" && args.length) {
  fail("--allow-non-main is only used for production deployments.");
}

if (stage === "prod") {
  let branch;
  try {
    branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    fail("Cannot determine the current Git branch. Production deployment stopped.");
  }
  if (!branch) {
    fail("Cannot determine the current Git branch. Production deployment stopped.");
  }
  if (branch !== "main") {
    const label = branch === "HEAD" ? "detached HEAD" : `branch "${branch}"`;
    console.error(`WARNING: Deploying production from ${label}, rather than main.`);
    if (!args.includes("--allow-non-main")) {
      fail("Deployment stopped. To override, run: npm run deploy:prod -- --allow-non-main");
    }
    console.error("--allow-non-main supplied; continuing with production deployment.");
  }
}

console.log(`Deploying LaserQueue-${stage} in us-east-2 using profile innovation-center.`);
const result = spawnSync("npm", [
  "run", "deploy", "--", `LaserQueue-${stage}`, "-c", `stage=${stage}`,
  "--profile", "innovation-center", "--region", "us-east-2",
], { cwd: root, stdio: "inherit" });
if (result.error) {
  fail(`Could not start deployment: ${result.error.message}`);
}
process.exit(result.status ?? 1);
