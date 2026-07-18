import { BrowserSmokeError } from './contract.mjs';
import { joinUrl, waitForTarget } from './http-validate.mjs';

async function fetchOk(url, fetchImpl, init) {
  try {
    const response = await fetchImpl(url, init);
    return { ok: response.ok, response };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  }
}

function boundaryStatus(html, appId, status) {
  return [...html.matchAll(/<[a-z][^>]*data-modern-distributed-ssr-[^>]+>/giu)]
    .map(match => match[0])
    .some(
      tag =>
        tag.includes(`data-modern-distributed-ssr-boundary="${appId}::`) &&
        tag.includes(`data-modern-distributed-ssr-status="${status}"`),
    );
}

async function validateNodeFailureIsolation({
  fetchImpl,
  options,
  servers,
  serversByAppId,
  shell,
  startServerImpl,
  verticals,
}) {
  const assertions = [];
  for (const [index, target] of verticals.entries()) {
    const unrelated = verticals[(index + 1) % verticals.length];
    const server = serversByAppId.get(target.app.id);
    if (!server) {
      throw new BrowserSmokeError(
        `Node failure isolation has no owned server for ${target.app.id}`,
      );
    }
    await server.stop();
    serversByAppId.delete(target.app.id);
    const serverIndex = servers.indexOf(server);
    if (serverIndex !== -1) {
      servers.splice(serverIndex, 1);
    }

    const unavailable = await fetchOk(
      joinUrl(target.baseUrl, target.routes.mfManifest),
      fetchImpl,
    );
    const shellDuringFailure = await fetchOk(
      joinUrl(shell.baseUrl, shell.routes.ssr),
      fetchImpl,
    );
    const unrelatedDuringFailure = await fetchOk(
      joinUrl(
        unrelated.baseUrl,
        unrelated.routes.effectReadiness ?? unrelated.routes.ssr,
      ),
      fetchImpl,
    );

    const restarted = startServerImpl(target, options);
    servers.push(restarted);
    serversByAppId.set(target.app.id, restarted);
    await waitForTarget(target, {
      fetchImpl,
      requireManifest: true,
      retryDelayMs: options.retryDelayMs,
      serverExit: restarted.exited,
      serverLogPath: restarted.logPath,
      timeoutMs: options.timeoutMs,
    });
    const recovered = await fetchOk(
      joinUrl(target.baseUrl, target.routes.mfManifest),
      fetchImpl,
    );
    const shellAfterRecovery = await fetchOk(
      joinUrl(shell.baseUrl, shell.routes.ssr),
      fetchImpl,
    );
    assertions.push({
      appId: target.app.id,
      outageError: unavailable.error,
      shellHealthyDuringFailure: shellDuringFailure.ok,
      unrelatedAppId: unrelated.app.id,
      unrelatedHealthyDuringFailure: unrelatedDuringFailure.ok,
      recovered: recovered.ok,
      shellHealthyAfterRecovery: shellAfterRecovery.ok,
      status:
        !unavailable.ok &&
        shellDuringFailure.ok &&
        unrelatedDuringFailure.ok &&
        recovered.ok &&
        shellAfterRecovery.ok
          ? 'pass'
          : 'fail',
      type: 'failure-isolation',
    });
  }
  return assertions;
}

async function setWorkerdBindingFailure(shell, appId, failed, fetchImpl) {
  const response = await fetchImpl(
    joinUrl(shell.baseUrl, '/_ultramodern-proof/service-binding-fault'),
    {
      body: JSON.stringify({ appId, failed }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
  );
  if (!response.ok) {
    throw new BrowserSmokeError(
      `workerd failure control returned HTTP ${response.status} for ${appId}`,
    );
  }
}

async function validateWorkerdFailureIsolation({
  fetchImpl,
  shell,
  verticals,
}) {
  const assertions = [];
  for (const [index, target] of verticals.entries()) {
    const unrelated = verticals[(index + 1) % verticals.length];
    await setWorkerdBindingFailure(shell, target.app.id, true, fetchImpl);
    let failureHtml = '';
    let shellDuringFailure;
    let unrelatedDuringFailure;
    try {
      shellDuringFailure = await fetchOk(
        joinUrl(shell.baseUrl, shell.routes.distributedSsr ?? shell.routes.ssr),
        fetchImpl,
      );
      if (shellDuringFailure.response) {
        failureHtml = await shellDuringFailure.response.text();
      }
      unrelatedDuringFailure = await fetchOk(
        joinUrl(
          unrelated.baseUrl,
          unrelated.routes.effectReadiness ?? unrelated.routes.ssr,
        ),
        fetchImpl,
      );
    } finally {
      await setWorkerdBindingFailure(shell, target.app.id, false, fetchImpl);
    }

    const recoveredResponse = await fetchImpl(
      joinUrl(shell.baseUrl, shell.routes.distributedSsr ?? shell.routes.ssr),
    );
    const recoveredHtml = await recoveredResponse.text();
    const degradedTarget = boundaryStatus(
      failureHtml,
      target.app.id,
      'degraded',
    );
    const unrelatedReady = boundaryStatus(
      failureHtml,
      unrelated.app.id,
      'ready',
    );
    const recovered = boundaryStatus(recoveredHtml, target.app.id, 'ready');
    assertions.push({
      appId: target.app.id,
      degradedTarget,
      recovered,
      shellHealthyDuringFailure: shellDuringFailure?.ok === true,
      unrelatedAppId: unrelated.app.id,
      unrelatedBoundaryReady: unrelatedReady,
      unrelatedHealthyDuringFailure: unrelatedDuringFailure?.ok === true,
      status:
        shellDuringFailure?.ok === true &&
        degradedTarget &&
        unrelatedReady &&
        unrelatedDuringFailure?.ok === true &&
        recoveredResponse.ok &&
        recovered
          ? 'pass'
          : 'fail',
      type: 'failure-isolation',
    });
  }
  return assertions;
}

async function validateFailureIsolation({
  fetchImpl = fetch,
  options,
  platform,
  servers,
  serversByAppId,
  startServerImpl,
  targets,
}) {
  const shell = targets.find(target => target.app.kind === 'shell');
  const verticals = targets.filter(target => target.app.kind === 'vertical');
  if (!shell || verticals.length < 2) {
    throw new BrowserSmokeError(
      'failure isolation requires one shell and at least two MicroVerticals',
    );
  }
  return platform === 'workerd'
    ? validateWorkerdFailureIsolation({ fetchImpl, shell, verticals })
    : validateNodeFailureIsolation({
        fetchImpl,
        options,
        servers,
        serversByAppId,
        shell,
        startServerImpl,
        verticals,
      });
}

export { boundaryStatus, validateFailureIsolation };
