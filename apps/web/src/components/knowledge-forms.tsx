"use client";

import { useState, useTransition } from "react";
import type { NoiseRow } from "@salla-app-detector/knowledge";
import type { Messages } from "@/lib/messages";

interface Result {
  ok: boolean;
  error?: string;
}

const KINDS = [
  "domain",
  "host",
  "service",
  "inline-token",
  "inline-marker",
  "inline-signature",
  "dom-id",
  "custom-element",
  "snippet",
  "tag-container",
  "product-image-host",
  "product-sku-prefix",
] as const;

const NOISE_KINDS = [
  "domains",
  "hosts",
  "identifiers",
  "markers",
  "inlineSignatures",
  "elementIds",
  "customElements",
] as const;

export function AddFingerprintForm({
  messages,
  add,
}: {
  messages: Messages;
  add: (input: {
    kind: string;
    pattern: string;
    appId: string;
    strength: string;
  }) => Promise<Result>;
}) {
  const m = messages.admin.knowledge;
  const reasons: Record<string, string> = m.errors;
  const [form, setForm] = useState({
    kind: "domain",
    pattern: "",
    appId: "",
    strength: "strong",
  });
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError(undefined);
        startTransition(async () => {
          const result = await add(form);
          if (result.ok) {
            setForm((current) => ({ ...current, pattern: "", appId: "" }));
            return;
          }
          setError(reasons[result.error ?? "unknown"] ?? reasons.unknown);
        });
      }}
      className="rounded-xl border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={form.kind}
          onChange={(event) => {
            setForm({ ...form, kind: event.target.value });
          }}
          className="h-9 rounded-md border border-line bg-paper px-2 text-sm"
          aria-label={m.kind}
        >
          {KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>

        <input
          dir="ltr"
          value={form.pattern}
          onChange={(event) => {
            setForm({ ...form, pattern: event.target.value });
          }}
          placeholder={m.add.pattern}
          aria-label={m.add.pattern}
          className="h-9 min-w-60 flex-1 rounded-md border border-line bg-paper px-3 text-start text-sm outline-none focus:border-accent"
        />

        <input
          dir="ltr"
          value={form.appId}
          onChange={(event) => {
            setForm({ ...form, appId: event.target.value });
          }}
          placeholder={m.add.appId}
          aria-label={m.add.appId}
          className="h-9 w-40 rounded-md border border-line bg-paper px-3 text-start text-sm outline-none focus:border-accent"
        />

        <select
          value={form.strength}
          onChange={(event) => {
            setForm({ ...form, strength: event.target.value });
          }}
          className="h-9 rounded-md border border-line bg-paper px-2 text-sm"
          aria-label={m.strength}
        >
          {Object.entries(m.strengths as Record<string, string>).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={pending}
          className="h-9 rounded-md bg-accent px-4 text-sm text-white disabled:opacity-60"
        >
          {m.add.submit}
        </button>
      </div>

      {error !== undefined && <p className="mt-3 text-sm text-caution">{error}</p>}
    </form>
  );
}

export function NoiseList({
  rules,
  messages,
  add,
  remove,
}: {
  rules: readonly NoiseRow[];
  messages: Messages;
  add: (kind: string, pattern: string) => Promise<Result>;
  remove: (kind: string, pattern: string) => Promise<Result>;
}) {
  const m = messages.admin.knowledge;
  const [kind, setKind] = useState<string>("domains");
  const [pattern, setPattern] = useState("");
  const [removed, setRemoved] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const visible = rules.filter((rule) => !removed.includes(`${rule.kind}:${rule.pattern}`));

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            await add(kind, pattern);
            setPattern("");
          });
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <select
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
          }}
          className="h-9 rounded-md border border-line bg-paper px-2 text-sm"
          aria-label={m.kind}
        >
          {NOISE_KINDS.map((noiseKind) => (
            <option key={noiseKind} value={noiseKind}>
              {noiseKind}
            </option>
          ))}
        </select>
        <input
          dir="ltr"
          value={pattern}
          onChange={(event) => {
            setPattern(event.target.value);
          }}
          placeholder={m.noise.pattern}
          aria-label={m.noise.pattern}
          className="h-9 min-w-60 flex-1 rounded-md border border-line bg-paper px-3 text-start text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-9 rounded-md border border-line px-4 text-sm disabled:opacity-60"
        >
          {m.noise.add}
        </button>
      </form>

      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{m.noise.empty}</p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-2">
          {visible.map((rule) => (
            <li
              key={`${rule.kind}:${rule.pattern}`}
              className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-sm"
            >
              <code dir="ltr" className="font-mono text-xs break-all">
                {rule.pattern}
              </code>
              <span className="text-xs text-muted">{rule.kind}</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    const result = await remove(rule.kind, rule.pattern);
                    if (result.ok) {
                      setRemoved((current) => [...current, `${rule.kind}:${rule.pattern}`]);
                    }
                  });
                }}
                aria-label={m.remove}
                className="text-muted transition-colors hover:text-caution"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
