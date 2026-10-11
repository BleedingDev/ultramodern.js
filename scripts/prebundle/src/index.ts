import fs from 'fs-extra';
import { dirname } from 'path';
import { parseTasks } from './helper';
import { prebundle } from './prebundle';

async function run() {
  if (process.argv.length > 3) {
    throw new Error('Usage: pnpm start [dependency]');
  }
  const parsedTasks = await parseTasks(process.argv[2]);

  if (!process.argv[2]) {
    for (const directory of new Set(
      parsedTasks.map(task => dirname(task.distPath)),
    )) {
      fs.removeSync(directory);
    }
  }

  for (const task of parsedTasks) {
    await prebundle(task);
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
