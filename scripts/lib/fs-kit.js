/**
 * Dependency-free filesystem helpers shared by fork-owned scripts.
 */
const fs = require('node:fs');
const path = require('node:path');

const readJsonFile = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const writeJsonFile = (filePath, value, options = {}) => {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (options.atomic === false) {
    fs.writeFileSync(filePath, json);
    return filePath;
  }

  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, json);
  fs.renameSync(temporaryPath, filePath);
  return filePath;
};

module.exports = {
  readJsonFile,
  writeJsonFile,
};
