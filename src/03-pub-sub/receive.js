const amqp = require('amqplib');

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || 'amqp://learner:learner@localhost:5673';
const EXCHANGE = 'app_events';
const subscriberName = process.argv[2] || `subscriber-${process.pid}`;

async function main() {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE, 'fanout', { durable: false });
  // RabbitMQ chooses a temporary queue name and deletes it on disconnect.
  const { queue } = await channel.assertQueue('', { exclusive: true });
  await channel.bindQueue(queue, EXCHANGE, '');

  console.log(`${subscriberName} is listening. Press Ctrl+C to stop.`);
  await channel.consume(
    queue,
    (message) => {
      if (!message) return;
      const event = JSON.parse(message.content.toString());
      console.log(`${subscriberName} received:`, event);
    },
    { noAck: true },
  );

  async function shutdown() {
    console.log(`\nStopping ${subscriberName}...`);
    await channel.close();
    await connection.close();
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(`${subscriberName} failed:`, error.message);
  process.exitCode = 1;
});
