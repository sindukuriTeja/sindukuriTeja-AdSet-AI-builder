// Small retry helper for transient failures. The main real-world case this
// guards against: on Windows, antivirus scanners and cloud-sync clients
// (OneDrive, Dropbox) routinely grab a brief exclusive lock on a file right
// after it's created — long enough for a concurrent read/rename to fail with
// EBUSY/EPERM/EACCES. Bigger files take longer to write, so they're more
// likely to overlap one of these locks, which is why larger-canvas renders
// can fail intermittently on some machines while small ones never do.
// Retrying a couple of times with a short backoff resolves this without
// needing to know exactly which tool grabbed the lock.
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 200): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
  }
  throw lastErr;
}
