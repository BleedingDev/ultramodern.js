import fs from 'node:fs';
import path from 'node:path';
import type { Binding, NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
  parseSource,
  SourceSyntaxError,
  traverseSource,
  unwrapExpression,
} from './source-analysis.ts';

const edge = '@modern-js/bff-effect/effect-edge';
const nodeRuntime = '@modern-js/bff-effect/effect';
const assembly = '@modern-js/bff-effect/assembly';
const failure =
  'Generated API entries must export defineEffectBff(...) or the native Effect BFF assembly helper with an explicitly composed handler Layer and an unshadowed executable root; entries must implement handlers through HttpApiBuilder.group.';
const MAX_API_SOURCE_MODULES = 256;

/** A bounded, owner-local source resolver; never executes application modules. */
export interface EffectApiSource {
  readonly id: string;
  readonly source: string;
  readonly resolveImport?: (specifier: string) => EffectApiSource | undefined;
}
export type EffectApiImportResolver = (
  specifier: string,
) => EffectApiSource | undefined;

export function createEffectApiImportResolver(
  filename: string,
): EffectApiImportResolver {
  const directory = fs.realpathSync(path.dirname(filename));
  const owner = fs.realpathSync(path.resolve(directory, '..'));
  const resolve =
    (from: string): EffectApiImportResolver =>
    specifier => {
      if (!specifier.startsWith('.')) return undefined;
      const target = path.resolve(path.dirname(from), specifier);
      if (!target.startsWith(`${owner}${path.sep}`)) return undefined;
      for (const candidate of [target, `${target}.ts`, `${target}.mts`]) {
        try {
          const real = fs.realpathSync(candidate);
          if (
            !real.startsWith(`${owner}${path.sep}`) ||
            fs.statSync(real).size > 1_000_000
          )
            return undefined;
          return {
            id: real,
            source: fs.readFileSync(real, 'utf8'),
            resolveImport: resolve(real),
          };
        } catch {
          /* Missing imports fail closed when their implementation is needed. */
        }
      }
      return undefined;
    };
  return resolve(path.join(directory, path.basename(filename)));
}

type ApiModule = EffectApiSource & { file: t.File };

