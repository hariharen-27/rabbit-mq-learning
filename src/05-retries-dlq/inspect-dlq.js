const amqp = require('amqplib');

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || 'amqp://learner:learner@localhost:5673';
const DEAD_QUEUE = 'orders.dead';

async function main() {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();

  try {
    await channel.checkQueue(DEAD_QUEUE);
    const message = await channel.get(DEAD_QUEUE, { noAck: false });

    if (!message) {
      console.log('The dead-letter queue is empty.');
      return;
    }

    console.log('Dead-lettered order:', JSON.parse(message.content.toString()));
    console.log('Headers:', JSON.stringify(message.properties.headers, null, 2));

    // This is an inspector, not a recovery tool, so put the message back.
    channel.nack(message, false, true);
  } finally {
    await channel.close();
    await connection.close();
  }
}

main().catch((error) => {
  console.error('Could not inspect dead-letter queue:', error.message);
  console.error('Run `npm run dlq:setup` first.');
  process.exitCode = 1;
});
