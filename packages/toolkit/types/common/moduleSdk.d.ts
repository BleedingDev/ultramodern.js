export type ModuleRuntimeLane =
  | 'effect-first'
  | 'tanstack-first'
  | 'hono-compat'
  | 'react-router-compat';

export type ModuleLifecycleHook =
  | 'registerRoutes'
  | 'registerCapabilities'
  | 'registerMigrations'
  | 'registerEventContracts';

export type ModulePolicyHook =
  | 'authorize'
  | 'enforceTenantScope'
  | 'validateOperationContext'
  | 'validateEventEnvelope';

export type ModuleObservabilityHook =
  | 'emitBusinessMetric'
  | 'emitAuditEvent'
  | 'emitTraceContext'
  | 'emitEventContractViolation';

export type ModuleObservabilitySignal = 'metrics' | 'audit' | 'trace';
export type ModuleComplianceFlagName =
  | keyof ModuleComplianceFlags
  | (string & {});
export type ModuleLifecycleHookName = ModuleLifecycleHook | (string & {});
export type ModulePolicyHookName = ModulePolicyHook | (string & {});
export type ModuleObservabilityHookName =
  | ModuleObservabilityHook
  | (string & {});
export type ModuleObservabilitySignalName =
  | ModuleObservabilitySignal
  | (string & {});

export interface ModuleComplianceFlags {
  usesSdkContracts: boolean;
  usesPolicyMiddleware: boolean;
  usesObservabilityHooks: boolean;
}

export interface ModuleSdkSharedRequirements {
  requiredManifestFields: string[];
  requiredComplianceFlags: ModuleComplianceFlagName[];
  requiredObservabilitySignals: ModuleObservabilitySignalName[];
  requiredLifecycleHooks: ModuleLifecycleHookName[];
  requiredPolicyHooks: ModulePolicyHookName[];
  requiredObservabilityHooks: ModuleObservabilityHookName[];
  forbiddenCodePatterns: string[];
}

export interface ModuleSdkProfileContract {
  requiredManifestFields?: string[];
  requiredComplianceFlags?: ModuleComplianceFlagName[];
  requiredObservabilitySignals?: ModuleObservabilitySignalName[];
  requiredLifecycleHooks?: ModuleLifecycleHookName[];
  requiredPolicyHooks?: ModulePolicyHookName[];
  requiredObservabilityHooks?: ModuleObservabilityHookName[];
  forbiddenCodePatterns?: string[];
}

export interface ModuleSdkContracts {
  schemaVersion: number;
  compatibilityLanes: ModuleRuntimeLane[];
  sharedRequirements: ModuleSdkSharedRequirements;
  profiles?: Record<string, ModuleSdkProfileContract>;
}

export interface ModuleSdkManifest {
  moduleId: string;
  profile?: string;
  version: string;
  runtime: ModuleRuntimeLane;
  sourceDir: string;
  lifecycleHooks: ModuleLifecycleHookName[];
  policyHooks: ModulePolicyHookName[];
  observability: {
    signals: ModuleObservabilitySignalName[];
    hooks: ModuleObservabilityHookName[];
  };
  compliance: ModuleComplianceFlags & Record<string, boolean>;
}

export interface ModuleEventContract {
  name: string;
  version: number;
  schemaHash: string;
  producerModuleId: string;
  description?: string;
}

export interface ModuleEventEnvelope<Payload = unknown> {
  name: string;
  version: number;
  schemaHash: string;
  timestamp: number;
  payload: Payload;
  meta?: Record<string, unknown>;
}
