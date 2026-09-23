import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin-nav";
import { FingerprintTable } from "@/components/fingerprint-table";
import { AddFingerprintForm, NoiseList } from "@/components/knowledge-forms";
import { getRepository } from "@/lib/database";
import { getMessages } from "@/lib/messages";
import { isAdminEmail } from "@/lib/supabase/config";
import { currentUserEmail } from "@/lib/supabase/server";
import {
  addFingerprint,
  addNoiseRule,
  editFingerprint,
  removeFingerprint,
  removeNoiseRule,
} from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const messages = getMessages();
  if (!isAdminEmail(await currentUserEmail())) {
    redirect("/admin");
  }

  const term = (await searchParams).q?.trim() ?? "";
  const repository = getRepository();
  const [fingerprints, noise] = await Promise.all([
    repository?.searchFingerprints(term) ?? [],
    repository?.noiseRules() ?? [],
  ]);

  const m = messages.admin.knowledge;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-line pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{m.title}</h1>
        <AdminNav messages={messages} current="/admin/knowledge" />
      </header>

      <form className="mt-8 flex gap-2" action="/admin/knowledge">
        <input
          name="q"
          defaultValue={term}
          placeholder={m.search}
          aria-label={m.search}
          className="h-10 flex-1 rounded-lg border border-line bg-surface px-4 text-sm outline-none focus:border-accent"
        />
        <button type="submit" className="h-10 rounded-lg border border-line px-5 text-sm">
          {m.searchAction}
        </button>
      </form>

      <div className="mt-6">
        <AddFingerprintForm messages={messages} add={addFingerprint} />
      </div>

      <p className="mt-8 mb-3 text-sm text-muted">
        {fingerprints.length} {m.count}
      </p>
      <FingerprintTable
        fingerprints={fingerprints}
        messages={messages}
        actions={{ edit: editFingerprint, remove: removeFingerprint }}
      />

      <section className="mt-12">
        <h2 className="text-sm font-semibold tracking-wide text-muted">{m.noise.title}</h2>
        <p className="mt-1 mb-4 text-sm text-muted">{m.noise.hint}</p>
        <NoiseList rules={noise} messages={messages} add={addNoiseRule} remove={removeNoiseRule} />
      </section>
    </main>
  );
}
