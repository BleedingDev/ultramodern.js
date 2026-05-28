type ReactI18nextModule = typeof import('react-i18next');

function getOptionalReactI18nextPackageName(): string {
  return ['react', 'i18next'].join('-');
}

async function tryImportReactI18next(): Promise<ReactI18nextModule | null> {
  try {
    return (await import(
      getOptionalReactI18nextPackageName()
    )) as ReactI18nextModule;
  } catch (error) {
    return null;
  }
}

export async function getReactI18nextIntegration() {
  const reactI18nextModule = await tryImportReactI18next();

  return {
    I18nextProvider: reactI18nextModule?.I18nextProvider ?? null,
    initReactI18next: reactI18nextModule?.initReactI18next ?? null,
  };
}
