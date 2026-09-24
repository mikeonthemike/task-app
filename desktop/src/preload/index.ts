import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { Snapshot, TaskAppApi } from "../shared/api.js";

// The renderer is sandboxed; this is the whole surface it gets.
const api: TaskAppApi = {
  getSnapshot: () => ipcRenderer.invoke("snapshot:get"),
  getList: (id) => ipcRenderer.invoke("list:get", id),
  onSnapshot: (cb) => {
    const listener = (_e: IpcRendererEvent, s: Snapshot) => cb(s);
    ipcRenderer.on("snapshot", listener);
    return () => ipcRenderer.removeListener("snapshot", listener);
  },
  complete: (id) => ipcRenderer.invoke("task:complete", id),
  uncomplete: (id) => ipcRenderer.invoke("task:uncomplete", id),
  capture: (text) => ipcRenderer.invoke("capture:add", text),
  previewCapture: (text) => ipcRenderer.invoke("capture:preview", text),
  openTask: (id) => ipcRenderer.invoke("open:task", id),
  openDailyNote: () => ipcRenderer.invoke("open:dailyNote"),
  togglePill: () => ipcRenderer.invoke("pill:toggle"),
  hideWindow: () => ipcRenderer.send("window:hide"),
  onCaptureReset: (cb) => {
    const listener = () => cb();
    ipcRenderer.on("capture:reset", listener);
    return () => ipcRenderer.removeListener("capture:reset", listener);
  },
};

contextBridge.exposeInMainWorld("taskApp", api);
