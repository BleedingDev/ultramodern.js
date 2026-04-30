import {
  createInitialPortfolioState,
  summarizePortfolio,
} from '../../shared/portfolio-state.js';

export default () => {
  const state = createInitialPortfolioState();
  return {
    shellMode: 'tanstack-effect-superapp-portfolio',
    summary: summarizePortfolio(state),
  };
};
