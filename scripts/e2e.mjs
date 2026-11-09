import { spawn } from "node:child_process";

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;

const server = spawn(
  "npm",
  ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_APP_URL: baseURL,
      AUTH_SECRET:
        process.env.AUTH_SECRET ?? "playwright-not-a-production-secret",
    },
  },
);

let stopped = false;

function stopServer() {
  if (stopped) {
    return;
  }
  stopped = true;
  server.kill("SIGTERM");
}

process.on("exit", stopServer);
process.on("SIGINT", () => {
  stopServer();
  process.exit(1);
});

const ready = await waitForServer(baseURL);
if (!ready) {
  stopServer();
  console.error("The customer chat server did not become ready.");
  process.exit(1);
}

const tests = spawn("npx", ["playwright", "test"], {
  stdio: "inherit",
  env: process.env,
});

const exitCode = await new Promise((resolve) => {
  tests.on("exit", (code) => resolve(code ?? 1));
});
stopServer();
process.exit(exitCode);

async function waitForServer(url) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        return true;
      }
    } catch {
      // The port can drop a connection until Next is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}
