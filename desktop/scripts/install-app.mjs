// Copies the packaged app into ~/Applications (no admin rights needed), quitting any running
// copy first so it's replaced cleanly. With --open, launches the new copy afterwards.
// Run via: npm run install-app [-- --open]
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const QUIT_TIMEOUT_MS = 10_000;
const POLL_MS = 100;

const release = new URL("../release/", import.meta.url).pathname;
const built = readdirSync(release)
  .filter((d) => d.startsWith("mac"))
  .map((d) => join(release, d, "task-app.app"))
  .find(existsSync);
if (!built) throw new Error("No packaged app found in release/. Run `npm run package` first.");

const target = join(homedir(), "Applications", "task-app.app");
const executable = join(target, "Contents", "MacOS", "task-app");

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Pids of the installed app's main process (not a dev build, not its helpers). */
function runningPids() {
  try {
    return execFileSync("pgrep", ["-f", `^${executable}$`], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return []; // pgrep exits 1 when nothing matches
  }
}

/**
 * AppleScript's quit only delivers the request, so wait until the process has actually gone.
 * Otherwise the copy happens under a running app, and `open` just activates the old one as it
 * exits, which leaves nothing running.
 */
function quitRunningCopy() {
  if (!runningPids().length) return;
  try {
    execFileSync("osascript", ["-e", 'tell application id "com.mikeonthemike.task-app" to quit'], { stdio: "ignore" });
  } catch {
    // Fall through to the wait, then the kill.
  }
  const deadline = Date.now() + QUIT_TIMEOUT_MS;
  while (runningPids().length && Date.now() < deadline) sleep(POLL_MS);
  const stuck = runningPids();
  if (stuck.length) {
    console.warn(`task-app didn't quit within ${QUIT_TIMEOUT_MS / 1000}s; killing it.`);
    execFileSync("kill", stuck);
    while (runningPids().length) sleep(POLL_MS);
  }
}

quitRunningCopy();
rmSync(target, { recursive: true, force: true });
cpSync(built, target, { recursive: true, verbatimSymlinks: true });
console.log(`Installed ${target}`);

if (process.argv.includes("--open")) {
  execFileSync("open", [target]);
  console.log("Launched task-app.");
}
