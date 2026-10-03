import { addUltramodernShell } from '@modern-js/ultramodern-create/ultramodern-workspace';

// Run from an installed workspace containing a vertical with id "catalog".
const version = process.argv[2];
if (!version || version === '<V>') {
  throw new Error('Pass the exact authenticated release cohort version.');
}

console.log(
  await addUltramodernShell({
    workspaceRoot: process.cwd(),
    name: 'admin',
    modernVersion: version,
    verticals: ['catalog'],
  }),
);
