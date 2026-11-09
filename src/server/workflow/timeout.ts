import "server-only";

export class WorkflowTimeoutError extends Error {
  constructor() {
    super("Support workflow node timed out. Values are omitted.");
    this.name = "WorkflowTimeoutError";
  }
}

/**
 * Bounds one model call. The call itself is not cancelled. The node stops
 * waiting and takes the abstain path. A longer LangGraph node timeout is the
 * backstop when this timer does not win.
 */
export function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new WorkflowTimeoutError());
    }, timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new WorkflowTimeoutError());
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
