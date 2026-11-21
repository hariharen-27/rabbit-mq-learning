const amqp = require('amqplib');
const { randomUUID } = require('node:crypto');

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || 'amqp://learner:learner@localhost:5673';
const EXCHANGE = 'orders.exchange';
const QUEUE = 'orders.work';
const ROUTING_KEY = 'order.created';
const validModes = new Set(['success', 'transient', 'permanent']);

async function main() {
  const customer = process.argv[2] || 'customer@example.com';
  const failureMode = process.argv[3] || 'success';
  const failTimes = Number(process.argv[4] || (failureMode === 'transient' ? 2 : 0));

  if (!validModes.has(failureMode)) {
    throw new Error('mode must be success, transient, or permanent');
  }
  if (!Number.isInteger(failTimes) || failTimes < 0) {
    throw new Error('failTimes must be a non-negative integer');
  }

  const order = {
    id: randomUUID(),
    customer,
    total: 4999,
    failureMode,
    failTimes,
    createdAt: new Date().toISOString(),
  };

  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createConfirmChannel();

  try {
    await channel.checkQueue(QUEUE);
    channel.publish(EXCHANGE, ROUTING_KEY, Buffer.from(JSON.stringify(order)), {
      persistent: true,
      contentType: 'application/json',
      messageId: order.id,
      type: 'ORDER_CREATED',
    });
    await channel.waitForConfirms();
    console.log('Published order:', order);
  } finally {
    await channel.close();
    await connection.close();
  }
}

main().catch((error) => {
  console.error('Could not publish order:', error.message);
  console.error('Run `npm run dlq:setup` before publishing.');
  process.exitCode = 1;
});
