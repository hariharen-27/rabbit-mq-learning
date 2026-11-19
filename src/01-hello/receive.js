const amqp = require('amqplib');

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || 'amqp://learner:learner@localhost:5673';
const QUEUE = 'hello';

async function main() {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();

  await channel.assertQueue(QUEUE, { durable: true });
  console.log(`Waiting for messages in "${QUEUE}". Press Ctrl+C to stop.`);

  await channel.consume(
    QUEUE,
    (message) => {
      if (!message) return;

      console.log(`Received: ${message.content.toString()}`);
      // RabbitMQ can now safely remove this message from the queue.
      channel.ack(message);
    },
    { noAck: false },
  );

  async function shutdown() {
    console.log('\nClosing connection...');
    await channel.close();
    await connection.close();
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Consumer failed:', error.message);
  process.exitCode = 1;
});
