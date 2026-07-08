const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { readJsonFile, repoRoot, writeJsonFile } = require('../fs-kit');

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fs-kit-'));

test('writeJsonFile creates parent directories and writes pretty JSON', () => {
  const dir = makeTempDir();
  try {
    const filePath = path.join(dir, 'nested', 'value.json');
    assert.equal(writeJsonFile(filePath, { answer: 42 }), filePath);
    assert.equal(
      fs.readFileSync(filePath, 'utf8'),
      `${JSON.stringify({ answer: 42 }, null, 2)}\n`,
    );
    assert.equal(fs.existsSync(`${filePath}.tmp`), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readJsonFile parses JSON using native JSON.parse behavior', () => {
  const dir = makeTempDir();
  try {
    const filePath = path.join(dir, 'value.json');
    fs.writeFileSync(filePath, '{"answer":42}\n');
    assert.deepEqual(readJsonFile(filePath), { answer: 42 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readJsonFile reports the file path on parse errors', () => {
  const dir = makeTempDir();
  try {
    const filePath = path.join(dir, 'broken.json');
    fs.writeFileSync(filePath, '{"answer":');
    assert.throws(
      () => readJsonFile(filePath),
      error =>
        error.message.includes('Failed to parse JSON') &&
        error.message.includes(filePath),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('repoRoot points at the repository root', () => {
  assert.equal(repoRoot, path.resolve(__dirname, '../../..'));
});

test('writeJsonFile supports direct writes for streaming-style artifacts', () => {
  const dir = makeTempDir();
  try {
    const filePath = path.join(dir, 'artifact.json');
    writeJsonFile(filePath, ['ok'], { atomic: false });
    assert.equal(fs.readFileSync(filePath, 'utf8'), '[\n  "ok"\n]\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
