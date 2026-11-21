const amqp = require('amqplib');

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || 'amqp://learner:learner@localhost:5673';
const MANAGEMENT_URL =
  process.env.RABBITMQ_MANAGEMENT_URL || 'http://localhost:15673';
const RABBITMQ_USER = process.env.RABBITMQ_USER || 'learner';
const RABBITMQ_PASS = process.env.RABBITMQ_PASS || 'learner';

const MAIN_EXCHANGE = 'orders.exchange';
const RETRY_EXCHANGE = 'orders.retry.exchange';
const DEAD_EXCHANGE = 'orders.dlx';
const MAIN_QUEUE = 'orders.work';
const RETRY_QUEUE = 'orders.retry.5s';
const DEAD_QUEUE = 'orders.dead';

async function putPolicy(name, pattern, definition) {
  const url = new URL(`/api/policies/%2F/${encodeURIComponent(name)}`, MANAGEMENT_URL);
  const authorization = Buffer.from(`${RABBITMQ_USER}:${RABBITMQ_PASS}`).toString(
    'base64',
  );
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      authorization: `Basic ${authorization}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ pattern, definition, 'apply-to': 'queues', priority: 10 }),
  });

  if (!response.ok) {
    throw new Error(
      `Could not create policy ${name}: ${response.status} ${await response.text()}`,
    );
  }
}

async function main() {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();

  try {
    await channel.assertExchange(MAIN_EXCHANGE, 'direct', { durable: true });
    await channel.assertExchange(RETRY_EXCHANGE, 'direct', { durable: true });
    await channel.assertExchange(DEAD_EXCHANGE, 'direct', { durable: true });

    await channel.assertQueue(MAIN_QUEUE, { durable: true });
    await channel.assertQueue(RETRY_QUEUE, { durable: true });
    await channel.assertQueue(DEAD_QUEUE, { durable: true });

    await channel.bindQueue(MAIN_QUEUE, MAIN_EXCHANGE, 'order.created');
    await channel.bindQueue(RETRY_QUEUE, RETRY_EXCHANGE, 'order.retry');
    await channel.bindQueue(DEAD_QUEUE, DEAD_EXCHANGE, 'order.dead');

    // Policies can be changed without deleting and redeclaring application queues.
    await putPolicy('orders-main-dlx', '^orders\\.work$', {
      'dead-letter-exchange': DEAD_EXCHANGE,
      'dead-letter-routing-key': 'order.dead',
    });
    await putPolicy('orders-retry-delay', '^orders\\.retry\\.5s$', {
      'message-ttl': 5000,
      'dead-letter-exchange': MAIN_EXCHANGE,
      'dead-letter-routing-key': 'order.created',
    });

    console.log('Order topology is ready:');
    console.log(`  work:  ${MAIN_QUEUE}`);
    console.log(`  retry: ${RETRY_QUEUE} (5 second delay)`);
    console.log(`  dead:  ${DEAD_QUEUE}`);
  } finally {
    await channel.close();
    await connection.close();
  }
}

main().catch((error) => {
  console.error('Could not set up retry/DLQ topology:', error.message);
  process.exitCode = 1;
});
