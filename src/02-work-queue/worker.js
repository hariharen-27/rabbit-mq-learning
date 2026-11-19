const amqp = require('amqplib');

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || 'amqp://learner:learner@localhost:5673';
const QUEUE = 'email_tasks';
const workerName = process.argv[2] || `worker-${process.pid}`;

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();

  await channel.assertQueue(QUEUE, { durable: true });

  // Give this worker only one unacknowledged job at a time.
  // With multiple workers, the next free worker receives the next job.
  await channel.prefetch(1);
  console.log(`${workerName} is waiting for tasks. Press Ctrl+C to stop.`);

  await channel.consume(
    QUEUE,
    async (message) => {
      if (!message) return;

      try {
        const task = JSON.parse(message.content.toString());
        console.log(`${workerName} started ${task.id} for ${task.email}`);

        await wait(task.durationMs);

        console.log(`${workerName} finished ${task.id}`);
        channel.ack(message);
      } catch (error) {
        console.error(`${workerName} rejected a bad task:`, error.message);
        // false, false means: do not acknowledge and do not requeue.
        channel.nack(message, false, false);
      }
    },
    { noAck: false },
  );

  async function shutdown() {
    console.log(`\nStopping ${workerName}...`);
    await channel.close();
    await connection.close();
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(`${workerName} failed:`, error.message);
  process.exitCode = 1;
});
