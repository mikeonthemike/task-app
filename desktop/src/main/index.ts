import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray } from "electron";
import type { Snapshot } from "../shared/api.js";
import { VaultService } from "./vaultService.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const CAPTURE_SHORTCUT = "Control+Alt+Space";
const POPOVER = { width: 360, height: 540 };
const PILL = { width: 320, height: 44 };
const TITLE_MAX = 28;

/** Window position and visibility of the pill, remembered between launches. */
interface State {
  pillVisible: boolean;
  pillBounds?: { x: number; y: number };
}
const statePath = () => join(app.getPath("userData"), "widget-state.json");
function loadState(): State {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8")) as State;
  } catch {
    return { pillVisible: false };
  }
}
function saveState(): void {
  writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

let state: State;
let tray: Tray;
let popover: BrowserWindow;
let capture: BrowserWindow | null = null;
let pill: BrowserWindow | null = null;
const vault = new VaultService(broadcast);

function snapshot(): Snapshot {
  return vault.snapshot(state.pillVisible);
}

function broadcast(): void {
  const s = snapshot();
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send("snapshot", s);
  updateTrayTitle(s);
}

/** The menu bar shows the first open focus task, or a count when there isn't one. */
function updateTrayTitle(s: Snapshot): void {
  if (s.error) return tray.setTitle(" !");
  const first = s.focus[0];
  if (first) {
    const t = first.title.length > TITLE_MAX ? `${first.title.slice(0, TITLE_MAX - 1)}…` : first.title;
    return tray.setTitle(` ${t}`);
  }
  const left = s.today.length + s.followUps.length;
  tray.setTitle(left ? ` ${left}` : "");
}

function loadPage(win: BrowserWindow, view: "popover" | "capture" | "pill"): void {
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${view}`);
  else win.loadFile(join(here, "../renderer/index.html"), { hash: view });
}

function makeWindow(opts: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  return new BrowserWindow({
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    ...opts,
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
}

function createPopover(): void {
  popover = makeWindow({ ...POPOVER, movable: false, vibrancy: "popover", visualEffectState: "active" });
  popover.on("blur", () => {
    if (!popover.webContents.isDevToolsOpened()) popover.hide();
  });
  loadPage(popover, "popover");
}

function togglePopover(): void {
  if (popover.isVisible()) return popover.hide();
  const b = tray.getBounds();
  const area = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;
  const x = Math.round(Math.min(Math.max(b.x + b.width / 2 - POPOVER.width / 2, area.x + 8), area.x + area.width - POPOVER.width - 8));
  popover.setPosition(x, Math.round(b.y + b.height + 4));
  vault.rescan(); // cheap, and catches anything the watcher coalesced
  popover.show();
  popover.focus();
}

function showCapture(): void {
  if (!capture) {
    capture = makeWindow({ width: 560, height: 96, vibrancy: "hud", visualEffectState: "active", alwaysOnTop: true });
    capture.on("blur", () => capture?.hide());
    capture.on("closed", () => (capture = null));
    loadPage(capture, "capture");
  }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  capture.setPosition(Math.round(area.x + (area.width - 560) / 2), Math.round(area.y + area.height * 0.22));
  capture.show();
  capture.focus();
  capture.webContents.send("capture:reset");
}

function setPillVisible(visible: boolean): void {
  state.pillVisible = visible;
  saveState();
  if (visible) {
    if (!pill) {
      const area = screen.getPrimaryDisplay().workArea;
      const pos = state.pillBounds ?? { x: area.x + area.width - PILL.width - 24, y: area.y + 12 };
      pill = makeWindow({ ...PILL, ...pos, transparent: true, hasShadow: true, alwaysOnTop: true });
      pill.setAlwaysOnTop(true, "floating");
      pill.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      pill.on("moved", () => {
        const [x, y] = pill!.getPosition();
        state.pillBounds = { x, y };
        saveState();
      });
      pill.on("closed", () => (pill = null));
      pill.once("ready-to-show", () => pill?.showInactive());
      loadPage(pill, "pill");
    }
  } else {
    pill?.close();
  }
  broadcast();
}

function trayMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: "Quick capture", accelerator: CAPTURE_SHORTCUT, click: showCapture },
    { label: "Show focus pill", type: "checkbox", checked: state.pillVisible, click: (i) => setPillVisible(i.checked) },
    { label: "Open today's note", click: () => openUrl(vault.obsidianUrlForDailyNote()) },
    { type: "separator" },
    // Unpackaged, this would register the bare Electron binary rather than the widget.
    ...(app.isPackaged
      ? [
          {
            label: "Open at login",
            type: "checkbox" as const,
            checked: app.getLoginItemSettings().openAtLogin,
            click: (i: Electron.MenuItem) => app.setLoginItemSettings({ openAtLogin: i.checked }),
          },
        ]
      : []),
    { label: "Quit task-app", role: "quit" },
  ]);
}

async function openUrl(url: string | null): Promise<void> {
  if (url) await shell.openExternal(url);
}

function registerIpc(): void {
  ipcMain.handle("snapshot:get", () => snapshot());
  ipcMain.handle("task:complete", (_e, id: string) => vault.complete(id));
  ipcMain.handle("task:uncomplete", (_e, id: string) => vault.uncomplete(id));
  ipcMain.handle("capture:add", (_e, text: string) => vault.capture(text));
  ipcMain.handle("capture:preview", (_e, text: string) => vault.previewCapture(text));
  ipcMain.handle("open:task", (_e, id: string) => openUrl(vault.obsidianUrlForTask(id)));
  ipcMain.handle("open:dailyNote", () => openUrl(vault.obsidianUrlForDailyNote()));
  ipcMain.handle("pill:toggle", () => setPillVisible(!state.pillVisible));
  ipcMain.on("window:hide", (e) => BrowserWindow.fromWebContents(e.sender)?.hide());
}

app.whenReady().then(() => {
  app.dock?.hide(); // menu-bar app: no Dock icon, no app switcher entry
  state = loadState();

  const icon = nativeImage.createFromPath(join(here, "../../resources/trayTemplate.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("task-app");
  tray.on("click", togglePopover);
  tray.on("right-click", () => tray.popUpContextMenu(trayMenu()));

  registerIpc();
  createPopover();
  vault.start();
  if (state.pillVisible) setPillVisible(true);
  broadcast();

  if (!globalShortcut.register(CAPTURE_SHORTCUT, showCapture)) {
    console.warn(`Couldn't register ${CAPTURE_SHORTCUT}; another app may own it.`);
  }
});

// Closing every window (e.g. the pill) must not quit a menu-bar app.
app.on("window-all-closed", () => {});
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  void vault.stop();
});

