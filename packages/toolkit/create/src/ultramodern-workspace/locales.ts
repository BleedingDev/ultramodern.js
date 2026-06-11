import type { JsonValue, WorkspaceApp } from './types';

export const commonLocaleMessages = {
  cs: {
    language: {
      cs: 'Čeština',
      en: 'Angličtina',
      switcher: 'Jazyk',
    },
    routes: {
      actions: 'Akce',
      directory: 'Adresář',
      done: 'Akce dokončena',
      home: 'Domů',
      recordDetail: 'Detail záznamu',
      review: 'Revize akce',
      unavailable: 'Nedostupné',
      workspaces: 'Pracovní prostory',
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
      actions: 'Actions',
      directory: 'Directory',
      done: 'Action complete',
      home: 'Home',
      recordDetail: 'Record detail',
      review: 'Action review',
      unavailable: 'Unavailable',
      workspaces: 'Workspaces',
    },
    seo: {
      description:
        'Route-owned UltraModern surface with localized SSR and framework-owned public metadata.',
    },
  },
} satisfies Record<'en' | 'cs', Record<string, JsonValue>>;

export const generatedLocaleResources = {
  cs: {
    actions: {
      ...commonLocaleMessages.cs,
      federatedSurface: 'Federovaná plocha vlastněná tímto verticalem.',
      remoteUnavailable: 'Remote vertical je nedostupný',
      role: 'akce',
      routeSurface: 'Routovaná plocha vlastněná tímto verticalem.',
      title: 'Akční vertical',
      widgetBody: 'Vlastní routovanou plochu verticalu.',
      controls: {
        complete: 'Dokončit',
        remove: 'Odebrat',
        start: 'Spustit akci',
        viewQueue: 'Zobrazit frontu',
      },
      queue: {
        empty: 'Zatím nejsou ve frontě žádné akce.',
        itemCount_few: '{{count}} akce',
        itemCount_many: '{{count}} akce',
        itemCount_one: '{{count}} akce',
        itemCount_other: '{{count}} akcí',
        starterAction: 'Zkontrolovat startovací záznam',
        status: {
          complete: 'Dokončeno',
          queued: 'Ve frontě',
        },
        title: 'Fronta akcí',
      },
    },
    records: {
      ...commonLocaleMessages.cs,
      federatedSurface: 'Federovaná plocha vlastněná tímto verticalem.',
      remoteUnavailable: 'Remote vertical je nedostupný',
      role: 'záznamy',
      routeSurface: 'Routovaná plocha vlastněná tímto verticalem.',
      title: 'Záznamový vertical',
      widgetBody: 'Vlastní routovanou plochu verticalu.',
      record: {
        eyebrow: 'Detail záznamu',
        lede: 'Startovací záznam ověřuje spolupráci lokalizovaného SSR, hydratace remote části a Effect BFF vlastněného verticalem.',
        lifecycle: 'Životní cyklus',
        owner: 'Vlastník',
        ownerName: 'Zkušenost pracovního prostoru',
        priority: 'Priorita',
        priorityValue: 'P1',
        ready: 'Připraveno',
        sla: 'SLA',
        slaValue: '24 h',
        state: 'Stav',
        status: 'Status',
        title: 'Startovací záznam',
      },
    },
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
    workspace: {
      ...commonLocaleMessages.cs,
      federatedSurface: 'Federovaná plocha vlastněná tímto verticalem.',
      footer: 'UltraModern workspace',
      remoteUnavailable: 'Remote vertical je nedostupný',
      role: 'pracovní prostor',
      routeSurface: 'Routovaná plocha vlastněná tímto verticalem.',
      title: 'Pracovní vertical',
      widgetBody: 'Poskytuje sdílené UI prvky pro pracovní prostor.',
      directory: {
        deliveryCopy: 'Vlastní generované akční toky a stav workflow.',
        deliveryName: 'Doručovací operace',
        deliveryTeam: 'Doručovací tým',
        platformCopy: 'Vlastní skládání shellu, routování a sdílený zážitek.',
        platformName: 'Platformní zkušenost',
        platformTeam: 'Platformní tým',
        title: 'Adresář',
      },
      header: {
        brand: 'UltraModern Workspace',
        directory: 'Adresář',
        navigation: 'Hlavní navigace',
        workspaces: 'Pracovní prostory',
      },
      highlights: {
        actions: 'Akční část',
        actionsTitle: 'Spusťte akci napříč verticaly',
        records: 'Záznamová část',
        recordsTitle: 'Otevřete záznam vlastněný routou',
        shell: 'Shell část',
        shellTitle: 'Skládejte verticaly v shellu',
        title: 'Generované plochy verticalů',
      },
    },
  },
  en: {
    actions: {
      ...commonLocaleMessages.en,
      federatedSurface: 'Federated surface owned by this vertical.',
      remoteUnavailable: 'Remote vertical unavailable',
      role: 'actions',
      routeSurface: 'Route surface owned by this vertical.',
      title: 'Actions Vertical',
      widgetBody: 'Owns a vertical route surface.',
      controls: {
        complete: 'Complete',
        remove: 'Remove',
        start: 'Start action',
        viewQueue: 'View queue',
      },
      queue: {
        empty: 'No actions are queued yet.',
        itemCount_one: '{{count}} action',
        itemCount_other: '{{count}} actions',
        starterAction: 'Review starter record',
        status: {
          complete: 'Complete',
          queued: 'Queued',
        },
        title: 'Action queue',
      },
    },
    records: {
      ...commonLocaleMessages.en,
      federatedSurface: 'Federated surface owned by this vertical.',
      remoteUnavailable: 'Remote vertical unavailable',
      role: 'records',
      routeSurface: 'Route surface owned by this vertical.',
      title: 'Records Vertical',
      widgetBody: 'Owns a vertical route surface.',
      record: {
        eyebrow: 'Record detail',
        lede: 'A starter record proving localized SSR, remote hydration, and a vertical-owned Effect BFF can cooperate.',
        lifecycle: 'Lifecycle',
        owner: 'Owner',
        ownerName: 'Workspace Experience',
        priority: 'Priority',
        priorityValue: 'P1',
        ready: 'Ready',
        sla: 'SLA',
        slaValue: '24h',
        state: 'State',
        status: 'Status',
        title: 'Starter Record',
      },
    },
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
    workspace: {
      ...commonLocaleMessages.en,
      federatedSurface: 'Federated surface owned by this vertical.',
      footer: 'UltraModern workspace',
      remoteUnavailable: 'Remote vertical unavailable',
      role: 'workspace',
      routeSurface: 'Route surface owned by this vertical.',
      title: 'Workspace Vertical',
      widgetBody: 'Provides shared UI primitives for the workspace.',
      directory: {
        deliveryCopy: 'Owns generated action flows and workflow state.',
        deliveryName: 'Delivery Operations',
        deliveryTeam: 'Delivery team',
        platformCopy: 'Owns shell composition, routing, and shared experience.',
        platformName: 'Platform Experience',
        platformTeam: 'Platform team',
        title: 'Directory',
      },
      header: {
        brand: 'UltraModern Workspace',
        directory: 'Directory',
        navigation: 'Main navigation',
        workspaces: 'Workspaces',
      },
      highlights: {
        actions: 'Action lane',
        actionsTitle: 'Trigger a cross-vertical action',
        records: 'Record lane',
        recordsTitle: 'Open a route-owned record',
        shell: 'Shell lane',
        shellTitle: 'Compose verticals in the shell',
        title: 'Generated vertical surfaces',
      },
    },
  },
} satisfies Record<'en' | 'cs', Record<string, Record<string, JsonValue>>>;

