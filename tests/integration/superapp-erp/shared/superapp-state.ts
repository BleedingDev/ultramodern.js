export type SuperAppModuleId =
  | 'dispatch'
  | 'finance'
  | 'inventory'
  | 'hr'
  | 'chat';

export type SuperAppModule = {
  id: SuperAppModuleId;
  label: string;
  status: 'healthy' | 'degraded';
  openWork: number;
};

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type Approval = {
  id: string;
  title: string;
  amount: number;
  status: ApprovalStatus;
  owner: string;
};

export type ChatMessage = {
  id: string;
  channel: string;
  author: string;
  text: string;
  priority: 'normal' | 'urgent';
};

export type SuperAppState = {
  tenant: {
    id: string;
    name: string;
    region: string;
  };
  modules: SuperAppModule[];
  approvals: Approval[];
  chat: ChatMessage[];
  riskSignals: {
    dispatchBacklog: number;
    financeExposure: number;
    inventoryStockouts: number;
  };
};

export function createInitialSuperAppState(): SuperAppState {
  return {
    tenant: {
      id: 'tenant-acme-global',
      name: 'Acme Global Operations',
      region: 'EMEA',
    },
    modules: [
      {
        id: 'dispatch',
        label: 'Fleet dispatch',
        status: 'healthy',
        openWork: 18,
      },
      {
        id: 'finance',
        label: 'Finance control',
        status: 'degraded',
        openWork: 7,
      },
      {
        id: 'inventory',
        label: 'Inventory planning',
        status: 'healthy',
        openWork: 11,
      },
      {
        id: 'hr',
        label: 'People operations',
        status: 'healthy',
        openWork: 4,
      },
      {
        id: 'chat',
        label: 'Operations chat',
        status: 'healthy',
        openWork: 3,
      },
    ],
    approvals: [
      {
        id: 'ap-1001',
        title: 'Emergency carrier capacity',
        amount: 42000,
        status: 'pending',
        owner: 'finance.lead',
      },
      {
        id: 'ap-1002',
        title: 'Warehouse overtime batch',
        amount: 12800,
        status: 'pending',
        owner: 'ops.manager',
      },
    ],
    chat: [
      {
        id: 'msg-1',
        channel: 'incident-war-room',
        author: 'system',
        text: 'Route disruption detected in Prague hub',
        priority: 'urgent',
      },
      {
        id: 'msg-2',
        channel: 'incident-war-room',
        author: 'dispatcher',
        text: 'Rebalancing drivers from zone 7',
        priority: 'normal',
      },
    ],
    riskSignals: {
      dispatchBacklog: 18,
      financeExposure: 54800,
      inventoryStockouts: 2,
    },
  };
}

export function summarizeSuperApp(state: SuperAppState) {
  const pendingApprovals = state.approvals.filter(
    approval => approval.status === 'pending',
  ).length;
  const urgentMessages = state.chat.filter(
    message => message.priority === 'urgent',
  ).length;

  return {
    tenantName: state.tenant.name,
    moduleCount: state.modules.length,
    pendingApprovals,
    urgentMessages,
    totalOpenWork: state.modules.reduce((sum, item) => sum + item.openWork, 0),
    financeExposure: state.riskSignals.financeExposure,
  };
}
