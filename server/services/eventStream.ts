import type { Request, Response } from "express";
import pg from "pg";
import { connection } from "../db/postgres.ts";
import { describeError, log } from "../lib/logger.ts";

const CHANNEL = "taskforge_events";
const MAX_CLIENTS = 100;
const MAX_BUFFER_BYTES = 1024 * 1024;

/** Fans Postgres NOTIFY out to browsers over Server-Sent Events. */
export class EventStream {
  #clients = new Set<Response>();
  #listener: pg.Client | null = null;
  #reconnect: NodeJS.Timeout | undefined;
  #ping: NodeJS.Timeout | undefined;
  #stopped = false;

  async start() {
    this.#ping = setInterval(() => this.#send(": ping\n\n"), 15_000);
    await this.#listen();
  }

  async #listen() {
    const client = new pg.Client(connection);
    let lost = false;
    const onLost = (error?: unknown) => {
      if (lost || this.#stopped) return;
      lost = true;
      log.warn("event listener disconnected", { error: error ? describeError(error) : "closed" });
      this.#listener = null;
      void client.end().catch(() => {});
      this.#reconnect = setTimeout(() => void this.#listen(), 1000);
    };

    client.on("error", onLost);
    client.on("end", () => onLost());
    client.on("notification", ({ payload }) => {
      if (payload) this.#send(`event: job\ndata: ${payload}\n\n`);
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      if (this.#stopped) return void (await client.end());
      this.#listener = client;
      // Anything committed while we were away was missed, so tell browsers to refetch.
      this.#send("event: resync\ndata: {}\n\n");
    } catch (error) {
      onLost(error);
    }
  }

  #send(frame: string) {
    for (const response of this.#clients) {
      if (response.writableLength > MAX_BUFFER_BYTES) {
        // A reader this slow gets dropped. EventSource reconnects and refetches.
        this.#clients.delete(response);
        response.destroy();
      } else {
        response.write(frame);
      }
    }
  }

  subscribe = (request: Request, response: Response) => {
    if (this.#clients.size >= MAX_CLIENTS) {
      response.status(503).json({ error: "Too many live connections", code: "stream_full" });
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write("retry: 2000\nevent: resync\ndata: {}\n\n");
    this.#clients.add(response);
    request.on("close", () => this.#clients.delete(response));
  };

  async stop() {
    this.#stopped = true;
    clearTimeout(this.#reconnect);
    clearInterval(this.#ping);
    for (const response of this.#clients) response.end();
    await this.#listener?.end().catch(() => {});
  }
}
