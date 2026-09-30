'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The npm archive does not reliably preserve executable bits for these tools.
// Prepare both macOS architectures before electron-builder copies the files.
if (process.platform !== 'win32') {
  const root = path.dirname(require.resolve('7zip-bin/package.json'));
  for (const platform of ['mac', 'linux']) {
    const directory = path.join(root, platform);
    for (const architecture of fs.readdirSync(directory)) {
      const executable = path.join(directory, architecture, '7za');
      if (fs.existsSync(executable)) fs.chmodSync(executable, 0o755);
    }
  }
}
