"use server";

import { ignoreCandidate, promoteCandidate } from "@salla-app-detector/jobs";
import { revalidatePath } from "next/cache";
import { getRepository } from "@/lib/database";
import { isAdminEmail } from "@/lib/supabase/config";
import { currentUserEmail } from "@/lib/supabase/server";

export type Decision = "promote" | "ignore";

/**
 * Turns a reviewed candidate into knowledge. Promoting writes a fingerprint that scans
 * start using immediately, which is why the allowlist is checked here as well as on the
 * page: a server action is an endpoint of its own.
 */
export async function decideCandidate(
  signalKind: string,
  signalValue: string,
  decision: Decision,
  appId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isAdminEmail(await currentUserEmail())) {
    return { ok: false, error: "not-allowed" };
  }

  const repository = getRepository();
  if (!repository) {
    return { ok: false, error: "no-database" };
  }

  if (decision === "ignore") {
    await ignoreCandidate(repository, signalKind, signalValue);
    revalidatePath("/admin");
    return { ok: true };
  }

  const result = await promoteCandidate(repository, { signalKind, signalValue, appId });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath("/admin");
  return { ok: true };
}
