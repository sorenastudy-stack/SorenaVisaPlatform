const { spawn, execSync } = require('child_process');
const path = require('path');
const backendDir = path.resolve(__dirname);

try {
  execSync('cd /d ' + backendDir + ' && npm run build', { stdio: 'inherit' });
} catch (err) {
  console.error('Build failed:', err);
  process.exit(1);
}

const server = spawn('cmd.exe', ['/c', 'cd /d ' + backendDir + ' && node dist/main'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

server.stdout.on('data', (chunk) => process.stdout.write(chunk));
server.stderr.on('data', (chunk) => process.stderr.write(chunk));

function cleanup() {
  if (server && !server.killed) {
    server.kill();
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });

console.log('Waiting 8 seconds for server startup...');
const waitBuffer = new SharedArrayBuffer(4);
const waitView = new Int32Array(waitBuffer);
Atomics.wait(waitView, 0, 0, 8000);

let exitCode = 0;
try {
  execSync('cd /d ' + backendDir + ' && node e2e-test.js', { stdio: 'inherit' });
} catch (err) {
  console.error('Test execution failed:', err.message);
  if (err.stdout) console.error('stdout:', err.stdout.toString());
  if (err.stderr) console.error('stderr:', err.stderr.toString());
  exitCode = 1;
} finally {
  cleanup();
  process.exit(exitCode);
}
