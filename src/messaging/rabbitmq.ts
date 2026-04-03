import amqplib from 'amqplib';
import type { ChannelModel, Channel } from 'amqplib';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';

let connection: ChannelModel;
let channel: Channel;

export async function connectRabbitMQ(url?: string): Promise<{ connection: ChannelModel; channel: Channel }> {
  const rabbitUrl = url ?? env.RABBITMQ_URL;

  logger.info({ url: rabbitUrl.replace(/\/\/.*@/, '//***@') }, 'Connecting to RabbitMQ');

  connection = await amqplib.connect(rabbitUrl);
  channel = await connection.createChannel();

  await channel.assertExchange(env.EXCHANGE_NAME, 'topic', { durable: true });

  await channel.assertQueue(env.QUEUE_NAME, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': 'mipit.dlx',
      'x-dead-letter-routing-key': 'dlq.breb',
    },
  });

  await channel.bindQueue(env.QUEUE_NAME, env.EXCHANGE_NAME, 'route.breb');

  logger.info({ queue: env.QUEUE_NAME, exchange: env.EXCHANGE_NAME }, 'RabbitMQ connected (Bre-B adapter)');

  connection.on('error', (err) => logger.error({ err }, 'RabbitMQ connection error'));
  connection.on('close', () => logger.warn('RabbitMQ connection closed'));

  return { connection, channel };
}

export function getChannel(): Channel {
  if (!channel) throw new Error('RabbitMQ channel not initialized');
  return channel;
}

export function getConnection(): ChannelModel {
  if (!connection) throw new Error('RabbitMQ connection not initialized');
  return connection;
}
