import type { DetectedApp, ScanReport } from "@salla-app-detector/engine";

/** The identifier alone says nothing; the catalogue turns it into a theme someone knows. */
function themeLine(report: ScanReport): string {
  const theme = report.theme;
  if (theme === undefined) {
    return "?";
  }
  const version = theme.installedVersion === undefined ? "" : ` ${theme.installedVersion}`;
  const developer = theme.developer === undefined ? "" : ` (${theme.developer})`;
  return theme.name === undefined ? `${theme.id} (unknown)` : `${theme.name}${version}${developer}`;
}

export function renderReport(report: ScanReport, elapsedMs: number): string {
  const lines: string[] = [];
  const store = report.store;

  lines.push("");
  lines.push(`${store?.name ?? report.target.host}  —  ${report.target.host}`);
  lines.push(
    `status: ${report.status}${report.statusDetail === undefined ? "" : ` (${report.statusDetail})`}${
      store === undefined ? "" : `   store: ${String(store.id)}   theme: ${themeLine(report)}`
    }`,
  );

  if (report.status !== "live") {
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  lines.push("");
  lines.push(section("apps", report.apps.map(appLine)));
  if (report.dropshipping.length > 0) {
    lines.push(section("dropshipping", report.dropshipping.map(appLine)));
  }
  lines.push(
    section(
      "integrations",
      report.integrations.map(
        (integration) =>
          `${integration.key}${integration.name === undefined ? "" : `  (${integration.name})`}`,
      ),
    ),
  );
  lines.push(
    section(
      "payments",
      [
        report.payments.methods.join(", ") || "none",
        report.payments.installments.length > 0
          ? `installments: ${report.payments.installments.join(", ")}`
          : "",
      ].filter((line) => line !== ""),
    ),
  );
  lines.push(
    section(
      "unidentified signals",
      report.unknownSignals.slice(0, 10).map((signal) => `${signal.kind}: ${signal.value}`),
    ),
  );
  lines.push(
    `engine ${report.meta.engineVersion} · knowledge ${report.meta.knowledgeVersion} · ${String(elapsedMs)} ms`,
  );
  lines.push("");
  lines.push("Apps that run only between Salla and a vendor's server leave no public trace.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function appLine(app: DetectedApp): string {
  const flags = [
    app.confidence,
    app.isDefault ? "preinstalled" : "",
    app.status === "delisted" ? "delisted" : "",
    app.status === "unidentified" ? "unidentified" : "",
  ].filter((flag) => flag !== "");
  const evidence = app.evidence.map((item) => `${item.kind}=${item.value}`).join(", ");
  const oneOf =
    app.alternatives === undefined
      ? ""
      : `\n      one of: ${app.alternatives.map((alternative) => alternative.name).join(", ")}`;
  return `${app.name}  [${flags.join(", ")}]\n      ${evidence}${oneOf}`;
}

function section(title: string, entries: readonly string[]): string {
  if (entries.length === 0) {
    return `${title}:\n  (none)\n`;
  }
  return `${title}:\n${entries.map((entry) => `  ${entry}`).join("\n")}\n`;
}
