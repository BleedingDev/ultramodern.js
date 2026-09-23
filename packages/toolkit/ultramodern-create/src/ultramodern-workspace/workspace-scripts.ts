import fs from 'node:fs';
import path from 'node:path';
import {
  readFileTemplate,
  workspaceTemplateDir,
  writeFileReplacing,
} from './fs-io';

export interface WorkspaceScriptArtifact {
  relativePath: string;
  content: string;
}

/** Copy only scripts that implement workspace-specific behavior. */
export function createWorkspaceScriptArtifacts(): WorkspaceScriptArtifact[] {
  return [
    {
      relativePath: 'scripts/check-ultramodern-i18n-boundaries.mts',
      content: readFileTemplate(
        'workspace-scripts/check-ultramodern-i18n-boundaries.mts',
      ),
    },
    {
      relativePath: 'scripts/ultramodern-performance-readiness.config.mjs',
      content: readFileTemplate(
        'workspace-scripts/ultramodern-performance-readiness.config.mjs',
      ),
    },
    {
      relativePath: 'scripts/setup-agent-reference-repos.mts',
      content: fs.readFileSync(
        path.join(
          workspaceTemplateDir,
          'scripts/setup-agent-reference-repos.mjs',
        ),
        'utf8',
      ),
    },
  ];
}

export function writeGeneratedWorkspaceScripts(
  targetDir: string,
  options: {
    io?: { writeGenerated: (filePath: string, content: string) => unknown };
  } = {},
) {
  for (const artifact of createWorkspaceScriptArtifacts()) {
    if (options.io) {
      options.io.writeGenerated(
        path.join(targetDir, artifact.relativePath),
        artifact.content,
      );
    } else {
      writeFileReplacing(targetDir, artifact.relativePath, artifact.content);
    }
  }
}
