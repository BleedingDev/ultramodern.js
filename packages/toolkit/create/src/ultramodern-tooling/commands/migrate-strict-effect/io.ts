import fs from 'node:fs';
import path from 'node:path';

export type MigrationIo = {
  workspaceRoot: string;
  dryRun: boolean;
  plan: string[];
  write(filePath: string, content: string): boolean;
  remove(filePath: string): boolean;
  log(message: string): void;
};

export function createMigrationIo(
  workspaceRoot: string,
  dryRun: boolean,
): MigrationIo {
  const plan: string[] = [];
  const rel = (p: string) =>
    (path.relative(workspaceRoot, p) || path.basename(p))
      .split(path.sep)
      .join('/');
  return {
    workspaceRoot,
    dryRun,
    plan,
    write(filePath, content) {
      if (
        fs.existsSync(filePath) &&
        fs.readFileSync(filePath, 'utf-8') === content
      ) {
        return false;
      }
      if (dryRun) {
        plan.push(`[dry-run] would write ${rel(filePath)}`);
        return true;
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      return true;
    },
    remove(filePath) {
      if (!fs.existsSync(filePath)) {
        return false;
      }
      if (dryRun) {
        plan.push(`[dry-run] would delete ${rel(filePath)}`);
        return true;
      }
      fs.rmSync(filePath);
      return true;
    },
    log(message) {
      if (dryRun) {
        plan.push(`[dry-run] ${message}`);
      } else {
        process.stdout.write(`[ultramodern] ${message}\n`);
      }
    },
  };
}

export function readJsonFile(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function writeJsonFile(
  io: MigrationIo,
  filePath: string,
  value: unknown,
) {
  return io.write(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeJsonIfChanged(
  io: MigrationIo,
  filePath: string,
  value: unknown,
) {
  return io.write(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeTextIfChanged(
  io: MigrationIo,
  filePath: string,
  value: string,
) {
  return io.write(filePath, value);
}

export function listWorkspacePackageFiles(workspaceRoot: string) {
  const packageFiles = ['package.json'];

  for (const directory of ['apps', 'verticals', 'packages']) {
    const absoluteDirectory = path.join(workspaceRoot, directory);
    if (!fs.existsSync(absoluteDirectory)) {
      continue;
    }

    for (const entry of fs.readdirSync(absoluteDirectory, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const packageFile = `${directory}/${entry.name}/package.json`;
      if (fs.existsSync(path.join(workspaceRoot, packageFile))) {
        packageFiles.push(packageFile);
      }
    }
  }

  return packageFiles;
}
