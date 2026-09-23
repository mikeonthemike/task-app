import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AppConfig {
  /** Absolute path to the root of the Obsidian vault. */
  vaultPath: string;
  /** Folder inside the vault where task-app keeps its markdown files. */
  tasksDir: string;
}

const CONFIG_DIR = join(homedir(), ".config", "task-app");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}

export function loadConfig(): AppConfig {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `No config found at ${CONFIG_PATH}. Run "task-app init" first.`,
    );
  }
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as AppConfig;
  if (!raw.tasksDir) raw.tasksDir = "Tasks";
  return raw;
}

export function saveConfig(config: AppConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

export function configPath(): string {
  return CONFIG_PATH;
}

export function configDir(): string {
  return CONFIG_DIR;
}
