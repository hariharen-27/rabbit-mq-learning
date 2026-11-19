const amqp = require('amqplib');
const { randomUUID } = require('node:crypto');

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || 'amqp://learner:learner@localhost:5673';
const QUEUE = 'email_tasks';

async function main() {
  const email = process.argv[2] || 'student@example.com';
  const durationMs = Number(process.argv[3] || 2000);

  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error('durationMs must be a non-negative number');
  }

  const task = {
    id: randomUUID(),
    type: 'SEND_WELCOME_EMAIL',
    email,
    durationMs,
    createdAt: new Date().toISOString(),
  };

  const connection = await amqp.connect(RABBITMQ_URL);

  try {
    const channel = await connection.createChannel();
    await channel.assertQueue(QUEUE, { durable: true });
    channel.sendToQueue(QUEUE, Buffer.from(JSON.stringify(task)), {
      persistent: true,
      contentType: 'application/json',
    });
    console.log('Queued task:', task);
    await channel.close();
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error('Could not queue task:', error.message);
  process.exitCode = 1;
});
