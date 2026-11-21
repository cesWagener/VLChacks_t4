import { verifyFfmpeg } from './audio.js';
import { readConfig } from './config.js';
import { createVoiceServer } from './server.js';

try {
  try {
    process.loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error('Unable to load the voice API .env file.');
    }
  }

  const config = readConfig();
  verifyFfmpeg(config.ffmpegPath);
  const server = createVoiceServer(config);
  server.once('error', (error: NodeJS.ErrnoException) => {
    console.error(JSON.stringify({ event: 'listen_failed', code: error.code ?? 'UNKNOWN' }));
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () => {
    console.log(JSON.stringify({ event: 'listening', host: config.host, port: config.port }));
  });

  const stop = () => {
    server.close();
    const deadline = setTimeout(() => server.closeAllConnections(), 10_000);
    deadline.unref();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  console.error(JSON.stringify({
    event: 'startup_failed',
    message: error instanceof Error ? error.message : 'Invalid voice API configuration.',
  }));
  process.exitCode = 1;
}
