import { useEffect, useRef, useState } from "react";
import type { CapturePreview } from "../../shared/api";
import { relativeDate } from "./format";
import { useSnapshot } from "./useSnapshot";

interface Props {
  today: string;
  /** The standalone hotkey window closes itself after adding; the popover footer stays put. */
  standalone?: boolean;
}

export function CaptureInput({ today, standalone }: Props) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<CapturePreview | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!standalone) return;
    return window.taskApp.onCaptureReset(() => {
      setText("");
      setStatus(null);
      input.current?.focus();
    });
  }, [standalone]);

  useEffect(() => {
    if (!text.trim()) return setPreview(null);
    let live = true;
    window.taskApp.previewCapture(text).then((p) => live && setPreview(p));
    return () => {
      live = false;
    };
  }, [text]);

  async function submit() {
    if (!text.trim()) return;
    const r = await window.taskApp.capture(text);
    if (!r.ok) return setStatus({ kind: "error", message: r.error ?? "Couldn't add that." });
    setText("");
    setStatus({ kind: "ok", message: "Added to Inbox" });
    if (standalone) setTimeout(() => window.taskApp.hideWindow(), 500);
    else setTimeout(() => setStatus(null), 1500);
  }

  const hint = status
    ? status.message
    : preview
      ? `Inbox · “${preview.title}”${preview.scheduled ? ` · ${relativeDate(preview.scheduled, today)}` : ""}`
      : standalone
        ? "Goes to your Inbox. Dates like “tomorrow” or “fri” are picked up."
        : "";

  return (
    <div className={`capture${standalone ? " standalone" : ""}`}>
      <input
        ref={input}
        autoFocus={standalone}
        value={text}
        placeholder={standalone ? "New to-do" : "Add to Inbox…"}
        onChange={(e) => {
          setText(e.target.value);
          setStatus(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") standalone ? window.taskApp.hideWindow() : setText("");
        }}
      />
      {hint && <div className={`hint${status?.kind === "error" ? " urgent" : ""}`}>{hint}</div>}
    </div>
  );
}

export function CaptureWindow() {
  const snap = useSnapshot();
  return snap ? <CaptureInput today={snap.date} standalone /> : null;
}
