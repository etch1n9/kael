import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Jalankan pengembangan melalui npm run dev.');

const root = fileURLToPath(new URL('../', import.meta.url));
const children = [];
let stopping = false;

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

for (const [name, executable, args] of [
  ['kael-server', 'sh', ['scripts/server.sh', 'dev']],
  ['kael-client', process.execPath, [npmCli, 'run', 'dev', '-w', 'kael-client', '--', ...process.argv.slice(2)]],
]) {
  const child = spawn(executable, args, {
    cwd: root,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(`Gagal menjalankan ${name}: ${error.message}`);
    process.exitCode = 1;
    stop();
  });
  child.on('exit', (code) => {
    if (!stopping) {
      process.exitCode = code ?? 1;
      stop();
    }
  });
}

for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(signal, () => {
    process.exitCode = exitCode;
    stop(signal);
  });
}
