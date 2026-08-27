import { describe, expect, it, vi } from "vitest";

import { createRequestQueue } from "../src/utils/requestQueue";

/** Promise controlada de fora, para segurar tarefas no meio do voo. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createRequestQueue", () => {
  it("never runs more tasks at once than the concurrency limit", async () => {
    const queue = createRequestQueue(2);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    let running = 0;
    let peak = 0;

    const tasks = gates.map((gate) =>
      queue.enqueue(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await gate.promise;
        running -= 1;
      })
    );

    await flush();
    expect(peak).toBe(2);

    gates.forEach((gate) => gate.resolve());
    await Promise.all(tasks);
    expect(peak).toBe(2);
  });

  it("starts a queued task as soon as a slot frees up", async () => {
    const queue = createRequestQueue(1);
    const first = deferred();
    const started: string[] = [];

    const a = queue.enqueue(async () => {
      started.push("a");
      await first.promise;
    });
    const b = queue.enqueue(() => {
      started.push("b");
    });

    await flush();
    expect(started).toEqual(["a"]);

    first.resolve();
    await Promise.all([a, b]);
    expect(started).toEqual(["a", "b"]);
  });

  it("resolves and rejects with the task's own outcome", async () => {
    const queue = createRequestQueue(2);

    await expect(queue.enqueue(() => "ok")).resolves.toBe("ok");
    await expect(
      queue.enqueue(() => Promise.reject(new Error("boom")))
    ).rejects.toThrow("boom");
  });

  it("keeps draining after a task throws synchronously", async () => {
    const queue = createRequestQueue(1);

    await expect(
      queue.enqueue(() => {
        throw new Error("sync");
      })
    ).rejects.toThrow("sync");

    await expect(queue.enqueue(() => "after")).resolves.toBe("after");
  });

  it("dispatches nothing while the gate holds, then releases every task", async () => {
    const gate = deferred();
    let held = true;
    const queue = createRequestQueue(4, () => (held ? gate.promise : null));

    const started: number[] = [];
    const tasks = [0, 1, 2].map((index) =>
      queue.enqueue(() => {
        started.push(index);
      })
    );

    await flush();
    // O portão segura a fila inteira: nenhum slot é gasto esperando.
    expect(started).toEqual([]);

    held = false;
    gate.resolve();
    await Promise.all(tasks);
    expect(started).toEqual([0, 1, 2]);
  });

  it("does not consult the gate when there is nothing queued", async () => {
    let calls = 0;
    const queue = createRequestQueue(2, () => {
      calls += 1;
      return null;
    });

    expect(calls).toBe(0);
    await queue.enqueue(() => "done");
    expect(calls).toBe(1);
  });

  it("frees the slot and rejects when a task hangs past the timeout", async () => {
    vi.useFakeTimers();
    try {
      const queue = createRequestQueue(1, undefined, 1000);
      const hung = deferred();
      const started: string[] = [];

      const a = queue.enqueue(async () => {
        started.push("a");
        await hung.promise;
      });
      const b = queue.enqueue(() => {
        started.push("b");
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(started).toEqual(["a"]);

      await Promise.all([
        vi.advanceTimersByTimeAsync(1000),
        expect(a).rejects.toThrow("timed out"),
      ]);

      await vi.advanceTimersByTimeAsync(0);
      expect(started).toEqual(["a", "b"]);
      await b;

      hung.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not double-settle a task that resolves right at the timeout boundary", async () => {
    vi.useFakeTimers();
    try {
      const queue = createRequestQueue(1, undefined, 1000);
      const gate = deferred<string>();

      const task = queue.enqueue(() => gate.promise);
      await vi.advanceTimersByTimeAsync(0);
      gate.resolve("ok");
      await vi.advanceTimersByTimeAsync(1000);

      await expect(task).resolves.toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });
});
