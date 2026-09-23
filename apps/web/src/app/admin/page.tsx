import Link from "next/link";
import { getRepository } from "@/lib/database";
import { getMessages } from "@/lib/messages";
import { isAdminEmail } from "@/lib/supabase/config";
import { currentUserEmail } from "@/lib/supabase/server";
import { CandidateQueue } from "@/components/candidate-queue";
import { decideCandidate } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const messages = getMessages();
  const email = await currentUserEmail();

  if (!isAdminEmail(email)) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6">
        <h1 className="text-2xl font-semibold">{messages.admin.title}</h1>
        <p className="mt-3 text-muted">
          {email === undefined ? messages.admin.signInHint : messages.admin.notAllowed}
        </p>
        <Link href="/admin/sign-in" className="mt-6 text-accent underline-offset-4 hover:underline">
          {messages.admin.signIn}
        </Link>
      </main>
    );
  }

  const repository = getRepository();
  const [snapshot, candidates, scans, events] = await Promise.all([
    repository?.readPublishedSnapshot(),
    repository?.listCandidates("new", 40) ?? [],
    repository?.recentScanCount(30) ?? 0,
    repository?.recentHealthEvents(8) ?? [],
  ]);

  const m = messages.admin;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-line pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{m.title}</h1>
        <span className="text-sm text-muted">{email}</span>
      </header>

      <section className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label={m.stats.apps} value={Object.keys(snapshot?.apps ?? {}).length} />
        <Stat label={m.stats.fingerprints} value={snapshot?.fingerprints.length ?? 0} />
        <Stat label={m.stats.scans} value={scans} />
        <Stat label={m.stats.candidates} value={candidates.length} />
      </section>
      <p className="mt-3 text-sm text-muted">
        {m.stats.knowledge}: <span dir="ltr">{snapshot?.version ?? "—"}</span>
      </p>

      <section className="mt-12">
        <h2 className="mb-4 text-sm font-semibold tracking-wide text-muted">
          {m.candidates.title}
        </h2>
        <CandidateQueue candidates={candidates} messages={messages} onDecide={decideCandidate} />
      </section>

      <section className="mt-12">
        <h2 className="mb-4 text-sm font-semibold tracking-wide text-muted">{m.health.title}</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted">{m.health.empty}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {events.map((event) => (
              <li key={event.id} className="rounded-lg border border-line bg-surface px-4 py-3">
                <span className="text-muted">{event.severity}</span> · {event.kind}{" "}
                <span dir="ltr" className="font-mono text-xs text-muted">
                  {JSON.stringify(event.detail)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-2xl font-semibold">{value.toLocaleString("ar-SA")}</div>
      <div className="mt-1 text-sm text-muted">{label}</div>
    </div>
  );
}
