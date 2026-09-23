"use client";

import { useState } from "react";
import type { Messages } from "@/lib/messages";
import { browserClient } from "@/lib/supabase/browser";

export function SignInForm({ messages }: { messages: Messages }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async (): Promise<void> => {
    setBusy(true);
    try {
      await browserClient().auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      setSent(true);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return <p className="text-sm text-accent">{messages.admin.signInSent}</p>;
  }

  return (
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
  );
}
