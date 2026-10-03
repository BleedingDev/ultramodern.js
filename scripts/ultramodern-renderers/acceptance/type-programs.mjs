export function nativeTypePrograms(renderer, entryNames) {
  if (
    !['solid', 'octane'].includes(renderer) ||
    !Array.isArray(entryNames) ||
    !entryNames.length ||
    new Set(entryNames).size !== entryNames.length ||
    entryNames.some(name => !/^[a-z\d_-]+$/iu.test(name))
  )
    throw new Error('Native type programs require the authored entry names');
  const shared = {
    strict: true,
    noEmit: true,
    noCheck: false,
    skipLibCheck: false,
  };
  const entryFile = (entry, file) =>
    `node_modules/.modern-js/${renderer}/${entry}/${file}`;
  return {
    browser: {
      extends: './tsconfig.json',
      compilerOptions: { ...shared, types: [] },
      files: entryNames.map(entry => entryFile(entry, 'index.ts')),
      include: ['src/**/*.tsx', 'src/**/*.tsrx'],
      exclude: [],
    },
    server: {
      extends: './tsconfig.json',
      compilerOptions: { ...shared, types: ['node'] },
      files: [
        'modern.config.ts',
        ...entryNames.map(entry => entryFile(entry, 'index.server.ts')),
      ],
      include: ['src'],
      exclude: [],
    },
  };
}
