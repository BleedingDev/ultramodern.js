import type { CloudflareWorkerSecurityConfig } from '../config';
import type { CloudflareModernConfig } from './types';

const DEFAULT_SECURITY_HEADERS = {
  referrerPolicy: 'strict-origin-when-cross-origin',
  contentTypeOptions: 'nosniff',
  permissionsPolicy:
    'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
} as const;
const DEFAULT_CORS_ALLOWED_METHODS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
];
const DEFAULT_CSP_DIRECTIVES: Record<string, string[]> = {
  'base-uri': [`'self'`],
  'connect-src': [`'self'`, 'https:', 'http:', 'wss:', 'ws:'],
  'default-src': [`'self'`],
  'font-src': [`'self'`, 'data:', 'https:', 'http:'],
  'form-action': [`'self'`],
  'frame-ancestors': [`'self'`],
  'img-src': [`'self'`, 'data:', 'blob:', 'https:', 'http:'],
  'manifest-src': [`'self'`, 'https:', 'http:'],
  'object-src': [`'none'`],
  'script-src': [
    `'self'`,
    `'unsafe-inline'`,
    `'unsafe-eval'`,
    'https:',
    'http:',
    'blob:',
  ],
  'style-src': [`'self'`, `'unsafe-inline'`, 'https:', 'http:'],
  'worker-src': [`'self'`, 'blob:'],
};

const normalizeDirectiveValues = (value: string[] | string) => {
  const values = Array.isArray(value) ? value : [value];

  return [...new Set(values.map(entry => entry.trim()).filter(Boolean))];
};

const appendDirectiveValues = (
  directives: Record<string, string[]>,
  name: string,
  values: string[] | undefined,
) => {
  if (!values?.length) {
    return;
  }

  directives[name] = normalizeDirectiveValues([
    ...(directives[name] ?? []),
    ...values,
  ]);
};

const createContentSecurityPolicy = (
  config?: CloudflareWorkerSecurityConfig['contentSecurityPolicy'],
) => {
  const mode = config?.mode ?? 'report-only';

  if (mode === 'off') {
    return {
      mode,
      directives: {},
      reason: config?.reason,
    };
  }

  const directives = Object.fromEntries(
    Object.entries(DEFAULT_CSP_DIRECTIVES).map(([name, values]) => [
      name,
      [...values],
    ]),
  );

  for (const [name, value] of Object.entries(config?.directives ?? {})) {
    if (value === false) {
      delete directives[name];
    } else {
      directives[name] = normalizeDirectiveValues(value);
    }
  }

  if (config?.frameAncestors === false) {
    delete directives['frame-ancestors'];
  } else if (config?.frameAncestors) {
    directives['frame-ancestors'] = normalizeDirectiveValues(
      config.frameAncestors,
    );
  }

  appendDirectiveValues(directives, 'script-src', config?.additionalScriptSrc);
  appendDirectiveValues(directives, 'style-src', config?.additionalStyleSrc);
  appendDirectiveValues(
    directives,
    'connect-src',
    config?.additionalConnectSrc,
  );
  appendDirectiveValues(directives, 'img-src', config?.additionalImgSrc);

  if (config?.reportUri) {
    directives['report-uri'] = [config.reportUri];
  }

  return {
    mode,
    directives,
    reason: config?.reason,
  };
};

const createNoindexPolicy = (
  noindex: CloudflareWorkerSecurityConfig['noindex'],
) => {
  if (noindex === false) {
    return {
      workersDev: false,
      localhost: false,
      previewHostnames: [],
    };
  }

  if (noindex === true || noindex === undefined) {
    return {
      workersDev: true,
      localhost: true,
      previewHostnames: [],
    };
  }

  return {
    workersDev: noindex.workersDev ?? true,
    localhost: noindex.localhost ?? true,
    previewHostnames: noindex.previewHostnames ?? [],
    reason: noindex.reason,
  };
};

const createCloudflareWorkerCorsPolicy = (
  cors: CloudflareWorkerSecurityConfig['cors'],
) => ({
  assets: cors?.assets ?? true,
  allowedOrigins: normalizeDirectiveValues(cors?.allowedOrigins ?? []),
  allowedMethods: cors?.allowedMethods?.length
    ? normalizeDirectiveValues(
        cors.allowedMethods.map(method => method.toUpperCase()),
      )
    : DEFAULT_CORS_ALLOWED_METHODS,
  allowedHeaders: cors?.allowedHeaders?.length
    ? normalizeDirectiveValues(cors.allowedHeaders)
    : ['*'],
  reason: cors?.reason,
});

export const createCloudflareWorkerSecurityPolicy = (
  modernConfig: CloudflareModernConfig,
) => {
  const security = modernConfig.deploy?.worker?.security;

  if (security?.enabled === false) {
    return {
      enabled: false,
      cors: createCloudflareWorkerCorsPolicy(security.cors),
      reason: security.reason,
    };
  }

  return {
    enabled: true,
    headers: {
      referrerPolicy:
        security?.headers?.referrerPolicy ??
        DEFAULT_SECURITY_HEADERS.referrerPolicy,
      contentTypeOptions:
        security?.headers?.contentTypeOptions ??
        DEFAULT_SECURITY_HEADERS.contentTypeOptions,
      permissionsPolicy:
        security?.headers?.permissionsPolicy ??
        DEFAULT_SECURITY_HEADERS.permissionsPolicy,
    },
    contentSecurityPolicy: createContentSecurityPolicy(
      security?.contentSecurityPolicy,
    ),
    noindex: createNoindexPolicy(security?.noindex),
    cors: createCloudflareWorkerCorsPolicy(security?.cors),
    reason: security?.reason,
  };
};
