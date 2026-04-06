import express from 'express';
import { registry } from './observability/metrics.js';
import { logger } from './observability/logger.js';

export function startHealthServer(port: number): Promise<import('http').Server> {
  const app = express();

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (_req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok', adapter: 'breb' }));

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  });

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      logger.info({ port }, 'Health/metrics server started (Bre-B adapter)');
      resolve(server);
    });
  });
}
