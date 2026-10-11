import { parseAllDocuments } from 'yaml';
import { mergePnpmLockfileDocuments } from './pnpm-lockfile-documents.mjs';

export function parsePnpmLockfile(source) {
  const documents = parseAllDocuments(source).map(document => {
    if (document.errors.length) throw document.errors[0];
    return document.toJS();
  });
  return documents.length === 1
    ? documents[0]
    : mergePnpmLockfileDocuments(documents);
}
