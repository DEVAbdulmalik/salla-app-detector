"use server";

import type { EvidenceKind } from "@salla-app-detector/engine";
import { revalidatePath } from "next/cache";
import { getRepository } from "@/lib/database";
import { isAdminEmail } from "@/lib/supabase/config";
import { currentUserEmail } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const STRENGTHS = ["decisive", "strong", "medium"] as const;
const STATUSES = ["active", "candidate", "disabled"] as const;
const NOISE_KINDS = [
  "hosts",
  "domains",
  "identifiers",
  "inlineSignatures",
  "markers",
  "elementIds",
  "customElements",
] as const;
const FINGERPRINT_KINDS = [
  "snippet",
  "service",
  "domain",
  "host",
  "inline-token",
  "inline-marker",
  "inline-signature",
  "dom-id",
  "custom-element",
  "tag-container",
  "product-image-host",
  "product-sku-prefix",
] as const satisfies readonly EvidenceKind[];

/**
 * Every change here lands in the published snapshot, which is what scanning reads. The
 * allowlist is checked in each action: a server action is an endpoint of its own.
 */
async function authorized(): Promise<boolean> {
  return isAdminEmail(await currentUserEmail());
}

export async function editFingerprint(
  id: string,
  change: { status?: string; strength?: string },
): Promise<ActionResult> {
  if (!(await authorized())) {
    return { ok: false, error: "not-allowed" };
  }
  const repository = getRepository();
  if (!repository) {
    return { ok: false, error: "no-database" };
  }

  const status = STATUSES.find((allowed) => allowed === change.status);
  const strength = STRENGTHS.find((allowed) => allowed === change.strength);
  if (status === undefined && strength === undefined) {
    return { ok: false, error: "nothing-to-change" };
  }

  await repository.setFingerprintState(id, {
    ...(status === undefined ? {} : { status }),
    ...(strength === undefined ? {} : { strength }),
  });
  await repository.publishSnapshot();
  revalidatePath("/admin/knowledge");
  return { ok: true };
}

export async function addFingerprint(input: {
  kind: string;
  pattern: string;
  appId: string;
  strength: string;
}): Promise<ActionResult> {
  if (!(await authorized())) {
    return { ok: false, error: "not-allowed" };
  }
  const repository = getRepository();
  if (!repository) {
    return { ok: false, error: "no-database" };
  }

  const kind = FINGERPRINT_KINDS.find((allowed) => allowed === input.kind);
  const strength = STRENGTHS.find((allowed) => allowed === input.strength) ?? "strong";
  const pattern = input.pattern.trim();
  const appId = input.appId.trim();

  if (kind === undefined) {
    return { ok: false, error: "unsupported-kind" };
  }
  if (pattern === "" || appId === "") {
    return { ok: false, error: "missing-field" };
  }

  await repository.upsertFingerprints([
    { id: `manual:${kind}:${pattern}`, kind, pattern, strength, source: "manual", appId },
  ]);
  await repository.publishSnapshot();
  revalidatePath("/admin/knowledge");
  return { ok: true };
}

export async function removeFingerprint(id: string): Promise<ActionResult> {
  if (!(await authorized())) {
    return { ok: false, error: "not-allowed" };
  }
  const repository = getRepository();
  if (!repository) {
    return { ok: false, error: "no-database" };
  }

  await repository.deleteFingerprint(id);
  await repository.publishSnapshot();
  revalidatePath("/admin/knowledge");
  return { ok: true };
}

export async function addNoiseRule(kind: string, pattern: string): Promise<ActionResult> {
  if (!(await authorized())) {
    return { ok: false, error: "not-allowed" };
  }
  const repository = getRepository();
  if (!repository) {
    return { ok: false, error: "no-database" };
  }

  const noiseKind = NOISE_KINDS.find((allowed) => allowed === kind);
  const value = pattern.trim();
  if (noiseKind === undefined || value === "") {
    return { ok: false, error: "missing-field" };
  }

  await repository.upsertNoiseRules([{ kind: noiseKind, pattern: value, reason: "added by hand" }]);
  await repository.publishSnapshot();
  revalidatePath("/admin/knowledge");
  return { ok: true };
}

export async function removeNoiseRule(kind: string, pattern: string): Promise<ActionResult> {
  if (!(await authorized())) {
    return { ok: false, error: "not-allowed" };
  }
  const repository = getRepository();
  if (!repository) {
    return { ok: false, error: "no-database" };
  }

  await repository.deleteNoiseRule(kind, pattern);
  await repository.publishSnapshot();
  revalidatePath("/admin/knowledge");
  return { ok: true };
}
