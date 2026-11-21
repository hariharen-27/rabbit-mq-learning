const amqp = require('amqplib');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || 'amqp://learner:learner@localhost:5673';
const QUEUE = 'image_resize_jobs';

async function main() {
  const jobCount = Number(process.argv[2] || 12);
  const durationMs = Number(process.argv[3] || 2000);

  if (!Number.isInteger(jobCount) || jobCount < 1 || jobCount > 1000) {
    throw new Error('jobCount must be an integer between 1 and 1000');
  }
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error('durationMs must be a non-negative number');
  }

  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createConfirmChannel();

  try {
    await channel.assertQueue(QUEUE, { durable: true });

    for (let index = 1; index <= jobCount; index += 1) {
      const job = {
        id: randomUUID(),
        image: `photo-${index}.jpg`,
        durationMs,
        createdAt: new Date().toISOString(),
      };

      const writeBufferHasSpace = channel.sendToQueue(
        QUEUE,
        Buffer.from(JSON.stringify(job)),
        {
          persistent: true,
          contentType: 'application/json',
          messageId: job.id,
        },
      );

      // Publisher-side backpressure protects memory for very large batches.
      if (!writeBufferHasSpace) await once(channel, 'drain');
    }

    // A confirm channel lets the broker confirm that it accepted the batch.
    await channel.waitForConfirms();
    console.log(`Published ${jobCount} jobs (${durationMs} ms each) to ${QUEUE}.`);
  } finally {
    await channel.close();
    await connection.close();
  }
}

main().catch((error) => {
  console.error('Could not publish jobs:', error.message);
  process.exitCode = 1;
});
