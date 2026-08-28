"use client";

// SPEC-D G4.3 — the gmail_send_email-shaped specialization of the destructive
// two-phase gate (pattern-only port of AOC integrations/gmail/src/frontend/
// tools/email-tool-ui.tsx, rendered in OUR UI, not a remote bundle):
//   phase 1: an editable compose form — To / Cc / Bcc (comma-separated →
//            string arrays), Subject, Body — → explicit [Send email] /
//            [Decline];
//   phase 2: result view → [Close].
// Any staged args beyond the compose fields (threadId, attachments, …) are
// preserved verbatim on send. Decline NEVER calls — onDecline only.

import { useMemo, useState } from "react";
import { GateFrame, GateHeader, GateButtons, GateResultView, type DestructiveGateResult } from "./DestructiveToolGate";
import { inputStyle, monoStyle } from "../shared";

export interface EmailToolUiProps {
  toolName: string;
  initialArgs: Record<string, unknown>;
  running: boolean;
  result: DestructiveGateResult | null;
  onSend: (args: Record<string, unknown>) => void;
  onDecline: () => void;
}

const COMPOSE_KEYS = ["to", "cc", "bcc", "subject", "body"] as const;

/** Schema check the parent uses to pick this UI over the generic gate. */
export function isEmailShapedSchema(inputSchema: Record<string, unknown> | undefined): boolean {
  const props = inputSchema?.properties;
  if (typeof props !== "object" || props === null) return false;
  const keys = Object.keys(props as Record<string, unknown>);
  return ["to", "subject", "body"].every((k) => keys.includes(k));
}

const listToText = (v: unknown): string =>
  Array.isArray(v) ? v.map(String).join(", ") : typeof v === "string" ? v : "";

const textToList = (s: string): string[] =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export default function EmailToolUi({
  toolName,
  initialArgs,
  running,
  result,
  onSend,
  onDecline,
}: EmailToolUiProps) {
  const [to, setTo] = useState(() => listToText(initialArgs.to));
  const [cc, setCc] = useState(() => listToText(initialArgs.cc));
  const [bcc, setBcc] = useState(() => listToText(initialArgs.bcc));
  const [subject, setSubject] = useState(() =>
    typeof initialArgs.subject === "string" ? initialArgs.subject : "",
  );
  const [body, setBody] = useState(() => (typeof initialArgs.body === "string" ? initialArgs.body : ""));
  const [localError, setLocalError] = useState<string | null>(null);

  const extraKeys = useMemo(
    () => Object.keys(initialArgs).filter((k) => !(COMPOSE_KEYS as readonly string[]).includes(k)),
    [initialArgs],
  );

  const send = () => {
    const toList = textToList(to);
    if (toList.length === 0) {
      setLocalError("'to' needs at least one recipient");
      return;
    }
    if (!subject.trim()) {
      setLocalError("'subject' is required");
      return;
    }
    if (!body.trim()) {
      setLocalError("'body' is required");
      return;
    }
    setLocalError(null);
    const args: Record<string, unknown> = { ...initialArgs, to: toList, subject, body };
    const ccList = textToList(cc);
    const bccList = textToList(bcc);
    if (ccList.length > 0) args.cc = ccList;
    else delete args.cc;
    if (bccList.length > 0) args.bcc = bccList;
    else delete args.bcc;
    onSend(args);
  };

  const field = (label: string, value: string, set: (v: string) => void, placeholder?: string) => (
    <div>
      <span className="block mb-1 font-mono text-[11px]" style={{ color: "var(--fg-dim, #9aa)" }}>
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg px-2.5 h-8 text-[12.5px] outline-none"
        style={inputStyle}
      />
    </div>
  );

  return (
    <GateFrame>
      {result ? (
        <>
          <GateHeader text={`${toolName} — result`} />
          <GateResultView result={result} onClose={onDecline} />
        </>
      ) : (
        <>
          <GateHeader text="Review this email before it is sent" />
          <div className="flex flex-col gap-2">
            {field("to", to, setTo, "alice@example.com, bob@example.com")}
            {field("cc", cc, setCc)}
            {field("bcc", bcc, setBcc)}
            {field("subject", subject, setSubject)}
            <div>
              <span className="block mb-1 font-mono text-[11px]" style={{ color: "var(--fg-dim, #9aa)" }}>
                body
              </span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                className="w-full rounded-lg px-2.5 py-2 text-[12.5px] outline-none resize-y"
                style={inputStyle}
              />
            </div>
            {extraKeys.length > 0 && (
              <div className="text-[10.5px]" style={{ ...monoStyle, color: "var(--fg-dimmer, #6b6478)" }}>
                kept as staged: {extraKeys.join(", ")}
              </div>
            )}
          </div>
          {localError && (
            <div className="mt-1.5 text-[11.5px]" style={{ color: "#f87171" }}>
              {localError}
            </div>
          )}
          <GateButtons running={running} sendLabel="Send email" onSend={send} onDecline={onDecline} />
        </>
      )}
    </GateFrame>
  );
}
