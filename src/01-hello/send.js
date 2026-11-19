const amqp = require('amqplib');

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || 'amqp://learner:learner@localhost:5673';
const QUEUE = 'hello';

async function main() {
  const message = process.argv.slice(2).join(' ') || 'Hello RabbitMQ!';
  const connection = await amqp.connect(RABBITMQ_URL);

  try {
    const channel = await connection.createChannel();

    // A queue must exist before a message can be stored in it.
    await channel.assertQueue(QUEUE, { durable: true });
    channel.sendToQueue(QUEUE, Buffer.from(message), { persistent: true });

    console.log(`Sent: ${message}`);
    await channel.close();
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error('Could not send message:', error.message);
  process.exitCode = 1;
});
