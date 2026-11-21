# Real-world RabbitMQ lessons

These labs build on the first three lessons. They model image-processing jobs and
order-payment failures so you can observe production concerns instead of only
sending “hello” messages.

## Lesson 4: concurrency and backpressure

### The problem

One worker processing one job at a time can be too slow. Giving a consumer an
unlimited number of jobs is also unsafe: deliveries waiting inside the Node.js
process consume memory and are invisible as “ready” work to other consumers.

RabbitMQ's **prefetch** count limits the number of delivered but unacknowledged
messages. This creates backpressure:

```text
queue -> at most N unacknowledged jobs -> worker
                    prefetch=N
```

The example uses the same number for its async processing concurrency and its
prefetch window. With concurrency 3, the log should never show `active=4/3`.
The batch publisher separately respects Node.js stream backpressure when its
outgoing socket buffer fills, then waits for RabbitMQ publisher confirmations.

### Run the lab

Terminal 1:

```bash
npm run concurrency:worker -- image-worker-A 3
```

Terminal 2:

```bash
npm run concurrency:publish -- 12 2000
```

Twelve jobs at two seconds each would take about 24 seconds sequentially. With
three concurrent async slots, expect roughly four waves, or about eight seconds
plus overhead.

Now add a second process in Terminal 3:

```bash
npm run concurrency:worker -- image-worker-B 3
```

Publish another batch. The theoretical in-flight maximum is now:

```text
worker processes x concurrency per worker = 2 x 3 = 6
```

### Concurrency is not always parallelism

The lab uses `setTimeout` to simulate asynchronous I/O. Node.js can overlap work
while it waits for databases, APIs, or file operations. CPU-heavy JavaScript still
runs on the main event-loop thread. For CPU work such as actual image encoding,
use worker threads, child processes, or multiple container replicas.

Increasing concurrency also increases pressure on downstream systems. A database
pool with 10 connections cannot support 100 simultaneous database operations just
because the RabbitMQ worker has concurrency 100. Tune using measurements:

- queue depth and message age;
- unacknowledged messages;
- processing latency and error rate;
- worker CPU and memory;
- downstream rate limits and connection pools.

Order is another tradeoff. Concurrent jobs can finish in a different order from
the order in which RabbitMQ delivered them. Use concurrency 1 or partition work by
an entity key when strict per-entity ordering matters.

## Lesson 5: retries and a dead-letter queue

### Classify failures first

- **Transient**: a timeout, temporary database outage, or HTTP 503 may succeed
  later. Retry it with a delay and a maximum attempt count.
- **Permanent**: invalid data, a missing required field, or an unsupported value
  will not improve with time. Dead-letter it immediately.
- **Unknown infrastructure failure**: preserve the original delivery while the
  worker or broker recovers; never silently acknowledge it.

Blindly using `nack(message, false, true)` for every failure can create an instant,
infinite retry loop that consumes CPU and floods logs.

### Topology

```text
orders.exchange
      |
      v
 orders.work ---- permanent / retries exhausted ----> orders.dlx -> orders.dead
      ^
      |
 retry TTL expires after 5 seconds
      |
 orders.retry.5s <---- orders.retry.exchange
```

The retry queue holds messages for five seconds. Its policy then dead-letters
expired messages back to the work exchange. Final failures are negatively
acknowledged without requeueing, so the work queue's policy routes them to the
dead-letter exchange and then `orders.dead`.

### Create the topology

Run this once, or again whenever you want to ensure it exists:

```bash
npm run dlq:setup
```

The setup uses RabbitMQ **policies** for dead-letter and TTL behavior. Policies are
preferable to hard-coded queue `x-arguments` because an operator can change them
without deleting and redeclaring the application queue.

Open <http://localhost:15673>, then inspect Queues and Streams and Admin > Policies.

### Start the order worker

```bash
npm run dlq:worker -- payment-worker
```

In another terminal, publish three kinds of orders:

```bash
# Completes on the first attempt
npm run dlq:publish -- good@example.com success

# Fails twice, waits about 5 seconds between attempts, then succeeds
npm run dlq:publish -- slow@example.com transient 2

# Cannot succeed and goes directly to orders.dead
npm run dlq:publish -- invalid@example.com permanent
```

To exceed the configured maximum of three retries:

```bash
npm run dlq:publish -- outage@example.com transient 10
```

Inspect one dead letter without removing it:

```bash
npm run dlq:inspect
```

Notice RabbitMQ's `x-death` header. It records facts such as the source queue,
reason, exchange, routing key, time, and death count. The application-managed
`x-retry-count` header records retry attempts before final dead-lettering.

### Why the worker republishes before acknowledging

For a transient failure, the worker performs this order:

1. Publish a copy to the retry exchange.
2. Wait for a publisher confirmation from RabbitMQ.
3. Acknowledge the original work message.

Acknowledging first creates a loss window: the process could crash after removing
the original but before publishing its retry. If retry publishing fails in this
lab, the original remains unacknowledged and can be redelivered.

### At-least-once delivery and idempotency

A worker can finish an external side effect and crash before its acknowledgement
reaches RabbitMQ. The message may then be delivered again. Therefore payment
capture, email sending, and order updates should be idempotent.

The order's `id` is an idempotency key. A real payment worker could store that ID
in a database table with a unique constraint in the same transaction as its local
state change. Seeing the same ID again should return the recorded result rather
than charging twice. An in-memory `Set` is not sufficient because it disappears
when the process restarts and is not shared between replicas.

### Operating a DLQ

A DLQ is not a rubbish bin. In production, monitor its depth and oldest-message
age, alert the owning team, retain enough context to diagnose the failure, and use
an audited replay tool after fixing the cause. Replaying without fixing the cause
usually creates another failure loop.

## Practice exercises

1. Run the concurrency worker with 1, 3, and 10 slots. Measure total batch time.
2. Start two workers with different concurrency values and observe distribution.
3. Stop a concurrency worker while jobs are active. Confirm that it drains before
   closing.
4. Change the retry TTL policy from 5000 to 15000 ms in `setup.js` and observe the
   delay in the management UI.
5. Add a second retry queue to model exponential backoff, for example 5 seconds
   followed by 30 seconds.
6. Design a database table for idempotent order processing using `order.id` as a
   unique key.

Official references:

- <https://www.rabbitmq.com/docs/consumer-prefetch>
- <https://www.rabbitmq.com/docs/confirms>
- <https://www.rabbitmq.com/docs/dlx>
