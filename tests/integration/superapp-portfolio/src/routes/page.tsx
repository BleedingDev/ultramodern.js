// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off
import effectBff from '@api/effect/index';
import { useMatch } from '@modern-js/plugin-tanstack/runtime';
import { useEffect, useState } from 'react';
import type {
  PilotChaosMode,
  PilotModuleId,
  PilotRun,
  PilotScenario,
  PilotScenarioPlan,
  PortfolioApp,
} from '../../shared/portfolio-state.js';

type BootstrapData = Awaited<
  ReturnType<typeof effectBff.client.portfolio.bootstrap>
>;

const pilotChaosModes: PilotChaosMode[] = [
  'none',
  'remote-down',
  'api-timeout',
  'chunk-404',
  'clock-skew',
  'restart-during-load',
];

const pilotModules: PilotModuleId[] = [
  'rides',
  'dispatch',
  'orders',
  'erp',
  'chat',
  'mf-remotes',
  'security',
  'billing',
];

export default function PortfolioPage() {
  const match = useMatch({ from: '/' });
  const loaderData = match.loaderData!;
  const [data, setData] = useState<BootstrapData | null>(null);
  const [scenario, setScenario] = useState<PilotScenario>('grab-marketplace');
  const [chaos, setChaos] = useState<PilotChaosMode>('none');
  const [modules, setModules] = useState<PilotModuleId[]>(pilotModules);
  const [pilotRun, setPilotRun] = useState<PilotRun | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const scenarioPlans = (data?.pilotScenarios ?? []) as PilotScenarioPlan[];
  const selectedPlan =
    scenarioPlans.find(item => item.scenario === scenario) ?? scenarioPlans[0];
  const activeChaosModes = selectedPlan?.chaosModes ?? pilotChaosModes;

  useEffect(() => {
    refreshPortfolio();
  }, []);

  const refreshPortfolio = async () => {
    const nextData = await effectBff.client.portfolio.bootstrap({});
    setData(nextData);
    const runs = nextData.pilotRuns as PilotRun[];
    setPilotRun(runs[runs.length - 1] ?? null);
  };

  const toggleModule = (module: PilotModuleId) => {
    setModules(current =>
      current.includes(module)
        ? current.filter(item => item !== module)
        : [...current, module],
    );
  };

  const selectScenario = (nextScenario: PilotScenario) => {
    const nextPlan = scenarioPlans.find(item => item.scenario === nextScenario);
    setScenario(nextScenario);
    if (nextPlan) {
      setModules(nextPlan.modules);
      if (!nextPlan.chaosModes.includes(chaos)) {
        setChaos(nextPlan.chaosModes[0] ?? 'none');
      }
    }
  };

  const resetPilot = async () => {
    setIsRunning(true);
    try {
      await effectBff.client.portfolio.reset({});
      await refreshPortfolio();
    } finally {
      setIsRunning(false);
    }
  };

  const runPilot = async () => {
    setIsRunning(true);
    try {
      const result = await effectBff.client.portfolio.runPilot({
        params: {
          scenario,
        },
        payload: {
          tenant: 'superapp-global',
          actor: 'browser.pilot',
          requestId: `ui-${scenario}-${chaos}`,
          modules,
          chaos,
        },
      });
      setPilotRun(result.run as PilotRun);
      await refreshPortfolio();
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <section data-testid="portfolio-page">
      <div className="panel">
        <h1>Validation Portfolio</h1>
        <div data-testid="route-kind">{loaderData.routeKind}</div>
      </div>

      {data ? (
        <>
          <div
            className="pilot-command-center"
            data-testid="pilot-command-center"
          >
            <section className="panel">
              <h2>Pilot SuperApp</h2>
              <div className="pilot-controls">
                <label>
                  Scenario
                  <select
                    data-testid="pilot-scenario"
                    value={scenario}
                    onChange={event =>
                      selectScenario(event.target.value as PilotScenario)
                    }
                  >
                    {scenarioPlans.map(item => (
                      <option key={item.scenario} value={item.scenario}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Chaos
                  <select
                    data-testid="pilot-chaos"
                    value={chaos}
                    onChange={event =>
                      setChaos(event.target.value as PilotChaosMode)
                    }
                  >
                    {activeChaosModes.map(item => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {selectedPlan ? (
                <div
                  className="scenario-playbook"
                  data-testid="pilot-scenario-plan"
                >
                  <strong>{selectedPlan.label}</strong>
                  <span>tenant:{selectedPlan.tenant}</span>
                  <span>region:{selectedPlan.region}</span>
                  <span>
                    routes:{selectedPlan.routeTransitions.join(' -> ')}
                  </span>
                  <span>workflows:{selectedPlan.workflows.length}</span>
                  <span>invariants:{selectedPlan.invariants.length}</span>
                </div>
              ) : null}
              <div className="module-grid" data-testid="pilot-modules">
                {pilotModules.map(module => (
                  <label key={module}>
                    <input
                      checked={modules.includes(module)}
                      type="checkbox"
                      onChange={() => toggleModule(module)}
                    />
                    {module}
                  </label>
                ))}
              </div>
              <div className="pilot-actions">
                <button
                  data-testid="run-pilot"
                  disabled={isRunning || modules.length === 0}
                  type="button"
                  onClick={runPilot}
                >
                  Run pilot
                </button>
                <button
                  data-testid="reset-pilot"
                  disabled={isRunning}
                  type="button"
                  onClick={resetPilot}
                >
                  Reset
                </button>
              </div>
            </section>
            <section className="panel pilot-result" data-testid="pilot-result">
              <h2>Result</h2>
              <div data-testid="pilot-status">
                {pilotRun
                  ? `${pilotRun.scenarioLabel}:${pilotRun.status}:${pilotRun.chaos}`
                  : 'idle'}
              </div>
              <div data-testid="pilot-summary">
                events:{data.summary.eventCount};degraded:
                {pilotRun?.summary.degradedModules ?? 0};fallbacks:
                {pilotRun?.summary.remoteFallbacks ?? 0};security:
                {pilotRun?.summary.securityChecks ?? 0}
              </div>
              <div data-testid="pilot-production-checks">
                checks:{pilotRun?.productionChecks.length ?? 0}
              </div>
              <div
                className="module-results"
                data-testid="pilot-module-results"
              >
                {(pilotRun?.moduleResults ?? []).map(result => (
                  <div
                    key={result.module}
                    className={result.ok ? 'module-ok' : 'module-failed'}
                    data-testid={`pilot-module-${result.module}`}
                  >
                    <strong>{result.module}</strong>
                    <span>{result.appId}</span>
                    <span>
                      {result.ok ? 'ok' : 'failed'}:
                      {result.degraded ? 'degraded' : 'nominal'}
                    </span>
                    <span>{result.invariant}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <div className="grid" data-testid="portfolio-ready">
            {(data.apps as PortfolioApp[]).map(app => (
              <article
                key={app.id}
                className={`app-card ${app.risk}`}
                data-testid={`portfolio-app-${app.id}`}
              >
                <strong>{app.label}</strong>
                <span>{app.kind}</span>
                <span>routes:{app.routes.length}</span>
                <span>smoke:{app.profiles.smoke.workflows.length}</span>
                <span>stress:{app.profiles.stress.workflows.length}</span>
                <span>nightly:{app.profiles.nightly.workflows.length}</span>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div data-testid="portfolio-loading">loading</div>
      )}
    </section>
  );
}
