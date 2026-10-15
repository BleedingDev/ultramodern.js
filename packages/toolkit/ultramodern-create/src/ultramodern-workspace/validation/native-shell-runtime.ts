import type * as ts from '@typescript/native/unstable/ast';
import type { Checker } from '@typescript/native/unstable/sync';

type TypeScriptAst = typeof import('@typescript/native/unstable/ast');
type TypeScriptApi = typeof import('@typescript/native/unstable/sync');

export type ModernBuildTarget = 'browser' | 'node';

const FEDERATION_RUNTIME = '@module-federation/modern-js-v3/runtime';
const FEDERATION_MEMBER_LOADERS = new Set(['loadRemote', 'loadShare']);
const DECLARATION_FILE = /\.d\.[cm]?ts$/u;

/**
 * Compiler evidence for shell source that branches on the framework build
 * target and loads remotes through the native Module Federation instance.
 *
 * `process.env.MODERN_TARGET` is not ambient environment access: the Modern.js
 * runtime plugin defines it as `'browser'` or `'node'` for every bundler
 * environment, so a strict comparison is a compile-time constant that dead-code
 * elimination folds per target.
 */
export function createNativeShellRuntimeEvidence(
  typescript: TypeScriptAst,
  typescriptApi: TypeScriptApi,
  checker: Checker,
  sourceFile: ts.SourceFile,
) {
  const unwrapParentheses = (node: ts.Node) => {
    while (typescript.isParenthesizedExpression(node)) node = node.expression;
    return node;
  };

  // A `process` binding declared in workspace source is application data, not
  // the global the framework define replaces.
  const isAmbientProcess = (node: ts.Node) => {
    if (!typescript.isIdentifier(node) || node.text !== 'process') return false;
    const symbol = checker.getSymbolAtLocation(node);
    return (
      symbol === undefined ||
      symbol.declarations.every(declaration =>
        DECLARATION_FILE.test(declaration.path),
      )
    );
  };

  const isBuildTargetAccess = (
    node: ts.Node,
  ): node is ts.PropertyAccessExpression =>
    typescript.isPropertyAccessExpression(node) &&
    node.questionDotToken === undefined &&
    node.name.text === 'MODERN_TARGET' &&
    typescript.isPropertyAccessExpression(node.expression) &&
    node.expression.questionDotToken === undefined &&
    node.expression.name.text === 'env' &&
    isAmbientProcess(node.expression.expression);

  const isBuildTargetLiteral = (node: ts.Node) =>
    typescript.isStringLiteral(node) &&
    (node.text === 'browser' || node.text === 'node');

  /** The target a strict `process.env.MODERN_TARGET === '<target>'` names. */
  const buildTargetComparison = (
    node: ts.Node,
  ): ModernBuildTarget | undefined => {
    node = unwrapParentheses(node);
    if (
      !typescript.isBinaryExpression(node) ||
      node.operatorToken.kind !== typescript.SyntaxKind.EqualsEqualsEqualsToken
    )
      return undefined;
    const literal = isBuildTargetAccess(node.left)
      ? node.right
      : isBuildTargetAccess(node.right)
        ? node.left
        : undefined;
    return literal !== undefined && isBuildTargetLiteral(literal)
      ? ((literal as ts.StringLiteral).text as ModernBuildTarget)
      : undefined;
  };

  const isConditionOf = (node: ts.Node) => {
    let condition = node;
    for (;;) {
      const parent = condition.parent;
      if (
        typescript.isParenthesizedExpression(parent) ||
        (typescript.isPrefixUnaryExpression(parent) &&
          parent.operator === typescript.SyntaxKind.ExclamationToken) ||
        (typescript.isBinaryExpression(parent) &&
          (parent.operatorToken.kind ===
            typescript.SyntaxKind.AmpersandAmpersandToken ||
            parent.operatorToken.kind === typescript.SyntaxKind.BarBarToken))
      ) {
        condition = parent;
        continue;
      }
      return (
        (typescript.isIfStatement(parent) && parent.expression === condition) ||
        (typescript.isConditionalExpression(parent) &&
          parent.condition === condition)
      );
    }
  };

  /**
   * Whether `node` (the `process.env` access) is the left side of a strict
   * build-target comparison that is used as an if/ternary condition.
   */
  const isBuildTargetCondition = (node: ts.Node) => {
    const access = node.parent;
    if (!isBuildTargetAccess(access) || access.expression !== node)
      return false;
    const comparison = access.parent;
    return (
      buildTargetComparison(comparison) !== undefined &&
      isConditionOf(comparison)
    );
  };

  const conjuncts = (node: ts.Node): ts.Node[] => {
    node = unwrapParentheses(node);
    return typescript.isBinaryExpression(node) &&
      node.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken
      ? [...conjuncts(node.left), ...conjuncts(node.right)]
      : [node];
  };
  const requiresBrowserTarget = (condition: ts.Node) =>
    conjuncts(condition).some(
      conjunct => buildTargetComparison(conjunct) === 'browser',
    );

  /** Lexically inside the true branch of a browser-target condition. */
  const isBrowserGuarded = (node: ts.Node) => {
    for (let child = node; child.parent !== undefined; child = child.parent) {
      const parent = child.parent;
      if (
        typescript.isIfStatement(parent) &&
        parent.thenStatement === child &&
        requiresBrowserTarget(parent.expression)
      )
        return true;
      if (
        typescript.isConditionalExpression(parent) &&
        parent.whenTrue === child &&
        requiresBrowserTarget(parent.condition)
      )
        return true;
    }
    return false;
  };

  let federationInstanceTypeIds: Set<number> | undefined;
  // The ModuleFederation instance type is whatever this file's own reference
  // to the framework runtime returns from `getInstance`, after null checks.
  const federationInstanceTypes = () => {
    if (federationInstanceTypeIds !== undefined)
      return federationInstanceTypeIds;
    const typeIds = new Set<number>();
    const recordRuntime = (specifier: ts.Node) => {
      const runtime = checker.getSymbolAtLocation(specifier);
      const getInstance =
        runtime === undefined
          ? undefined
          : checker.getMemberInModuleExports(runtime, 'getInstance');
      const getInstanceType =
        getInstance === undefined
          ? undefined
          : checker.getTypeOfSymbol(getInstance);
      if (getInstanceType === undefined) return;
      for (const signature of checker.getSignaturesOfType(
        getInstanceType,
        typescriptApi.SignatureKind.Call,
      )) {
        const returnType = checker.getReturnTypeOfSignature(signature);
        const instanceType =
          returnType === undefined
            ? undefined
            : checker.getNonNullableType(returnType);
        if (
          instanceType !== undefined &&
          instanceType.getSymbol()?.name === 'ModuleFederation'
        )
          typeIds.add(instanceType.id);
      }
    };
    const visit = (node: ts.Node): void => {
      if (
        typescript.isImportDeclaration(node) &&
        typescript.isStringLiteralLikeNode(node.moduleSpecifier) &&
        node.moduleSpecifier.text === FEDERATION_RUNTIME &&
        node.importClause?.phaseModifier !== typescript.SyntaxKind.TypeKeyword
      ) {
        recordRuntime(node.moduleSpecifier);
      } else if (
        typescript.isCallExpression(node) &&
        node.expression.kind === typescript.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        typescript.isStringLiteralLikeNode(node.arguments[0]) &&
        node.arguments[0].text === FEDERATION_RUNTIME
      ) {
        recordRuntime(node.arguments[0]);
      }
      node.forEachChild(visit);
    };
    visit(sourceFile);
    federationInstanceTypeIds = typeIds;
    return typeIds;
  };

  /**
   * `instance.loadRemote(...)` / `instance.loadShare(...)` whose receiver the
   * checker types as the framework runtime's ModuleFederation instance, inside
   * a browser-target branch.
   */
  const isBrowserFederationMemberLoad = (node: ts.Node) => {
    if (!typescript.isCallExpression(node)) return false;
    const callee = unwrapParentheses(node.expression);
    if (
      !typescript.isPropertyAccessExpression(callee) ||
      !FEDERATION_MEMBER_LOADERS.has(callee.name.text)
    )
      return false;
    const receiverType = checker.getTypeAtLocation(callee.expression);
    return (
      receiverType !== undefined &&
      federationInstanceTypes().has(receiverType.id) &&
      isBrowserGuarded(node)
    );
  };

  return { isBrowserFederationMemberLoad, isBuildTargetCondition };
}
