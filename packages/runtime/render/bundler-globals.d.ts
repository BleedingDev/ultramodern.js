// Free variables the Rspack runtime supplies to framework code. Shared by
// @modern-js/render and @modern-js/runtime typecheck configs; declared with
// `var` so they merge with @rspack/core/module when both are in a program.
declare var __webpack_public_path__: string;
declare var __rspack_rsc_manifest__:
  | { entryCssFiles?: Record<string, string[]> }
  | undefined;
