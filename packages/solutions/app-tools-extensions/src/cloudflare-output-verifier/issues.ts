export type CloudflareOutputVerifierIssueCode =
  | 'missing-file'
  | 'invalid-manifest'
  | 'invalid-wrangler'
  | 'invalid-package'
  | 'public-output-leak'
  | 'missing-worker-bundle'
  | 'invalid-worker-bundle'
  | 'worker-import-failed'
  | 'delivery-unit-drift'
  | 'missing-delivery-unit'
  | 'forbidden-mutation-pattern';

export interface CloudflareOutputVerifierIssue {
  code: CloudflareOutputVerifierIssueCode;
  message: string;
  path?: string;
}

export interface CloudflareOutputVerifierResult {
  ok: boolean;
  issues: CloudflareOutputVerifierIssue[];
}

export type JsonObject = Record<string, any>;

export const addIssue = (
  issues: CloudflareOutputVerifierIssue[],
  issue: CloudflareOutputVerifierIssue,
) => {
  issues.push(issue);
};

export const assertEqual = (
  issues: CloudflareOutputVerifierIssue[],
  actual: unknown,
  expected: unknown,
  issue: CloudflareOutputVerifierIssue,
) => {
  if (actual !== expected) {
    addIssue(issues, issue);
  }
};

export const assertFlag = (
  issues: CloudflareOutputVerifierIssue[],
  flags: unknown,
  flag: string,
  issue: CloudflareOutputVerifierIssue,
) => {
  if (!Array.isArray(flags) || !flags.includes(flag)) {
    addIssue(issues, issue);
  }
};
