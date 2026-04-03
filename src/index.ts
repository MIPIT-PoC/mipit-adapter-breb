import { initTelemetry } from './observability/otel.js';
const sdk = initTelemetry();

import { connectRabbitMQ } from './messaging/rabbitmq.js';
import { startWorker } from './worker.js';
import { startMockServer } from './breb/mock-server.js';
import { startHealthServer } from './health-server.js';
import { env } from './config/env.js';
import { logger } from './observability/logger.js';

async function main() {
  if (env.BREB_MODE === 'mock') {
    await startMockServer();
    logger.info('Bre-B BanRep mock sandbox started');
  }

  await startHealthServer(env.HEALTH_PORT);

  const { channel } = await connectRabbitMQ(env.RABBITMQ_URL);
  await startWorker(channel);
  logger.info(`mipit-adapter-breb worker started (instance: ${env.INSTANCE_ID})`);

  const shutdown = async () => {
    logger.info('Shutting down adapter-breb...');
    await channel.close();
    await sdk.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal(err, 'Failed to start adapter-breb');
  process.exit(1);
});