/** Proves binding identity and an exported composition, not the occurrence of names. */
export function strictEffectRuntimeTopologyViolation(
  source: string,
  resolveImport?: EffectApiImportResolver,
): string | undefined {
  // The native TypeScript sync API spawns a compiler per module. Spawning from
  // Oxlint's worker can fail with ENOMEM even for one valid API. Parse and bind
  // in-process instead; no application imports, compiler subprocesses or eval.
  const modules = new Map<string, ApiModule>();
  const owners = new Map<t.Node, ApiModule>();
  const paths = new Map<t.Node, NodePath>();
  const mutated = new Set<Binding>();
  const load = (input: EffectApiSource): ApiModule => {
    const existing = modules.get(input.id);
    if (existing) return existing;
    if (
      modules.size >= MAX_API_SOURCE_MODULES ||
      input.source.length > 1_000_000
    )
      throw new SourceSyntaxError('API source budget exceeded');
    const file = parseSource(input.source, input.id, 'Invalid API syntax');
    const module = { ...input, file };
    modules.set(input.id, module);
    traverseSource(file, {
      enter(nodePath: NodePath) {
        paths.set(nodePath.node, nodePath);
        owners.set(nodePath.node, module);
        // Babel bindings track rebinding (including destructuring). Also reject
        // writes through a trusted namespace, and TS value namespace merges.
        if (
          nodePath.isAssignmentExpression() ||
          nodePath.isUpdateExpression() ||
          nodePath.isUnaryExpression({ operator: 'delete' })
        ) {
          let target: t.Node = nodePath.isAssignmentExpression()
            ? nodePath.node.left
            : nodePath.node.argument;
          while (t.isMemberExpression(target)) target = target.object;
          if (t.isIdentifier(target)) {
            const binding = nodePath.scope.getBinding(target.name);
            if (binding) mutated.add(binding);
          }
        }
        if (
          nodePath.isTSModuleDeclaration() &&
          t.isIdentifier(nodePath.node.id)
        ) {
          const binding = nodePath.scope.getBinding(nodePath.node.id.name);
          if (binding) mutated.add(binding);
        }
      },
    });
    return module;
  };
  try {
    const entry = load({ id: '/entry.ts', source, resolveImport });
    const unwrap = (node: t.Node) => unwrapExpression(node, true);
    const binding = (node: t.Node): Binding | undefined => {
      node = unwrap(node);
      if (!t.isIdentifier(node)) return undefined;
      const nodePath = paths.get(node);
      if (!nodePath) throw new Error('Missing API lexical scope');
      const value = nodePath.scope.getBinding(node.name);
      return value?.constant && !mutated.has(value) ? value : undefined;
    };
    const declaration = (node: t.Node): t.Node | undefined =>
      binding(node)?.path.node;
    const imported = (node: t.Node) => {
      const value = binding(node);
      const decl = value?.path.node;
      if (
        !decl ||
        (!t.isImportSpecifier(decl) && !t.isImportNamespaceSpecifier(decl)) ||
        (t.isImportSpecifier(decl) && decl.importKind === 'type')
      )
        return undefined;
      const statement = value.path.parent;
      if (!t.isImportDeclaration(statement) || statement.importKind === 'type')
        return undefined;
      return {
        namespace: t.isImportNamespaceSpecifier(decl),
        name: t.isImportNamespaceSpecifier(decl)
          ? '*'
          : t.isIdentifier(decl.imported)
            ? decl.imported.name
            : decl.imported.value,
        specifier: statement.source.value,
      };
    };
    const namespaceSources: Record<string, readonly string[]> = {
      HttpApi: [edge, 'effect/unstable/httpapi'],
      HttpApiBuilder: [edge, 'effect/unstable/httpapi'],
      HttpRouter: [edge, 'effect/unstable/http'],
    };
    const native = (
      node: t.Node,
      name: string,
      sources?: readonly string[],
    ): boolean => {
      const value = imported(node);
      if (!value) return false;
      const importedNameMatches = value.namespace
        ? value.specifier === `effect/${name}`
        : value.name === name && value.specifier !== `effect/${name}`;
      return (
        importedNameMatches &&
        (sources ?? namespaceSources[name] ?? [edge]).includes(value.specifier)
      );
    };
    const method = (
      node: t.Node,
      namespace: string,
      member: string,
      sources?: readonly string[],
    ): boolean => {
      node = unwrap(node);
      return (
        t.isMemberExpression(node) &&
        !node.computed &&
        t.isIdentifier(node.property, { name: member }) &&
        native(node.object, namespace, sources)
      );
    };
    const initialized = (node: t.Node): t.Node | undefined => {
      const value = binding(node);
      return value?.kind === 'const' && t.isVariableDeclarator(value.path.node)
        ? (value.path.node.init ?? undefined)
        : undefined;
    };
    const moduleFor = (node: t.Node) => {
      const value = imported(node);
      if (!value) return undefined;
      const input = owners.get(node)?.resolveImport?.(value.specifier);
      return input ? { module: load(input), name: value.name } : undefined;
    };
    const exported = (module: ApiModule, name: string): t.Node | undefined => {
      for (const statement of module.file.program.body) {
        if (
          !t.isExportNamedDeclaration(statement) ||
          statement.exportKind === 'type'
        )
          continue;
        if (t.isVariableDeclaration(statement.declaration)) {
          for (const decl of statement.declaration.declarations)
            if (t.isIdentifier(decl.id, { name })) return decl.id;
        }
        if (!statement.source) {
          const specifier = statement.specifiers.find(
            element =>
              t.isExportSpecifier(element) &&
              element.exportKind !== 'type' &&
              (t.isIdentifier(element.exported)
                ? element.exported.name
                : element.exported.value) === name,
          );
          if (t.isExportSpecifier(specifier)) return specifier.local;
        }
      }
      return undefined;
    };
    const externalValue = (node: t.Node): t.Node | undefined => {
      const value = moduleFor(node);
      return value ? exported(value.module, value.name) : undefined;
    };
    const apiIdentity = (
      node: t.Node,
      seen = new Set<t.Node>(),
    ): string | undefined => {
      node = unwrap(node);
      if (seen.has(node)) return undefined;
      seen.add(node);
      const value = imported(node);
      if (value) {
        if (!value.specifier.startsWith('.')) return undefined;
        const module = moduleFor(node);
        const exportedValue = module && exported(module.module, module.name);
        if (exportedValue) return apiIdentity(exportedValue, seen);
        // Missing exports remain the full typecheck's diagnostic. Keep the
        // named import's identity, never conflate different contract bindings.
        if (module && /(?:^|\/)shared\/(?:api|rpc)\.ts$/u.test(value.specifier))
          return `${module.module.id}:import:${value.name}`;
        if (
          !owners.get(node)?.resolveImport &&
          /(?:^|\/)shared\/(?:api|rpc)\.ts$/u.test(value.specifier)
        )
          return `${value.specifier}:${value.name}`;
        return undefined;
      }
      const init = initialized(node);
      if (init && t.isIdentifier(unwrap(init))) return apiIdentity(init, seen);
      const valueBinding = binding(node);
      return valueBinding
        ? `${owners.get(valueBinding.path.node)?.id}:${valueBinding.identifier.start}`
        : undefined;
    };
    const properties = (node: t.Node): Map<string, t.Node> | undefined => {
      node = unwrap(node);
      if (!t.isObjectExpression(node)) return undefined;
      const result = new Map<string, t.Node>();
      for (const prop of node.properties) {
        if (
          !t.isObjectProperty(prop) ||
          prop.computed ||
          !t.isIdentifier(prop.key) ||
          result.has(prop.key.name)
        )
          return undefined;
        result.set(prop.key.name, prop.value);
      }
      return result;
    };
    const active = new Set<t.Node>();
    const guarded = (
      node: t.Node,
      check: (node: t.Node) => boolean,
    ): boolean => {
      node = unwrap(node);
      if (active.has(node) || active.size > 128) return false;
      active.add(node);
      try {
        return check(node);
      } finally {
        active.delete(node);
      }
    };
    const layerSources = [edge, 'effect', 'effect/Layer'];
    const returned = (body: t.BlockStatement | t.Expression) => {
      if (!t.isBlockStatement(body)) return body;
      const statements = body.body;
      const last = statements.at(-1);
      return statements
        .slice(0, -1)
        .every(
          statement =>
            t.isVariableDeclaration(statement) ||
            t.isTSTypeAliasDeclaration(statement) ||
            t.isTSInterfaceDeclaration(statement),
        ) && t.isReturnStatement(last)
        ? last.argument
        : undefined;
    };
    const pipe = (
      node: t.CallExpression,
      check: (node: t.Node) => boolean,
    ): boolean =>
      t.isMemberExpression(node.callee) &&
      !node.callee.computed &&
      t.isIdentifier(node.callee.property, { name: 'pipe' }) &&
      check(node.callee.object) &&
      node.arguments.every(
        argument =>
          method(argument, 'Layer', 'orDie', layerSources) ||
          (t.isCallExpression(argument) &&
            method(argument.callee, 'Layer', 'provide', layerSources) &&
            argument.arguments.length > 0),
      );
    const handled = (node: t.Node): boolean => {
      node = unwrap(node);
      if (!t.isArrowFunctionExpression(node) && !t.isFunctionExpression(node))
        return false;
      const parameter = node.params[0];
      if (!t.isIdentifier(parameter)) return false;
      const body = returned(node.body);
      const chain = (value: t.Node, count = 0): boolean => {
        value = unwrap(value);
        if (t.isIdentifier(value))
          return count > 0 && declaration(value) === parameter;
        return (
          t.isCallExpression(value) &&
          t.isMemberExpression(value.callee) &&
          !value.callee.computed &&
          t.isIdentifier(value.callee.property) &&
          ['handle', 'handleRaw'].includes(value.callee.property.name) &&
          value.arguments.length === 2 &&
          chain(value.callee.object, count + 1)
        );
      };
      return !!body && chain(body);
    };
    const handlers = (node: t.Node, api: string): boolean =>
      guarded(node, node => {
        const init = initialized(node) ?? externalValue(node);
        if (init) return handlers(init, api);
        if (!t.isCallExpression(node)) return false;
        if (pipe(node, value => handlers(value, api))) return true;
        if (method(node.callee, 'Layer', 'mergeAll', layerSources))
          return (
            node.arguments.length > 0 &&
            node.arguments.every(argument => handlers(argument, api))
          );
        return (
          method(node.callee, 'HttpApiBuilder', 'group') &&
          node.arguments.length === 3 &&
          apiIdentity(node.arguments[0]) === api &&
          handled(node.arguments[2])
        );
      });
    const transport = (node: t.Node): boolean =>
      guarded(node, node => {
        const init = initialized(node);
        if (init) return transport(init);
        if (!t.isCallExpression(node))
          return method(node, 'Layer', 'empty', layerSources);
        return (
          pipe(node, transport) ||
          method(node.callee, 'HttpRouter', 'cors') ||
          (method(node.callee, 'Layer', 'mergeAll', layerSources) &&
            node.arguments.length > 0 &&
            node.arguments.every(transport))
        );
      });
    const directLayer = (node: t.Node, api: string): boolean =>
      guarded(node, node => {
        const init = initialized(node);
        if (init) return directLayer(init, api);
        if (
          !t.isCallExpression(node) ||
          !t.isMemberExpression(node.callee) ||
          node.callee.computed ||
          !t.isIdentifier(node.callee.property, { name: 'pipe' })
        )
          return false;
        const base = unwrap(node.callee.object);
        return (
          t.isCallExpression(base) &&
          method(base.callee, 'HttpApiBuilder', 'layer') &&
          base.arguments.length === 1 &&
          apiIdentity(base.arguments[0]) === api &&
          node.arguments.length > 0 &&
          node.arguments.every(
            argument =>
              t.isCallExpression(argument) &&
              method(argument.callee, 'Layer', 'provide', layerSources) &&
              argument.arguments.length === 1 &&
              handlers(argument.arguments[0], api),
          )
        );
      });
    const rpc = (values: Map<string, t.Node>): boolean => {
      const api = values.get('api');
      const apiLayer = values.get('layer');
      const apiInit = api && (initialized(api) ?? unwrap(api));
      if (
        !apiInit ||
        !t.isCallExpression(apiInit) ||
        !method(apiInit.callee, 'HttpApi', 'make') ||
        apiInit.arguments.length !== 1 ||
        !apiLayer ||
        !transport(apiLayer)
      )
        return false;
      const config = values.get('rpc');
      const fields = config && properties(config);
      const route = fields?.get('path');
      const serialization = fields?.get('serialization');
      if (
        !t.isStringLiteral(route, { value: '/rpc' }) ||
        !t.isStringLiteral(serialization, { value: 'json' })
      )
        return false;
      const group = fields?.get('group');
      const layer = fields?.get('layer');
      const value = group && imported(group);
      if (!group || !layer || value?.specifier !== '../shared/rpc.ts')
        return false;
      const groupValue = externalValue(group);
      const groupInit = groupValue && initialized(groupValue);
      if (
        !groupInit ||
        !t.isCallExpression(groupInit) ||
        !method(groupInit.callee, 'RpcGroup', 'make', [
          'effect/unstable/rpc',
          '@modern-js/bff-effect/effect-client',
        ])
      )
        return false;
      const layerInit = initialized(layer) ?? unwrap(layer);
      if (
        !t.isCallExpression(layerInit) ||
        !t.isMemberExpression(layerInit.callee) ||
        layerInit.callee.computed ||
        !t.isIdentifier(layerInit.callee.property, { name: 'toLayer' }) ||
        apiIdentity(layerInit.callee.object) !== apiIdentity(group) ||
        layerInit.arguments.length !== 1
      )
        return false;
      const implementation = unwrap(layerInit.arguments[0]);
      if (
        !t.isCallExpression(implementation) ||
        !t.isMemberExpression(implementation.callee) ||
        implementation.callee.computed ||
        !t.isIdentifier(implementation.callee.property, { name: 'of' }) ||
        apiIdentity(implementation.callee.object) !== apiIdentity(group) ||
        implementation.arguments.length !== 1
      )
        return false;
      const entries = properties(implementation.arguments[0]);
      return (
        !!entries?.size &&
        [...entries.values()].every(
          value =>
            t.isArrowFunctionExpression(value) || t.isFunctionExpression(value),
        )
      );
    };
    const runtime = (node: t.Node): boolean =>
      guarded(node, node => {
        const init = initialized(node);
        if (init) return runtime(init);
        if (!t.isCallExpression(node)) return false;
        const value = imported(node.callee);
        if (
          (value?.name === 'defineEffectBff' &&
            [edge, nodeRuntime].includes(value.specifier)) ||
          (value?.name === 'assembleEffectBffRuntime' &&
            value.specifier === assembly)
        ) {
          if (node.arguments.length !== 1) return false;
          const values = properties(node.arguments[0]);
          if (!values) return false;
          if (value.name === 'defineEffectBff' && values.has('rpc'))
            return rpc(values);
          const api = values.get('api');
          const apiBinding = api && imported(api);
          if (!api || apiBinding?.specifier !== '../shared/api.ts')
            return false;
          const identity = apiIdentity(api);
          if (!identity) return false;
          const layer = values.get(
            value.name === 'defineEffectBff' ? 'layer' : 'handlers',
          );
          const extra = values.get('transport');
          return (
            layer !== undefined &&
            (value.name === 'defineEffectBff'
              ? directLayer(layer, identity)
              : handlers(layer, identity)) &&
            (!extra || transport(extra))
          );
        }
        // Dependency parameters do not establish topology: the returned root,
        // API and handler bindings must still be proven from lexical source.
        // Only straight-line factories prove all return paths.
        const decl = declaration(node.callee);
        const factory =
          decl && t.isFunctionDeclaration(decl)
            ? decl
            : initialized(node.callee);
        if (
          !factory ||
          (!t.isFunctionDeclaration(factory) &&
            !t.isArrowFunctionExpression(factory) &&
            !t.isFunctionExpression(factory)) ||
          !factory.body
        )
          return false;
        const result = returned(factory.body);
        return !!result && runtime(result);
      });
    const root = entry.file.program.body.find(statement =>
      t.isExportDefaultDeclaration(statement),
    );
    return root && runtime(root.declaration) ? undefined : failure;
  } catch (cause) {
    if (cause instanceof SourceSyntaxError) return failure;
    const message =
      typeof cause === 'object' &&
      cause !== null &&
      'message' in cause &&
      typeof cause.message === 'string'
        ? cause.message
        : String(cause);
    throw new Error(`Strict Effect API analysis failed: ${message}`, { cause });
  }
}
