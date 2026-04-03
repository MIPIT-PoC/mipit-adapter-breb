import type { Channel } from 'amqplib';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';

export function publishAck(channel: Channel, message: Record<string, unknown>): void {
  const payload = Buffer.from(JSON.stringify(message));

  channel.publish(env.EXCHANGE_NAME, env.ACK_ROUTING_KEY, payload, {
    persistent: true,
    contentType: 'application/json',
  });

  logger.debug(
    { exchange: env.EXCHANGE_NAME, routingKey: env.ACK_ROUTING_KEY },
    'Published Bre-B ack message',
  );
}