export const createFallbackLocaleMessages = (
  app: WorkspaceApp,
  language: 'en' | 'cs',
) => ({
  ...commonLocaleMessages[language],
  federatedSurface:
    generatedLocaleResources[language].workspace.federatedSurface,
  remoteUnavailable:
    generatedLocaleResources[language].workspace.remoteUnavailable,
  role: app.domain ?? app.kind,
  routeSurface: generatedLocaleResources[language].workspace.routeSurface,
  title: app.displayName,
  widgetBody:
    app.kind === 'vertical'
      ? generatedLocaleResources[language].records.widgetBody
      : generatedLocaleResources[language].workspace.widgetBody,
});

export function createAppLocaleMessages(
  app: WorkspaceApp,
  language: 'en' | 'cs',
) {
  const domain = app.domain ?? app.id;
  const messageKey = app.kind === 'shell' ? 'shell' : domain;
  const messages =
    generatedLocaleResources[language][messageKey] ??
    createFallbackLocaleMessages(app, language);

  return {
    [messageKey]: messages,
  };
}

export function createAppPublicLocaleMessages(
  app: WorkspaceApp,
  language: 'en' | 'cs',
  remotes: WorkspaceApp[] = [],
) {
  if (app.kind !== 'shell') {
    return createAppLocaleMessages(app, language);
  }

  return Object.assign(
    {},
    createAppLocaleMessages(app, language),
    ...remotes.map(remote => createAppLocaleMessages(remote, language)),
  );
}
