import { buildApp } from './app';
import { config } from './config';

async function start() {
  try {
    const app = await buildApp();
    await app.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`Server running on http://0.0.0.0:${config.port}`);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
