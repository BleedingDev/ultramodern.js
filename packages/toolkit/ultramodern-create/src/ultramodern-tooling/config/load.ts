import path from 'node:path';
import { readJsonObject } from './json';
import {
  normalizeWorkspaceInputs,
  type UltramodernWorkspaceInputs,
} from './normalize';

export function readUltramodernConfig(workspaceRoot = process.cwd()) {
  return readUltramodernWorkspaceInputs(workspaceRoot).config;
}

export function readUltramodernWorkspaceInputs(
  workspaceRoot = process.cwd(),
  inputs: Partial<UltramodernWorkspaceInputs> = {},
) {
  return normalizeWorkspaceInputs(workspaceRoot, {
    topology:
      inputs.topology ??
      readJsonObject(
        path.join(workspaceRoot, 'topology/reference-topology.json'),
      ),
    overlay:
      inputs.overlay ??
      readJsonObject(
        path.join(workspaceRoot, 'topology/local-overlays/development.json'),
      ),
  });
}
