"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Messages } from "@/lib/messages";

type ErrorKey = keyof Messages["form"]["errors"];

const REQUEST_TIMEOUT_MS = 45_000;

const ERROR_BY_CODE: Record<string, ErrorKey> = {
  empty: "empty",
  invalid: "invalid",
  platform: "platform",
  "rate-limited": "rateLimited",
  unreachable: "unreachable",
};

export function ScanForm({ messages }: { messages: Messages }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<ErrorKey | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (busy) {
      return;
    }
    if (url.trim() === "") {
      setError("empty");
      return;
    }

    setBusy(true);
    setError(undefined);

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = (await response.json()) as { host?: string; error?: string };

      if (!response.ok || body.host === undefined) {
        setError(ERROR_BY_CODE[body.error ?? ""] ?? "unknown");
        setBusy(false);
        return;
      }

      router.push(`/r/${encodeURIComponent(body.host)}`);
    } catch (cause) {
      setError(
        cause instanceof DOMException && cause.name === "TimeoutError" ? "unreachable" : "unknown",
      );
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
    >
      <label htmlFor="store-url" className="block text-sm font-medium text-muted">
        {messages.form.label}
      </label>

      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <input
          id="store-url"
          name="url"
          type="text"
          inputMode="url"
          dir="ltr"
          autoComplete="url"
          spellCheck={false}
          value={url}
          placeholder={messages.form.placeholder}
          onChange={(event) => {
            setUrl(event.target.value);
          }}
          aria-invalid={error !== undefined}
          aria-describedby={error === undefined ? "store-url-hint" : "store-url-error"}
          className="h-12 flex-1 rounded-lg border border-line bg-surface px-4 text-start text-base text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy}
          className="h-12 rounded-lg bg-accent px-6 text-base font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 sm:w-40"
        >
          {busy ? <Working label={messages.form.working} /> : messages.form.submit}
        </button>
      </div>

      {error === undefined ? (
        <p id="store-url-hint" className="mt-3 text-sm text-muted">
          {messages.form.hint}
        </p>
      ) : (
        <p id="store-url-error" role="alert" className="mt-3 text-sm text-caution">
          {messages.form.errors[error]}
        </p>
      )}
    </form>
  );
}

function Working({ label }: { label: string }) {
  return (
    <span className="flex items-center justify-center gap-2">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="size-1.5 rounded-full bg-white/80"
            style={{ animation: `pulse 1.1s ${String(index * 0.15)}s ease-in-out infinite` }}
          />
        ))}
      </span>
      {label}
    </span>
  );
}
