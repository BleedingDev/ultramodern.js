import {
  createInitialSuperAppState,
  summarizeSuperApp,
} from '../../shared/superapp-state.js';

export default () => {
  const state = createInitialSuperAppState();
  return {
    tenantName: state.tenant.name,
    region: state.tenant.region,
    shellMode: 'tanstack-effect-superapp',
    summary: summarizeSuperApp(state),
  };
};
