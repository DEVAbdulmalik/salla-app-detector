"use client";

import { useState, useTransition } from "react";
import type { FingerprintRow } from "@salla-app-detector/knowledge";
import type { Messages } from "@/lib/messages";

export interface FingerprintActions {
  edit: (id: string, change: { status?: string; strength?: string }) => Promise<Result>;
  remove: (id: string) => Promise<Result>;
}

interface Result {
  ok: boolean;
  error?: string;
}

export function FingerprintTable({
  fingerprints,
  messages,
  actions,
}: {
  fingerprints: readonly FingerprintRow[];
  messages: Messages;
  actions: FingerprintActions;
}) {
  const m = messages.admin.knowledge;

  if (fingerprints.length === 0) {
    return <p className="text-sm text-muted">{m.empty}</p>;
  }

  return (
    <ul className="space-y-2">
      {fingerprints.map((fingerprint) => (
        <FingerprintRowView
          key={fingerprint.id}
          fingerprint={fingerprint}
          messages={messages}
          actions={actions}
        />
      ))}
    </ul>
  );
}

function FingerprintRowView({
  fingerprint,
  messages,
  actions,
}: {
  fingerprint: FingerprintRow;
  messages: Messages;
  actions: FingerprintActions;
}) {
  const m = messages.admin.knowledge;
  const reasons: Record<string, string> = m.errors;
  const strengths: Record<string, string> = m.strengths;
  const statuses: Record<string, string> = m.statuses;

  const [state, setState] = useState<{ status: string; strength: string }>({
    status: fingerprint.status,
    strength: fingerprint.strength,
  });
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  const run = (work: () => Promise<Result>, after: () => void): void => {
    setError(undefined);
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        after();
        return;
      }
      setError(reasons[result.error ?? "unknown"] ?? reasons.unknown);
    });
  };

  if (gone) {
    return null;
  }

  const disabled = state.status === "disabled";

  return (
    <li
      className={`rounded-xl border border-line bg-surface px-4 py-3 ${disabled ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <code dir="ltr" className="font-mono text-sm break-all">
          {fingerprint.pattern}
        </code>
        <span className="text-xs text-muted">
          {fingerprint.kind} · {fingerprint.source} · {m.matches}: {fingerprint.matchCount}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">
          {fingerprint.appName ?? fingerprint.company ?? fingerprint.appId ?? "—"}
        </span>

        <select
          value={state.strength}
          disabled={pending}
          onChange={(event) => {
            const strength = event.target.value;
            run(
              () => actions.edit(fingerprint.id, { strength }),
              () => {
                setState((current) => ({ ...current, strength }));
              },
            );
          }}
          className="h-8 rounded-md border border-line bg-paper px-2 text-sm"
          aria-label={m.strength}
        >
          {Object.entries(strengths).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={pending}
          onClick={() => {
            const status = disabled ? "active" : "disabled";
            run(
              () => actions.edit(fingerprint.id, { status }),
              () => {
                setState((current) => ({ ...current, status }));
              },
            );
          }}
          className="h-8 rounded-md border border-line px-3 text-sm text-muted transition-colors hover:text-ink disabled:opacity-60"
        >
          {disabled ? m.enable : m.disable}
        </button>

        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!confirm(m.confirmRemove)) {
              return;
            }
            run(
              () => actions.remove(fingerprint.id),
              () => {
                setGone(true);
              },
            );
          }}
          className="h-8 rounded-md px-3 text-sm text-muted transition-colors hover:text-caution disabled:opacity-60"
        >
          {m.remove}
        </button>

        <span className="text-xs text-muted">{statuses[state.status]}</span>
      </div>

      {error !== undefined && <p className="mt-2 text-sm text-caution">{error}</p>}
    </li>
  );
}
