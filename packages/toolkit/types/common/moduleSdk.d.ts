export type ModuleFamily =
  | 'crm'
  | 'project-management'
  | 'invoicing'
  | 'docs'
  | 'chat'
  | 'automation';

export type ModuleRuntimeLane =
  | 'effect-first'
  | 'tanstack-first'
  | 'hono-compat'
  | 'react-router-compat';

export type ModuleLifecycleHook =
  | 'registerRoutes'
  | 'registerCapabilities'
  | 'registerMigrations';

export type ModulePolicyHook =
  | 'authorize'
  | 'enforceTenantScope'
  | 'validateOperationContext';

export type ModuleObservabilityHook =
  | 'emitBusinessMetric'
  | 'emitAuditEvent'
  | 'emitTraceContext';

export type ModuleObservabilitySignal = 'metrics' | 'audit' | 'trace';

export interface ModuleComplianceFlags {
  usesSdkContracts: boolean;
  usesPolicyMiddleware: boolean;
  usesObservabilityHooks: boolean;
}

export interface ModuleSdkFamilyContract {
  family: ModuleFamily;
  requiredLifecycleHooks: ModuleLifecycleHook[];
  requiredPolicyHooks: ModulePolicyHook[];
  requiredObservabilityHooks: ModuleObservabilityHook[];
  forbiddenCodePatterns: string[];
}

export interface ModuleSdkContracts {
  schemaVersion: number;
  compatibilityLanes: ModuleRuntimeLane[];
  sharedRequirements: {
    requiredManifestFields: string[];
    requiredComplianceFlags: Array<keyof ModuleComplianceFlags>;
    requiredObservabilitySignals: ModuleObservabilitySignal[];
  };
  families: Record<ModuleFamily, Omit<ModuleSdkFamilyContract, 'family'>>;
}

export interface ModuleSdkManifest {
  moduleId: string;
  family: ModuleFamily;
  version: string;
  runtime: ModuleRuntimeLane;
  sourceDir: string;
  lifecycleHooks: ModuleLifecycleHook[];
  policyHooks: ModulePolicyHook[];
  observability: {
    signals: ModuleObservabilitySignal[];
    hooks: ModuleObservabilityHook[];
  };
  compliance: ModuleComplianceFlags;
}
