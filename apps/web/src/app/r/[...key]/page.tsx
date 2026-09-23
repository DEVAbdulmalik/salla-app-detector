import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { PageStatus } from "@salla-app-detector/engine";
import { ReportView } from "@/components/report-view";
import { getMessages } from "@/lib/messages";
import { scan, storedReport, type ScanSuccess } from "@/lib/scan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ key: string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const messages = getMessages();
  const title = `${storeKeyOf(await params)} — ${messages.site.name}`;

  return {
    title,
    description: messages.site.description,
    openGraph: { title, description: messages.site.description },
    // A report describes someone else's store; it is meant to be shared, not indexed.
    robots: { index: false, follow: true },
  };
}

export default async function ReportPage({ params }: PageProps) {
  const messages = getMessages();
  const storeKey = storeKeyOf(await params);

  const result = await load(storeKey);
  if (result === undefined) {
    notFound();
  }

  const notice = noticeFor(result.report.status, storeKey, messages);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
      {notice ? (
        <section className="rise rounded-xl border border-line bg-surface p-6">
          <h1 className="text-xl font-semibold">{notice.title}</h1>
          <p className="mt-2 leading-7 text-muted">{notice.body}</p>
          <p className="mt-4 text-sm text-muted" dir="ltr">
            {storeKey}
          </p>
        </section>
      ) : (
        <ReportView report={result.report} messages={messages} scannedAt={result.scannedAt} />
      )}

      <nav className="mt-10 flex gap-4 text-sm">
        <Link href="/" className="text-accent underline-offset-4 hover:underline">
          {messages.report.another}
        </Link>
      </nav>
    </main>
  );
}

/** A shared link works for anyone: serve the stored report, or scan once and store it. */
/** The route carries the key in segments: one for a domain, two for salla.sa/handle. */
function storeKeyOf(params: { key: string[] }): string {
  return params.key.map((segment) => decodeURIComponent(segment)).join("/");
}

async function load(storeKey: string): Promise<ScanSuccess | undefined> {
  const stored = await storedReport(storeKey);
  if (stored) {
    return stored;
  }
  const fresh = await scan(storeKey, undefined);
  return fresh.ok ? fresh : undefined;
}

function noticeFor(
  status: PageStatus,
  storeKey: string,
  messages: ReturnType<typeof getMessages>,
): { title: string; body: string } | undefined {
  switch (status) {
    case "live":
      return undefined;
    case "not-salla":
      return messages.status.notSalla;
    case "closed":
      return messages.status.closed;
    case "maintenance":
      return messages.status.maintenance;
    case "blocked":
      // A key with a handle in it means the store has no domain of its own, and the
      // platform's own host is what refused us, which the visitor can act on.
      return storeKey.includes("/") ? messages.status.blockedHandle : messages.status.blocked;
    case "unsupported":
      return messages.status.unsupported;
  }
}
