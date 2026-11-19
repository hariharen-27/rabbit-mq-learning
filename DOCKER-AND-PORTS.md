# Docker, Docker Compose, and the port-conflict lesson

This guide explains the infrastructure behind the RabbitMQ examples. Run each
command instead of only reading it. The goal is to understand why it works.

## 1. What Docker does

Normally, installing RabbitMQ directly also requires installing and configuring
Erlang. Docker lets us run RabbitMQ in an isolated **container** instead.

The important terms are:

- **Image**: a read-only package containing RabbitMQ and its runtime.
- **Container**: a running instance of that image.
- **Port mapping**: a route from a port on your computer to a port in a container.
- **Volume**: persistent storage that survives replacing a container.
- **Network**: a private network on which Compose services can find each other.

An image is like a class; a container is like an object created from that class.
Stopping a container does not uninstall Docker or delete the image.

## 2. What Docker Compose adds

`docker run` can start one container using a long command. Docker Compose stores
that configuration in `docker-compose.yml`, making it repeatable and readable.

This project has one Compose service named `rabbitmq`. Important parts are:

```yaml
services:
  rabbitmq:
    image: rabbitmq:4.3-management
    ports:
      - "${RABBITMQ_PORT:-5673}:5672"
      - "${RABBITMQ_MANAGEMENT_PORT:-15673}:15672"
    environment:
      RABBITMQ_DEFAULT_USER: learner
      RABBITMQ_DEFAULT_PASS: learner
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
```

`rabbitmq:4.3-management` includes RabbitMQ plus its browser management plugin.
The environment values create the learning login. The named volume preserves
queues and messages when the container is stopped and started again.

See the exact configuration after variable substitution:

```bash
docker compose config
```

## 3. Understand `HOST:CONTAINER` ports

A Compose mapping has this order:

```text
HOST_PORT:CONTAINER_PORT
```

For this project:

```text
Node.js -> localhost:5673 -> container:5672 -> RabbitMQ AMQP
Browser -> localhost:15673 -> container:15672 -> Management UI
```

RabbitMQ still listens on its normal ports *inside* the container. We changed
only the ports used to enter the container from the host computer.

Two processes cannot listen on the same host IP and TCP port simultaneously.
However, many containers can use port `5672` internally because each container
has its own network namespace. Their host-side ports must be different.

## 4. Why the original command failed

The original Compose mappings tried to use these host ports:

```yaml
- "5672:5672"
- "15672:15672"
```

But RabbitMQ was already installed directly on this computer and was listening
on both host ports. When Docker tried to claim `15672`, the operating system
refused and returned:

```text
bind: address already in use
```

The useful parts of that message are:

- `0.0.0.0:15672`: Docker tried to listen on port 15672 on every host interface.
- `bind`: it asked the operating system to reserve that address.
- `address already in use`: another process had already reserved it.

This was a networking conflict, not a Node.js or RabbitMQ-code error.

## 5. How to diagnose this yourself

First, ask Docker which containers are running and which ports they publish:

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
```

Then inspect host listeners on Linux:

```bash
ss -ltnp | grep -E ':5672|:15672'
```

If permitted, `lsof` can identify the owning process:

```bash
lsof -nP -iTCP:15672 -sTCP:LISTEN
```

In our diagnosis, both ports were listening but `docker ps` showed no owning
container. The management endpoint also answered successfully:

```bash
curl -I http://localhost:15672
```

Together, those facts indicated a RabbitMQ process running directly on the host.

## 6. The safe fix used by this project

We left the existing RabbitMQ installation untouched and changed this course to:

```yaml
- "${RABBITMQ_PORT:-5673}:5672"
- "${RABBITMQ_MANAGEMENT_PORT:-15673}:15672"
```

`${NAME:-value}` means “use environment variable `NAME`, or use `value` when it
is not set.” Therefore the default host ports are `5673` and `15673`, but they
remain configurable.

If those ports are also occupied, choose different ones:

```bash
RABBITMQ_PORT=5674 RABBITMQ_MANAGEMENT_PORT=15674 docker compose up -d
```

The Node.js programs must then use the matching AMQP port:

```bash
RABBITMQ_URL=amqp://learner:learner@localhost:5674 \
  npm run hello:send -- "Hello on 5674"
```

The host port changes; the container-side ports stay `5672` and `15672`.

## 7. What the everyday Compose commands do

Start the services in the background:

```bash
docker compose up -d
```

`up` creates the network, volume, and container if needed, then starts the
service. `-d` means detached, so the terminal is returned to you.

Inspect current state and health:

```bash
docker compose ps
```

Follow the broker logs; press Ctrl+C to stop following without stopping RabbitMQ:

```bash
docker compose logs -f rabbitmq
```

Stop and remove this project's container and network:

```bash
docker compose down
```

The named volume remains, so data survives. This command additionally deletes
the volume and therefore the learning queues and messages:

```bash
docker compose down -v
```

Use `down -v` only when you intentionally want a clean broker. It is a destructive
reset of this Compose project's RabbitMQ data.

## 8. Start and verify the complete stack

From the project directory:

```bash
npm install
npm run rabbit:start
docker compose ps
```

The status should eventually contain `healthy`. Open
<http://localhost:15673> and sign in with `learner` / `learner`.

Now test the path through every component. Terminal 1:

```bash
npm run hello:receive
```

Terminal 2:

```bash
npm run hello:send -- "Docker and RabbitMQ are connected"
```

The flow is:

```text
send.js
  -> amqplib TCP connection to localhost:5673
  -> Docker forwards traffic to container port 5672
  -> RabbitMQ stores the message in the hello queue
  -> RabbitMQ delivers it to receive.js
  -> receive.js acknowledges it
  -> RabbitMQ removes it from the queue
```

## 9. Practice exercises

1. Run `docker compose ps` and explain every column in your own words.
2. Stop RabbitMQ with `docker compose down`; predict what the Node.js sender does.
3. Start it again and check whether the `hello` queue remains. Explain the volume's
   role.
4. Change only the management host port to `15674`; predict whether Node.js needs
   a configuration change.
5. Use `docker compose logs -f rabbitmq`, send a message, and look for connection
   lifecycle events.
6. Draw the host and container as two boxes, then label all four port numbers.

If you can explain exercises 3 and 4 without guessing, you understand the most
important Docker concepts used by this course.
