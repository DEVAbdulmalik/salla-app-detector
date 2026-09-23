import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin-nav";
import { reportPath } from "@/lib/site";
import { getRepository } from "@/lib/database";
import { getMessages } from "@/lib/messages";
import { isAdminEmail } from "@/lib/supabase/config";
import { currentUserEmail } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 60;

export default async function ScansPage({
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
  const scans = (await repository?.recentScans(PAGE_SIZE, term)) ?? [];

  const m = messages.admin.scans;
  const statuses: Record<string, string> = m.statusLabels;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-line pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{m.title}</h1>
        <AdminNav messages={messages} current="/admin/scans" />
      </header>

      <form className="mt-8 flex gap-2" action="/admin/scans">
        <input
          name="q"
          defaultValue={term}
          dir="ltr"
          placeholder={m.search}
          aria-label={m.search}
          className="h-10 flex-1 rounded-lg border border-line bg-surface px-4 text-start text-sm outline-none focus:border-accent"
        />
        <button type="submit" className="h-10 rounded-lg border border-line px-5 text-sm">
          {messages.admin.knowledge.searchAction}
        </button>
      </form>

      {scans.length === 0 ? (
        <p className="mt-8 text-sm text-muted">{m.empty}</p>
      ) : (
        <ul className="mt-8 space-y-2">
          {scans.map((scan) => (
            <li
              key={scan.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border border-line bg-surface px-4 py-3"
            >
              <Link
                href={reportPath(scan.storeKey)}
                dir="ltr"
                className="font-mono text-sm break-all text-accent underline-offset-4 hover:underline"
              >
                {scan.storeKey}
              </Link>
              <span className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted">
                <span>{statuses[scan.status] ?? scan.status}</span>
                <span>
                  {scan.appCount} {m.apps}
                </span>
                <span>
                  {scan.unknownCount} {m.unknown}
                </span>
                <span dir="ltr">{scan.durationMs} ms</span>
                <time dateTime={scan.scannedAt.toISOString()}>
                  {scan.scannedAt.toLocaleDateString("ar-SA")}
                </time>
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
