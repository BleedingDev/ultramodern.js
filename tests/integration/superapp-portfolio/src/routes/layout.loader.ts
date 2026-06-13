import {
  createInitialPortfolioState,
  summarizePortfolio,
} from '../../shared/portfolio-state';

export default () => {
  const state = createInitialPortfolioState();
  return {
    shellMode: 'tanstack-effect-superapp-portfolio',
    summary: summarizePortfolio(state),
  };
};
