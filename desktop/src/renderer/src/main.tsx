import { createRoot } from "react-dom/client";
import { CaptureWindow } from "./Capture";
import { Pill } from "./Pill";
import { Popover } from "./Popover";
import "./styles.css";

// One bundle, three windows: the main process loads index.html#popover|capture|pill.
const view = location.hash.slice(1) || "popover";
document.body.dataset.view = view;
const App = { popover: Popover, capture: CaptureWindow, pill: Pill }[view] ?? Popover;
createRoot(document.getElementById("root")!).render(<App />);
