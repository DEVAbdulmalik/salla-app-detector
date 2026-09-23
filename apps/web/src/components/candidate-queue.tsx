"use client";

import { useState, useTransition } from "react";
import type { CandidateRow } from "@salla-app-detector/knowledge";
import type { Messages } from "@/lib/messages";
import type { Decision } from "@/app/admin/actions";

type Decide = (
  signalKind: string,
  signalValue: string,
  decision: Decision,
  appId: string,
) => Promise<{ ok: boolean; error?: string }>;

export function CandidateQueue({
  candidates,
  messages,
  onDecide,
}: {
  candidates: readonly CandidateRow[];
  messages: Messages;
  onDecide: Decide;
}) {
  const m = messages.admin.candidates;

  if (candidates.length === 0) {
    return <p className="text-sm text-muted">{m.empty}</p>;
  }

  return (
    <ul className="space-y-3">
      {candidates.map((candidate) => (
        <li key={`${candidate.signalKind}:${candidate.signalValue}`}>
          <CandidateCard candidate={candidate} messages={messages} onDecide={onDecide} />
        </li>
      ))}
    </ul>
  );
}

function CandidateCard({
  candidate,
  messages,
  onDecide,
}: {
  candidate: CandidateRow;
  messages: Messages;
  onDecide: Decide;
}) {
  const m = messages.admin.candidates;
  const [appId, setAppId] = useState(candidate.suggestedAppId ?? "");
  const [done, setDone] = useState<Decision | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  const decide = (decision: Decision): void => {
    startTransition(async () => {
      const result = await onDecide(candidate.signalKind, candidate.signalValue, decision, appId);
      if (result.ok) {
        setDone(decision);
      }
    });
  };

  if (done !== undefined) {
    return (
      <article className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
        <span dir="ltr">{candidate.signalValue}</span> —{" "}
        {done === "promote" ? m.promoted : m.ignored}
      </article>
    );
  }

  return (
    <article className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <code dir="ltr" className="font-mono text-sm break-all">
          {candidate.signalValue}
        </code>
        <span className="text-sm text-muted">
          {m.stores}: {candidate.storeCount}
        </span>
      </div>

      <p className="mt-1 text-xs text-muted">{candidate.signalKind}</p>

      {candidate.sample !== undefined && (
        <p dir="ltr" className="mt-2 line-clamp-2 font-mono text-xs text-muted">
          {candidate.sample}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label htmlFor={`app-${candidate.signalValue}`} className="text-sm text-muted">
          {m.appId}
        </label>
        <input
          id={`app-${candidate.signalValue}`}
          dir="ltr"
          value={appId}
          onChange={(event) => {
            setAppId(event.target.value);
          }}
          placeholder={candidate.suggestedAppName ?? m.noSuggestion}
          className="h-9 w-48 rounded-md border border-line bg-paper px-3 text-sm outline-none focus:border-accent"
        />
        {candidate.suggestedAppName !== undefined && (
          <span className="text-sm text-muted">{candidate.suggestedAppName}</span>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            decide("promote");
          }}
          className="h-9 rounded-md bg-accent px-4 text-sm text-white disabled:opacity-60"
        >
          {m.promote}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            decide("ignore");
          }}
          className="h-9 rounded-md border border-line px-4 text-sm text-muted disabled:opacity-60"
        >
          {m.ignore}
        </button>
      </div>
    </article>
  );
}
