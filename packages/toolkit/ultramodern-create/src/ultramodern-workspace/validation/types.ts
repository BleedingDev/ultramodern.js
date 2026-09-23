import type { createWorkspaceValidationContract } from '../workspace-validation-contract';

export type JsonRecord = Record<string, any>;
export type Semver = { major: number; minor: number; patch: number };
export type WorkspaceValidationContract = ReturnType<
  typeof createWorkspaceValidationContract
>;
export type ValidationContract = WorkspaceValidationContract;
