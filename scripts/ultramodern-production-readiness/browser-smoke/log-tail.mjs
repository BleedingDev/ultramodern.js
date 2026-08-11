import fs from 'node:fs';

export const combinedLogTailMaxChars = 8_192;

const truncationMarker = '[earlier child output truncated]\n';
const messageTruncationMarker = '\n[additional failure context truncated]';
const failureMessageMaxChars = 4_096;
const failureEvidenceMaxChars = 4_096;
const ansiEscapePattern = /\u001b\[[0-?]*[ -/]*[@-~]/gu;
const secretAssignmentPattern =
  /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|ACCESS_KEY)[A-Z0-9_]*)\s*([=:])\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s,\n]+)/giu;
const authorizationPattern =
  /\b(authorization\s*:\s*(?:bearer\s+)?)[^\s,\n]+/giu;
const jsonSecretPropertyPattern =
  /"([^"\n]*(?:token|secret|password|passwd|api[_-]?key|access[_-]?key|authorization|cookie)[^"\n]*)"\s*:\s*(?:"(?:\\.|[^"\\\n])*"|[^,}\s]+)/giu;

export function redactLogText(value) {
  return String(value)
    .replace(ansiEscapePattern, '')
    .replace(jsonSecretPropertyPattern, (match, key) =>
      match.includes('[REDACTED]') ? match : `"${key}":"[REDACTED]"`,
    )
    .replace(secretAssignmentPattern, '$1$2[REDACTED]')
    .replace(authorizationPattern, '$1[REDACTED]');
}

export function boundCombinedLogTail(
  value,
  maxChars = combinedLogTailMaxChars,
) {
  const redacted = redactLogText(value).trimEnd();
  if (redacted.length <= maxChars) {
    return redacted;
  }
  const retainedChars = Math.max(0, maxChars - truncationMarker.length);
  return `${truncationMarker}${redacted.slice(-retainedChars)}`;
}

export function createCombinedLogTailCollector(
  maxChars = combinedLogTailMaxChars,
) {
  const rawTailMaxChars = maxChars * 2;
  let rawTail = '';
  return {
    append(chunk) {
      rawTail = `${rawTail}${String(chunk)}`.slice(-rawTailMaxChars);
    },
    read() {
      return boundCombinedLogTail(rawTail, maxChars);
    },
  };
}

export function readCombinedLogTail(
  logPath,
  maxChars = combinedLogTailMaxChars,
) {
  if (typeof logPath !== 'string' || !fs.existsSync(logPath)) {
    return '';
  }
  const bytesToRead = maxChars * 4;
  const descriptor = fs.openSync(logPath, 'r');
  try {
    const size = fs.fstatSync(descriptor).size;
    const length = Math.min(size, bytesToRead);
    const buffer = Buffer.alloc(length);
    fs.readSync(descriptor, buffer, 0, length, size - length);
    return boundCombinedLogTail(buffer.toString('utf8'), maxChars);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function boundFailureEvidence(
  value,
  maxChars = failureEvidenceMaxChars,
) {
  const redacted = redactLogText(value).trimEnd();
  if (redacted.length <= maxChars) {
    return redacted;
  }
  const retainedChars = Math.max(0, maxChars - messageTruncationMarker.length);
  return `${redacted.slice(0, retainedChars)}${messageTruncationMarker}`;
}

export function formatFailureWithLogEvidence(
  message,
  { failureEvidence, logPath, logTail } = {},
) {
  const redactedMessage = redactLogText(message).trimEnd();
  const headline =
    redactedMessage.length <= failureMessageMaxChars
      ? redactedMessage
      : `${redactedMessage.slice(
          0,
          failureMessageMaxChars - messageTruncationMarker.length,
        )}${messageTruncationMarker}`;
  const boundedTail = boundCombinedLogTail(logTail ?? '');
  const boundedEvidence = boundFailureEvidence(failureEvidence ?? '');
  const sections = [headline];
  if (boundedEvidence.length > 0 && !headline.includes(boundedEvidence)) {
    sections.push(`structured failure evidence:\n${boundedEvidence}`);
  }
  if (
    typeof logPath === 'string' &&
    logPath.length > 0 &&
    !headline.includes(logPath)
  ) {
    sections.push(`child log: ${logPath}`);
  }
  if (boundedTail.length > 0 && !headline.includes(boundedTail)) {
    sections.push(`combined child log tail:\n${boundedTail}`);
  }
  return sections.filter(Boolean).join('\n');
}
