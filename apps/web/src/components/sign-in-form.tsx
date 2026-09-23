"use client";

import { useState } from "react";
import type { Messages } from "@/lib/messages";
import { browserClient } from "@/lib/supabase/browser";

export function SignInForm({
  messages,
  initialError,
}: {
  messages: Messages;
  initialError?: string;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError);

  const reasons: Record<string, string> = messages.admin.signInErrors;

  const send = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const { error: failure } = await browserClient().auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (failure) {
        // Supabase answers a refused send with a status; the message itself is in English.
        setError(describe(failure.status, failure.message, reasons));
        return;
      }
      setSent(true);
    } catch {
      setError(reasons.generic);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return <p className="text-sm text-accent">{messages.admin.signInSent}</p>;
  }

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="flex flex-col gap-3 sm:flex-row"
      >
        <input
          type="email"
          required
          dir="ltr"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          aria-label={messages.admin.email}
          className="h-11 flex-1 rounded-lg border border-line bg-surface px-4 text-start outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy}
          className="h-11 rounded-lg bg-accent px-5 text-white disabled:opacity-60"
        >
          {messages.admin.signIn}
        </button>
      </form>

      {error !== undefined && <p className="mt-3 text-sm text-caution">{error}</p>}
    </div>
  );
}

function describe(
  status: number | undefined,
  message: string,
  reasons: Record<string, string>,
): string {
  if (status === 429) {
    return reasons["rate-limit"] ?? message;
  }
  if (status === 400 && message.toLowerCase().includes("email")) {
    return reasons["invalid-email"] ?? message;
  }
  return `${reasons.generic ?? ""} ${message}`.trim();
}
