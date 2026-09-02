declare const registry: {
  register<TFactory extends Function>(factory: TFactory): TFactory;
  is(factory: unknown): boolean;
};

export = registry;
