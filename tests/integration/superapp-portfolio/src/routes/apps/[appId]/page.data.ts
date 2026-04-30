import { createInitialPortfolioState } from '../../../../shared/portfolio-state.js';

export const loader = ({ params }: { params: Record<string, string> }) => {
  const app = createInitialPortfolioState().apps.find(
    item => item.id === params.appId,
  );
  return {
    appId: params.appId,
    routeKind: app?.kind ?? 'unknown',
    expectedCapabilities: app?.capabilities.length ?? 0,
  };
};
