// Copies the packaged app into ~/Applications (no admin rights needed), quitting any running
// copy first so it's replaced cleanly. Run via: npm run install-app
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const release = new URL("../release/", import.meta.url).pathname;
const built = readdirSync(release)
  .filter((d) => d.startsWith("mac"))
  .map((d) => join(release, d, "task-app.app"))
  .find(existsSync);
if (!built) throw new Error("No packaged app found in release/. Run `npm run package` first.");

try {
  execFileSync("osascript", ["-e", 'tell application "task-app" to quit'], { stdio: "ignore" });
} catch {
  // Not running.
}

const target = join(homedir(), "Applications", "task-app.app");
rmSync(target, { recursive: true, force: true });
cpSync(built, target, { recursive: true, verbatimSymlinks: true });
console.log(`Installed ${target}`);
