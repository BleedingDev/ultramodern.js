import type { CLIPluginAPI } from '@modern-js/plugin';
import type { Command } from '@modern-js/utils';
import type { AppTools } from '../types';
import type {
  RuntimeFallbackSignalOptions,
  RuntimeStatusOptions,
} from '../utils/types';

const DEFAULT_RUNTIME_HOST = 'http://127.0.0.1:8080';
const DEFAULT_RUNTIME_STATUS_PATH = '/_modern/runtime/status';
const DEFAULT_RUNTIME_FALLBACK_SIGNAL_PATH =
  '/_modern/contract-gates/runtime-fallback';
const DEFAULT_RUNTIME_TOKEN_HEADER = 'x-modernjs-runtime-signal-token';
const DEFAULT_TIMEOUT_MS = 5_000;

export const resolveRuntimeEndpoint = (
  input: string | undefined,
  defaultPath: string,
) => {
  const rawInput = input?.trim();
  if (!rawInput) {
    return `${DEFAULT_RUNTIME_HOST}${defaultPath}`;
  }
  if (rawInput.startsWith('http://') || rawInput.startsWith('https://')) {
    return rawInput;
  }
  const normalized = rawInput.startsWith('/') ? rawInput : `/${rawInput}`;
  return `${DEFAULT_RUNTIME_HOST}${normalized}`;
};

export const resolveToken = ({
  token,
  tokenEnv,
}: {
  token?: string;
  tokenEnv?: string;
}) => {
  if (typeof token === 'string' && token.trim().length > 0) {
    return token.trim();
  }
  if (typeof tokenEnv === 'string' && tokenEnv.trim().length > 0) {
    const value = process.env[tokenEnv.trim()];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
};

const parseTimeoutMs = (value: string | undefined) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return parsed;
};

const parseMetadata = (metadata: string | undefined) => {
  if (typeof metadata !== 'string' || metadata.trim().length === 0) {
    return undefined;
  }
  const parsed = JSON.parse(metadata);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('metadata must be a JSON object');
  }
  return parsed as Record<string, unknown>;
};

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const parseResponseBody = async (response: Response) => {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (_error) {
    return {
      raw: text,
    };
  }
};

const printOutput = (payload: unknown, jsonOnly?: boolean) => {
  if (jsonOnly) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(JSON.stringify(payload, null, 2));
};

export const createRuntimeFallbackSignalPayload = (
  options: RuntimeFallbackSignalOptions,
) => {
  const payload: Record<string, unknown> = {
    appName: options.app,
    reason: options.reason || 'runtime_fallback',
    phase: options.phase || 'load',
  };

  if (options.entry) {
    payload.entry = options.entry;
  }
  if (options.runtimeDigest) {
    payload.runtimeDigest = options.runtimeDigest;
  }

  const metadata = parseMetadata(options.metadata);
  if (metadata) {
    payload.metadata = metadata;
  }

  return payload;
};

export const runtimeCommand = async (
  program: Command,
  _api: CLIPluginAPI<AppTools>,
) => {
  const runtime = program.command('runtime').description('runtime operations');

  runtime
    .command('status')
    .description('read runtime status snapshot')
    .option('--endpoint <endpoint>', 'runtime status endpoint URL or path')
    .option('--token <token>', 'runtime status auth token')
    .option(
      '--token-env <name>',
      'environment variable name that stores runtime status auth token',
      'MODERN_RUNTIME_SIGNAL_TOKEN',
    )
    .option(
      '--header-name <name>',
      'auth header name',
      DEFAULT_RUNTIME_TOKEN_HEADER,
    )
    .option('--timeout <ms>', 'request timeout in milliseconds', '5000')
    .option('--json', 'output as JSON format for machine reading')
    .action(async (options: RuntimeStatusOptions) => {
      const endpoint = resolveRuntimeEndpoint(
        options.endpoint,
        DEFAULT_RUNTIME_STATUS_PATH,
      );
      const timeoutMs = parseTimeoutMs(options.timeout);
      const token = resolveToken({
        token: options.token,
        tokenEnv: options.tokenEnv,
      });
      const headerName =
        options.headerName?.trim() || DEFAULT_RUNTIME_TOKEN_HEADER;
      const headers = new Headers();
      if (token) {
        headers.set(headerName, token);
      }

      const response = await fetchWithTimeout(
        endpoint,
        {
          method: 'GET',
          headers,
        },
        timeoutMs,
      );
      const payload = await parseResponseBody(response);
      if (!response.ok) {
        throw new Error(
          `runtime status request failed with ${response.status}: ${JSON.stringify(payload)}`,
        );
      }
      printOutput(payload, options.json);
    });

  runtime
    .command('fallback-signal')
    .description('emit runtime fallback signal for canary gate mutation')
    .requiredOption('--app <appName>', 'remote app name')
    .option(
      '--endpoint <endpoint>',
      'runtime fallback signal endpoint URL or path',
    )
    .option('--reason <reason>', 'fallback reason', 'runtime_fallback')
    .option('--phase <phase>', 'fallback phase', 'load')
    .option('--entry <entry>', 'remote entry URL')
    .option('--runtime-digest <digest>', 'runtime digest value')
    .option('--metadata <json>', 'metadata JSON object string')
    .option('--token <token>', 'runtime signal auth token')
    .option(
      '--token-env <name>',
      'environment variable name that stores runtime signal auth token',
      'MODERN_RUNTIME_SIGNAL_TOKEN',
    )
    .option(
      '--header-name <name>',
      'auth header name',
      DEFAULT_RUNTIME_TOKEN_HEADER,
    )
    .option('--timeout <ms>', 'request timeout in milliseconds', '5000')
    .option('--json', 'output as JSON format for machine reading')
    .action(async (options: RuntimeFallbackSignalOptions) => {
      const endpoint = resolveRuntimeEndpoint(
        options.endpoint,
        DEFAULT_RUNTIME_FALLBACK_SIGNAL_PATH,
      );
      const timeoutMs = parseTimeoutMs(options.timeout);
      const token = resolveToken({
        token: options.token,
        tokenEnv: options.tokenEnv,
      });
      const headerName =
        options.headerName?.trim() || DEFAULT_RUNTIME_TOKEN_HEADER;
      const payload = createRuntimeFallbackSignalPayload(options);
      const headers = new Headers({
        'content-type': 'application/json',
      });
      if (token) {
        headers.set(headerName, token);
      }
      const response = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        },
        timeoutMs,
      );
      const responsePayload = await parseResponseBody(response);
      if (!response.ok) {
        throw new Error(
          `runtime fallback signal request failed with ${response.status}: ${JSON.stringify(responsePayload)}`,
        );
      }
      printOutput(responsePayload, options.json);
    });
};
