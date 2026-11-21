const amqp = require('amqplib');

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || 'amqp://learner:learner@localhost:5673';
const QUEUE = 'image_resize_jobs';
const workerName = process.argv[2] || `worker-${process.pid}`;
const concurrency = Number(
  process.argv[3] || process.env.WORKER_CONCURRENCY || 3,
);

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) {
  throw new Error('concurrency must be an integer between 1 and 50');
}

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();
  let active = 0;
  let completed = 0;
  let stopping = false;
  let resolveWhenIdle;

  await channel.assertQueue(QUEUE, { durable: true });

  // RabbitMQ will allow at most this many unacknowledged jobs for this consumer.
  await channel.prefetch(concurrency);

  const { consumerTag } = await channel.consume(
    QUEUE,
    async (message) => {
      if (!message) return;

      active += 1;
      try {
        const job = JSON.parse(message.content.toString());
        const startedAt = Date.now();
        console.log(
          `[${workerName}] START ${job.image} | active=${active}/${concurrency}`,
        );

        // This simulates asynchronous I/O such as uploading or calling an API.
        await wait(job.durationMs);

        channel.ack(message);
        completed += 1;
        console.log(
          `[${workerName}] DONE  ${job.image} in ${Date.now() - startedAt} ms | completed=${completed}`,
        );
      } catch (error) {
        console.error(`[${workerName}] rejected invalid job:`, error.message);
        channel.nack(message, false, false);
      } finally {
        active -= 1;
        if (stopping && active === 0 && resolveWhenIdle) resolveWhenIdle();
      }
    },
    { noAck: false },
  );

  console.log(
    `${workerName} is ready with concurrency=${concurrency}. Press Ctrl+C to stop.`,
  );

  async function shutdown() {
    if (stopping) return;
    stopping = true;
    console.log(`\n${workerName} is draining ${active} active job(s)...`);

    // Cancel first so RabbitMQ sends no new jobs, then finish in-flight work.
    await channel.cancel(consumerTag);
    if (active > 0) {
      await new Promise((resolve) => {
        resolveWhenIdle = resolve;
      });
    }

    await channel.close();
    await connection.close();
    console.log(`${workerName} stopped cleanly.`);
  }

  process.once('SIGINT', () => shutdown().catch(console.error));
  process.once('SIGTERM', () => shutdown().catch(console.error));
}

main().catch((error) => {
  console.error(`${workerName} failed:`, error.message);
  process.exitCode = 1;
});
