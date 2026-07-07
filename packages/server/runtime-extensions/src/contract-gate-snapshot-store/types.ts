export const CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION = 1;

export const DEFAULT_CONTRACT_GATE_SNAPSHOT_PATH =
  '.modern/contract-gates.json';

export type GateSnapshotGateValue =
  | boolean
  | {
      passed?: boolean;
      reason?: string;
      updatedAt?: number;
      expiresAt?: number;
      [key: string]: unknown;
    };

export type GateSnapshot = {
  schemaVersion?: number;
  updatedAt?: number;
  gates?: Record<string, GateSnapshotGateValue>;
};

export type LoggerLike = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type ContractGateSnapshotStore = {
  name: string;
  readSnapshot: () => Promise<GateSnapshot | undefined>;
  writeSnapshot: (snapshot: GateSnapshot) => Promise<void>;
};

export type ContractGateSnapshotStoreFactoryContext = {
  appDirectory: string;
  gateSnapshotPath: string;
  options?: Record<string, unknown>;
  logger?: LoggerLike;
};

export type ContractGateSnapshotStoreFactory = (
  context: ContractGateSnapshotStoreFactoryContext,
) => Promise<ContractGateSnapshotStore> | ContractGateSnapshotStore;

export type ContractGateSnapshotStoreModule = {
  createContractGateSnapshotStore?: ContractGateSnapshotStoreFactory;
  default?:
    | ContractGateSnapshotStoreFactory
    | {
        createContractGateSnapshotStore?: ContractGateSnapshotStoreFactory;
      };
};

export type ContractGateSnapshotStoreUserConfig = {
  module: string;
  options?: Record<string, unknown>;
};

export type ContractGateSnapshotHttpStoreOptions = {
  endpoint: string;
  readMethod?: string;
  writeMethod?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
};
