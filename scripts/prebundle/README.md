# @scripts/prebundle

This package generates utils dependency bundles with ncc and rollup-plugin-dts.
Generated `packages/toolkit/utils/compiled/` files are not tracked in Git.
Nx runs the cacheable `@scripts/prebundle:bundle` target before compiling utils;
standalone `pnpm --filter @modern-js/utils build` and `dev` run the same producer.
The utils build copies code, declarations, licenses and lockfile provenance into
`dist/compiled/`, which is included in packed releases.

## Command

Run following command to prebundle all dependencies:

```bash
pnpm start
```

Run following command to prebundle single dependencies:

```bash
pnpm start <pkgName>

# For example, prebundle commander
pnpm start commander
```

Unknown dependency names and extra arguments fail. A single dependency run is
for maintenance; package builds always generate the complete dependency set.
After a clean install, run `pnpm --filter @scripts/prebundle start` before
invoking a source typechecker directly. Root `prepare-build` and `build:required`
already establish this ordering through Nx.

## Add a new dependency

1. Remove the dependency from the `dependencies` of original package.
2. Add the dependency to the `devDependencies` of `@scripts/prebundle`. If this package has a `@types/xxx` package, it also needs to be added. It is recommended to lock the version of dependencies.
3. Add the task config to `src/constant.ts`:

```ts
const TASKS: TaskConfig[] = [
  {
    packageDir: 'toolkit/utils',
    packageName: '@modern-js/utils',
    dependencies: [
      // Add the package name
      'address',
    ],
  },
];
```

4. Run `pnpm start`.
5. Import from the compiled directory:

```ts
// Old
import foo from 'foo';

// New
import foo from '../compiled/foo';
```

## Dependency Config

Supported dependency config:

### externals

Externals to leave as requires of the build.

```ts
dependencies: [
  {
    name: 'foo',
    externals: {
      webpack: '../webpack',
    },
  },
];
```

### minify

Whether to minify the code, default `true`.

```ts
dependencies: [
  {
    name: 'foo',
    minify: false,
  },
];
```

### packageJsonField

Copy extra fields from original package.json to target package.json.

```ts
dependencies: [
  {
    name: 'foo',
    packageJsonField: ['options'],
  },
];
```

Following fields will be copied by default:

- `name`
- `author`
- `version`
- `funding`
- `license`
- `types`
- `typing`
- `typings`

### beforeBundle

Callback before bundle.

```ts
dependencies: [
  {
    name: 'foo',
    beforeBundle(task) {
      console.log('do something');
    },
  },
];
```

### emitFiles

Emit extra entry files to map imports.

```ts
dependencies: [
  {
    name: 'foo',
    emitFiles: [
      {
        path: 'foo.js',
        content: `module.exports = require('./').foo;`,
      },
    ],
  },
];
```

### ignoreDts

Override the original declaration metadata with `index.d.ts`. This flag does
not generate fake declarations; `emitDts` controls declaration generation.

```ts
dependencies: [
  {
    name: 'foo',
    ignoreDts: true,
  },
];
```

## Note

We will not prebundle the following packages because their dependencies are complex or are depended by many community packages:

- @babel/xxx
- webpack
- lodash
- caniuse-lite
