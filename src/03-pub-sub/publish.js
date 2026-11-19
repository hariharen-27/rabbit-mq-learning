const amqp = require('amqplib');

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || 'amqp://learner:learner@localhost:5673';
const EXCHANGE = 'app_events';

async function main() {
  const text = process.argv.slice(2).join(' ') || 'A user signed up';
  const event = { type: 'USER_SIGNED_UP', text, at: new Date().toISOString() };
  const connection = await amqp.connect(RABBITMQ_URL);

  try {
    const channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGE, 'fanout', { durable: false });

    // A fanout exchange copies the event to every queue bound to it.
    channel.publish(EXCHANGE, '', Buffer.from(JSON.stringify(event)), {
      contentType: 'application/json',
    });
    console.log('Published event:', event);
    await channel.close();
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error('Could not publish event:', error.message);
  process.exitCode = 1;
});
