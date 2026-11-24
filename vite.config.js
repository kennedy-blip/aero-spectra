import { spawn } from 'node:child_process';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const pythonApiPort = Number(process.env.AERO_API_PORT || 8765);
const useSvelteKitApi = process.env.AERO_USE_SVELTEKIT_API === '1';
const apiProxy = useSvelteKitApi ? undefined : {
  '/api': {
    target: `http://127.0.0.1:${pythonApiPort}`,
    changeOrigin: true
  }
};

function localPythonApi() {
  let child;
  const start = (server) => {
    if (useSvelteKitApi || process.env.AERO_DISABLE_PYTHON_API === '1') return;
    const executable = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    server.config.logger.info(`[aero-python-api] starting local solver on port ${pythonApiPort}`);
    child = spawn(executable, ['-m', 'api.aero_environmental_solver'], {
      cwd: process.cwd(),
      env: { ...process.env, HOST: '0.0.0.0', PORT: String(pythonApiPort) },
      stdio: ['ignore', 'inherit', 'inherit']
    });
    child.on('error', (error) => server.config.logger.warn(`[aero-python-api] Could not start ${executable}: ${error.message}`));
    server.httpServer?.once('close', () => child?.kill());
  };
  return {
    name: 'aero-local-python-api',
    configureServer: start,
    configurePreviewServer: start
  };
}

export default defineConfig({
  plugins: [sveltekit(), localPythonApi()],
  server: { host: '0.0.0.0', allowedHosts: true, ...(apiProxy ? { proxy: apiProxy } : {}) },
  preview: { host: '0.0.0.0', allowedHosts: true, ...(apiProxy ? { proxy: apiProxy } : {}) }
});
