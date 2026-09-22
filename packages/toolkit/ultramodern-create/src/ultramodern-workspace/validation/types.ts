import type { createWorkspaceValidationContract } from '../workspace-validation-contract';

// Consumer JSON is checked at runtime before individual policy fields are used.
export type JsonRecord = Record<string, any>;
export type Vertical =
  WorkspaceValidationContract['fullStackVerticals'][number];
export type Semver = { major: number; minor: number; patch: number };
export type WorkspaceValidationContract = ReturnType<
  typeof createWorkspaceValidationContract
>;

export type ValidationContract = Omit<
  WorkspaceValidationContract,
  'topology' | 'additionalShells'
> & {
  topology: Omit<
    WorkspaceValidationContract['topology'],
    'compactConfig' | 'referenceTopology'
  > & {
    compactConfig: { apps: JsonRecord[] };
    referenceTopology: JsonRecord;
  };
  additionalShells?: Array<
    Omit<
      NonNullable<WorkspaceValidationContract['additionalShells']>[number],
      'deliveryUnit'
    > & { deliveryUnit: JsonRecord }
  >;
};
