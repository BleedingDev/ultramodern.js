import { fileURLToPath } from 'node:url';
import {
  assertWindowsCoverage,
  loadWindowsUnitInputs,
  selectWindowsUnitFiles,
  windowsUnitConfig,
} from './windows-unit-selection.mjs';

export default async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const { base, loadConfig, createRstest } = await loadWindowsUnitInputs(root);
  const original = await createRstest({ cwd: root, config: base });
  const baseline = await original.listTests({ filesOnly: true });
  const group = process.env.WINDOWS_UNIT_GROUP;
  const config = await windowsUnitConfig(
    root,
    base,
    loadConfig,
    group,
    baseline,
  );
  const selected = await createRstest({ cwd: root, config });
  const files = await selected.listTests({ filesOnly: true });
  assertWindowsCoverage(
    selectWindowsUnitFiles(
      root,
      baseline,
      group === 'generators' ? group : '1/4',
    ),
    [files],
  );
  console.log(
    JSON.stringify({
      windowsUnitGroup: group,
      projectFileIdentities: files.length,
      testFileWorkers: 1,
    }),
  );
  return config;
};
