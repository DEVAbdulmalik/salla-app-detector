import type { ApiFailure } from "@salla-app-detector/salla";

/** `failed:http:403` rather than `failed:http`: the status is usually the whole story. */
export function failureStatus(failure: ApiFailure): string {
  return "status" in failure
    ? `failed:${failure.code}:${String(failure.status)}`
    : `failed:${failure.code}`;
}
