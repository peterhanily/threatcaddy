/** JSON request bodies must be objects before fields are read. */
export function isRequestObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface ValidationIssue {
  path: readonly PropertyKey[];
  message: string;
}

/** Preserve the flat API error shape without serializing every validation issue. */
export function boundedValidationDetails(issues: readonly ValidationIssue[]) {
  const formErrors: string[] = [];
  const fieldErrors: Record<string, string[]> = Object.create(null);
  for (const issue of issues.slice(0, 20)) {
    const message = issue.message.slice(0, 200);
    if (!issue.path.length) formErrors.push(message);
    else {
      const field = String(issue.path[0]).slice(0, 80);
      (fieldErrors[field] ??= []).push(message);
    }
  }
  return { formErrors, fieldErrors };
}
