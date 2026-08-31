import type { JsonValue, WorkspaceApp } from './types';

const commonLocaleMessages = {
  cs: {
    language: {
      cs: 'Čeština',
      en: 'Angličtina',
      switcher: 'Jazyk',
    },
    routes: {
      home: 'Domů',
    },
    seo: {
      description:
        'Route-owned UltraModern plocha s lokalizovaným SSR a frameworkem řízenými public metadata.',
    },
  },
  en: {
    language: {
      cs: 'Czech',
      en: 'English',
      switcher: 'Language',
    },
    routes: {
      home: 'Home',
    },
    seo: {
      description:
        'Route-owned UltraModern surface with localized SSR and framework-owned public metadata.',
    },
  },
} satisfies Record<'en' | 'cs', Record<string, JsonValue>>;

const generatedLocaleResources = {
  cs: {
    shell: {
      boundaries: {
        toggle: 'zobrazit hranice týmů',
      },
      hero: {
        cardOne:
          'Přidejte první business vertical příkazem create <domain> --vertical, až ho opravdu potřebujete.',
        cardOneKicker: 'Verticaly',
        cardTwo:
          'Plný markup, styly a lokalizovaný obsah se vykreslí před hydratací.',
        cardTwoKicker: 'Vykreslení',
        empty: 'Zatím nejsou připojené žádné MicroVerticaly.',
        eyebrow: 'Shell SuperApp starter',
        lede: 'Začněte s produkčně připraveným shellem. MicroVerticaly přidávejte až podle skutečných business domén.',
        primary: 'Shell je připraven',
        secondary: 'Přidejte vertical, až bude potřeba',
      },
      language: commonLocaleMessages.cs.language,
      remoteUnavailable: 'Remote vertical je nedostupný',
      remotes: {},
      routes: {
        home: commonLocaleMessages.cs.routes.home,
      },
      seo: {
        description:
          'UltraModern shell SuperApp s lokalizovaným SSR, Module Federation a frameworkem řízenými public metadata.',
      },
      title: 'UltraModern Workspace',
    },
  },
  en: {
    shell: {
      boundaries: {
        toggle: 'show team boundaries',
      },
      hero: {
        cardOne:
          'Add the first business vertical with create <domain> --vertical when the product needs one.',
        cardOneKicker: 'Verticals',
        cardTwo:
          'Full page markup, styles, and localized content render before hydration.',
        cardTwoKicker: 'Rendering',
        empty: 'No MicroVerticals are connected yet.',
        eyebrow: 'Shell SuperApp starter',
        lede: 'Start with a production-ready shell. Add MicroVerticals later for real business domains.',
        primary: 'Shell ready',
        secondary: 'Add a vertical when needed',
      },
      language: commonLocaleMessages.en.language,
      remoteUnavailable: 'Remote vertical unavailable',
      remotes: {},
      routes: {
        home: commonLocaleMessages.en.routes.home,
      },
      seo: {
        description:
          'UltraModern shell SuperApp with localized SSR, Module Federation, and framework-owned public metadata.',
      },
      title: 'UltraModern Workspace',
    },
  },
} satisfies Record<'en' | 'cs', Record<string, Record<string, JsonValue>>>;

const verticalLocaleCopy = {
  cs: {
    federatedSurface: 'Federovaná plocha vlastněná tímto verticalem.',
    remoteUnavailable: 'Remote vertical je nedostupný',
    routeSurface: 'Routovaná plocha vlastněná tímto verticalem.',
    widgetBody: 'Vlastní routovanou plochu verticalu.',
  },
  en: {
    federatedSurface: 'Federated surface owned by this vertical.',
    remoteUnavailable: 'Remote vertical unavailable',
    routeSurface: 'Route surface owned by this vertical.',
    widgetBody: 'Owns a vertical route surface.',
  },
} as const;

const createFallbackLocaleMessages = (
  app: WorkspaceApp,
  language: 'en' | 'cs',
) => ({
  ...commonLocaleMessages[language],
  federatedSurface: verticalLocaleCopy[language].federatedSurface,
  remoteUnavailable: verticalLocaleCopy[language].remoteUnavailable,
  role: app.domain ?? app.kind,
  routeSurface: verticalLocaleCopy[language].routeSurface,
  title: app.displayName,
  widgetBody: verticalLocaleCopy[language].widgetBody,
});

function createAppLocaleMessages(app: WorkspaceApp, language: 'en' | 'cs') {
  const domain = app.domain ?? app.id;
  const messageKey = app.kind === 'shell' ? 'shell' : domain;
  // Only the shell ships generated copy; every vertical gets the same
  // generic fallback regardless of its name (no demo-topology lanes).
  const messages =
    app.kind === 'shell'
      ? generatedLocaleResources[language].shell
      : createFallbackLocaleMessages(app, language);

  return {
    [messageKey]: messages,
  };
}

export function createAppPublicLocaleMessages(
  app: WorkspaceApp,
  language: 'en' | 'cs',
  _remotes: WorkspaceApp[] = [],
) {
  return createAppLocaleMessages(app, language);
}
