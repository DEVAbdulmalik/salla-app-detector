import type { DetectedApp, DetectedTheme, ScanReport } from "@salla-app-detector/engine";
import { integrationLabel, paymentLabel } from "@/lib/labels";
import type { Messages } from "@/lib/messages";

const CONFIDENCE_TONE = {
  confirmed: "bg-accent",
  strong: "bg-accent/60",
  possible: "bg-muted/50",
} as const;

export function ReportView({
  report,
  messages,
  scannedAt,
}: {
  report: ScanReport;
  messages: Messages;
  scannedAt: Date;
}) {
  const m = messages.report;

  return (
    <div className="rise space-y-10">
      <StoreHeader report={report} messages={messages} scannedAt={scannedAt} />

      {report.theme !== undefined && (
        <Section title={m.themeSection}>
          <ThemeRow theme={report.theme} messages={messages} />
        </Section>
      )}

      <Section title={m.apps}>
        {report.apps.length === 0 ? (
          <Empty text={m.appsEmpty} />
        ) : (
          <ul className="space-y-3">
            {report.apps.map((app) => (
              <li key={app.appId}>
                <AppRow app={app} messages={messages} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {report.dropshipping.length > 0 && (
        <Section title={m.dropshipping}>
          <ul className="space-y-3">
            {report.dropshipping.map((app) => (
              <li key={app.appId}>
                <AppRow app={app} messages={messages} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={m.integrations}>
        {report.integrations.length === 0 ? (
          <Empty text={m.integrationsEmpty} />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {report.integrations.map((integration) => (
              <li
                key={integration.key}
                className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm"
              >
                {integrationLabel(integration, messages)}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {(report.payments.methods.length > 0 || report.payments.installments.length > 0) && (
        <Section title={m.payments}>
          <p className="text-sm leading-7 text-muted">
            {report.payments.methods.map((method) => paymentLabel(method, messages)).join(" · ")}
          </p>
          {report.payments.installments.length > 0 && (
            <p className="mt-2 text-sm text-muted">
              <span className="text-ink">{m.installments}: </span>
              <span>
                {report.payments.installments
                  .map((provider) => paymentLabel(provider, messages))
                  .join(" · ")}
              </span>
            </p>
          )}
        </Section>
      )}

      {report.unknownSignals.length > 0 && (
        <Section title={`${m.unknown} (${String(report.unknownSignals.length)})`}>
          <p className="text-sm text-muted">{m.unknownBody}</p>
        </Section>
      )}

      <p className="border-t border-line pt-6 text-sm leading-7 text-muted">{m.disclaimer}</p>
    </div>
  );
}

function StoreHeader({
  report,
  messages,
  scannedAt,
}: {
  report: ScanReport;
  messages: Messages;
  scannedAt: Date;
}) {
  const store = report.store;

  return (
    <header className="border-b border-line pb-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {store?.name ?? report.target.host}
      </h1>
      <p className="mt-2 text-sm text-muted" dir="ltr">
        {report.target.host}
      </p>
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
        {store !== undefined && <Fact label={messages.report.storeId} value={String(store.id)} />}
        <Fact
          label={messages.report.scannedAt}
          value={new Intl.DateTimeFormat("ar-SA", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(scannedAt)}
        />
      </dl>
    </header>
  );
}

/**
 * The store declares its theme rather than leaving traces of it, so this card carries no
 * confidence badge: there is nothing to be uncertain about beyond whether the catalogue
 * knows the name.
 */
function ThemeRow({ theme, messages }: { theme: DetectedTheme; messages: Messages }) {
  const m = messages.report;
  const behind =
    theme.installedVersion !== undefined &&
    theme.latestVersion !== undefined &&
    theme.installedVersion !== theme.latestVersion;

  return (
    <article className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h3 className="text-base font-medium">{theme.name ?? m.themeUnknown}</h3>
        {theme.rating !== undefined && (
          <span className="text-sm text-muted">
            <span dir="ltr">★ {theme.rating.toFixed(1)}</span>
            {theme.ratingsCount !== undefined && ` (${theme.ratingsCount.toLocaleString("ar-SA")})`}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        {theme.developer !== undefined && <span>{theme.developer}</span>}
        {theme.installedVersion !== undefined && (
          <span dir="ltr">
            {m.themeVersion} {theme.installedVersion}
          </span>
        )}
        {behind && (
          <Flag text={`${m.themeOutdated}: ${theme.latestVersion ?? ""}`} tone="caution" />
        )}
        {theme.isBeta === true && <Flag text={m.themeBeta} />}
        {theme.listingId !== undefined && (
          <a
            href={`https://salla.com/themes/${theme.listingId}`}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent underline-offset-4 hover:underline"
          >
            {m.themeStore}
          </a>
        )}
      </div>

      {theme.name === undefined && <p className="mt-2 text-sm text-muted">{m.themeUnknownHint}</p>}

      <p dir="ltr" className="mt-3 font-mono text-xs text-muted">
        theme = {theme.id}
      </p>
    </article>
  );
}

function AppRow({ app, messages }: { app: DetectedApp; messages: Messages }) {
  const m = messages.report;
  const isCompanyGuess = app.ambiguousWith !== undefined;

  return (
    <article className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h3 className="text-base font-medium">
          {isCompanyGuess ? `${m.flags.company}: ${app.name}` : app.name}
        </h3>
        <Confidence label={m.confidence[app.confidence]} level={app.confidence} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        {app.company !== undefined && !isCompanyGuess && <span>{app.company}</span>}
        {app.categories.slice(0, 2).map((category) => (
          <span key={category}>{category}</span>
        ))}
        {app.isDefault && <Flag text={m.flags.preinstalled} />}
        {app.status === "delisted" && <Flag text={m.flags.delisted} tone="caution" />}
        {app.status === "unidentified" && !isCompanyGuess && <Flag text={m.flags.unidentified} />}
        {!app.appId.startsWith("company:") && app.status !== "unidentified" && (
          <a
            href={`https://apps.salla.sa/ar/app/${app.appId}`}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent underline-offset-4 hover:underline"
          >
            {m.appStore}
          </a>
        )}
      </div>

      <details className="group mt-3">
        <summary className="cursor-pointer list-none text-sm text-muted transition-colors hover:text-ink">
          <span className="group-open:hidden">{m.evidence} ▾</span>
          <span className="hidden group-open:inline">{m.evidence} ▴</span>
        </summary>
        <ul className="mt-2 space-y-1 border-s-2 border-line ps-3 font-mono text-xs text-muted">
          {app.evidence.map((item) => (
            <li key={`${item.kind}:${item.value}`} dir="ltr" className="text-start break-all">
              {item.kind} = {item.value}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function Confidence({ label, level }: { label: string; level: DetectedApp["confidence"] }) {
  return (
    <span className="flex items-center gap-2 text-sm text-muted">
      <span className={`size-2 rounded-full ${CONFIDENCE_TONE[level]}`} aria-hidden />
      {label}
    </span>
  );
}

function Flag({ text, tone }: { text: string; tone?: "caution" }) {
  const classes =
    tone === "caution" ? "bg-caution-soft text-caution" : "bg-accent-soft text-accent";
  return <span className={`rounded px-2 py-0.5 text-xs ${classes}`}>{text}</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted">{text}</p>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt>{label}:</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
