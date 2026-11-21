# Learn RabbitMQ with Node.js

This small course teaches RabbitMQ by running real programs. Complete the five
lessons in order; each one adds a focused idea and the final two model real-world
worker behavior.

Before starting RabbitMQ, read [Docker, Compose, and the port-conflict lesson](./DOCKER-AND-PORTS.md).
It explains what Docker is, what `docker compose up` does, why the original start
failed, how we diagnosed it, and how host/container ports differ.

## Recommended learning order

1. Read `DOCKER-AND-PORTS.md` and run its inspection commands.
2. Start the broker and explore the management UI.
3. Complete Lesson 1 and inspect the queue after every action.
4. Complete Lesson 2 with two workers and observe acknowledgements.
5. Complete Lesson 3 and compare a queue with an exchange.
6. Complete Lessons 4 and 5 in [Real-world RabbitMQ lessons](./REAL-WORLD-LESSONS.md).
7. Do the practice challenges without copying the finished examples.

## The mental model

```text
Producer -> Exchange -> Queue -> Consumer
```

- A **producer** sends a message.
- An **exchange** decides which queue(s) receive it.
- A **queue** stores it until it can be handled.
- A **consumer** receives and processes it.
- An **acknowledgement (ack)** tells RabbitMQ that processing succeeded.

In lessons 1 and 2, `sendToQueue` uses RabbitMQ's unnamed default exchange, which
routes the message directly to the named queue. Lesson 3 uses an exchange
explicitly.

## Setup

You need Node.js 18+ and Docker.

```bash
cd /home/hari/learn/rabbitmq-node-learning
npm install
npm run rabbit:start
docker compose ps
```

If Docker reports that it cannot connect to the daemon, start Docker Desktop (or
the Docker service on Linux), then run `npm run rabbit:start` again.

Open the management UI at <http://localhost:15673>. Sign in with:

```text
username: learner
password: learner
```

This course uses host port `5673` for applications and `15673` for the browser UI.
Inside its container RabbitMQ still uses its standard ports. The alternate host
ports avoid conflicting with another RabbitMQ installation on this computer.

## Lesson 1: one producer, one consumer

Terminal 1:

```bash
npm run hello:receive
```

Terminal 2:

```bash
npm run hello:send -- "My first message"
```

Look at the `hello` queue in the management UI. Stop the receiver, send three
messages, and refresh the UI. Start the receiver again and watch the queue drain.

Read `src/01-hello/send.js` first, then `src/01-hello/receive.js`.

## Lesson 2: distribute jobs among workers

Start two workers in separate terminals:

```bash
npm run work:worker -- Alice
npm run work:worker -- Bob
```

From a third terminal, queue jobs. The last argument is simulated work time in
milliseconds:

```bash
npm run work:send -- one@example.com 5000
npm run work:send -- two@example.com 1000
npm run work:send -- three@example.com 2000
```

Each job goes to only one worker. `prefetch(1)` prevents a busy worker from
receiving another unacknowledged job. `ack` removes a completed job. Try stopping
a worker with Ctrl+C while it is busy and inspect what happens.

## Lesson 3: publish one event to many subscribers

Start two subscribers:

```bash
npm run pubsub:receive -- analytics
npm run pubsub:receive -- notifications
```

Then publish an event:

```bash
npm run pubsub:send -- "Hari created an account"
```

Both subscribers receive the same event because a `fanout` exchange copies it to
every bound queue. Start subscribers before publishing: these queues are temporary,
so events are not saved for subscribers that are offline.

## Lessons 4 and 5: production-style workers

Continue with [Real-world RabbitMQ lessons](./REAL-WORLD-LESSONS.md) to learn:

- concurrency, prefetch, backpressure, throughput, and graceful draining;
- transient versus permanent failures;
- delayed bounded retries and dead-letter queues;
- publisher confirms, at-least-once delivery, and idempotency.

## What to learn next

Use this order rather than trying to learn every RabbitMQ feature at once:

1. Routing keys with `direct` and `topic` exchanges.
2. Quorum queues and their delivery limits.
3. Multiple retry delays and exponential backoff.
4. Transactional outbox and inbox patterns.
5. Monitoring queue depth, processing rate, and unacknowledged messages.

Important production rule: RabbitMQ delivery is commonly **at least once**. A
consumer must be safe if it receives the same logical message more than once.

## Useful commands

```bash
npm run check                 # syntax-check every example
docker compose logs -f        # view RabbitMQ logs
docker compose ps             # view broker health
npm run rabbit:stop           # stop broker, preserve its data
docker compose down -v        # stop broker and erase this course's queues/data
```

To connect to a different broker, set `RABBITMQ_URL` before a command:

```bash
RABBITMQ_URL=amqp://user:pass@host:5673 npm run hello:send -- "Hello"
```

## Common problems

- `ECONNREFUSED`: RabbitMQ is not ready; check `docker compose ps` and logs.
- `ACCESS_REFUSED`: the username, password, or virtual host is incorrect.
- A channel closes after changing queue options: an existing queue has different
  settings. Delete that learning queue in the UI and run the example again.
- Port already in use: another service owns `5673` or `15673`. Choose free ports
  with `RABBITMQ_PORT=5674 RABBITMQ_MANAGEMENT_PORT=15674 npm run rabbit:start`,
  and set `RABBITMQ_URL` to the matching AMQP port when running the examples.

## Practice challenges

1. Add `subject` to the email task and print it in the worker.
2. Reject tasks whose email does not contain `@`.
3. Run three workers and predict which worker will receive each task.
4. Change the pub/sub exchange to `direct` and route `info` and `error` events to
   different subscribers.

Official references:

- <https://www.rabbitmq.com/tutorials/tutorial-one-javascript>
- <https://www.rabbitmq.com/tutorials/tutorial-two-javascript>
- <https://www.rabbitmq.com/tutorials/tutorial-three-javascript>
- <https://www.rabbitmq.com/tutorials/amqp-concepts>
