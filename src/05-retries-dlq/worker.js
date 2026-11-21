const amqp = require('amqplib');

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || 'amqp://learner:learner@localhost:5673';
const MAIN_QUEUE = 'orders.work';
const RETRY_EXCHANGE = 'orders.retry.exchange';
const RETRY_ROUTING_KEY = 'order.retry';
const MAX_RETRIES = 3;
const workerName = process.argv[2] || `order-worker-${process.pid}`;

async function main() {
  const connection = await amqp.connect(RABBITMQ_URL);
  const consumeChannel = await connection.createChannel();
  const publishChannel = await connection.createConfirmChannel();
  let active = 0;
  let stopping = false;
  let resolveWhenIdle;

  await consumeChannel.checkQueue(MAIN_QUEUE);
  await consumeChannel.prefetch(1);

  const { consumerTag } = await consumeChannel.consume(
    MAIN_QUEUE,
    async (message) => {
      if (!message) return;
      active += 1;

      const headers = message.properties.headers || {};
      const retryCount = Number(headers['x-retry-count'] || 0);
      const attempt = retryCount + 1;
      let order;

      try {
        order = JSON.parse(message.content.toString());
      } catch (error) {
        console.error('  Malformed JSON is a permanent failure:', error.message);
        consumeChannel.nack(message, false, false);
        active -= 1;
        if (stopping && active === 0 && resolveWhenIdle) resolveWhenIdle();
        return;
      }

      try {
        console.log(
          `[${workerName}] order=${order.id} attempt=${attempt} mode=${order.failureMode}`,
        );

        if (order.failureMode === 'permanent') {
          console.log('  Permanent validation failure -> dead-letter queue');
          consumeChannel.nack(message, false, false);
          return;
        }

        const shouldFailTransiently =
          order.failureMode === 'transient' && attempt <= order.failTimes;

        if (shouldFailTransiently) {
          if (retryCount >= MAX_RETRIES) {
            console.log(`  Retry limit ${MAX_RETRIES} reached -> dead-letter queue`);
            consumeChannel.nack(message, false, false);
            return;
          }

          console.log(`  Temporary dependency failure -> retry in about 5 seconds`);
          publishChannel.publish(
            RETRY_EXCHANGE,
            RETRY_ROUTING_KEY,
            message.content,
            {
              persistent: true,
              contentType: message.properties.contentType,
              messageId: message.properties.messageId,
              type: message.properties.type,
              headers: {
                ...headers,
                'x-retry-count': retryCount + 1,
                'x-first-failed-at':
                  headers['x-first-failed-at'] || new Date().toISOString(),
              },
            },
          );

          // Ack the original only after RabbitMQ confirms the retry copy.
          await publishChannel.waitForConfirms();
          consumeChannel.ack(message);
          return;
        }

        // In a real service, make this operation idempotent using order.id.
        console.log(`  Payment captured for ${order.customer}; order completed.`);
        consumeChannel.ack(message);
      } catch (error) {
        console.error('  Unexpected processing error:', error.message);
        // Keep the original message when an unexpected infrastructure error occurs.
        consumeChannel.nack(message, false, true);
      } finally {
        active -= 1;
        if (stopping && active === 0 && resolveWhenIdle) resolveWhenIdle();
      }
    },
    { noAck: false },
  );

  console.log(`${workerName} is waiting for orders. Press Ctrl+C to stop.`);

  async function shutdown() {
    if (stopping) return;
    stopping = true;
    await consumeChannel.cancel(consumerTag);
    if (active > 0) {
      console.log(`${workerName} is draining ${active} active order(s)...`);
      await new Promise((resolve) => {
        resolveWhenIdle = resolve;
      });
    }
    await consumeChannel.close();
    await publishChannel.close();
    await connection.close();
    console.log(`${workerName} stopped.`);
  }

  process.once('SIGINT', () => shutdown().catch(console.error));
  process.once('SIGTERM', () => shutdown().catch(console.error));
}

main().catch((error) => {
  console.error(`${workerName} failed:`, error.message);
  console.error('Run `npm run dlq:setup` before starting the worker.');
  process.exitCode = 1;
});
