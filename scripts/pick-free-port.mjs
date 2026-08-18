import { createServer } from "node:net";

export async function pickFreePort(host = "127.0.0.1") {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) {
    throw new Error("failed to allocate a free port");
  }
  return port;
}

export async function pickDistinctFreePort(excludedPorts, host = "127.0.0.1", maxAttempts = 16) {
  const excluded = new Set(Array.from(excludedPorts ?? []).map((value) => Number(value)).filter((value) => Number.isFinite(value)));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const port = await pickFreePort(host);
    if (!excluded.has(port)) return port;
  }
  throw new Error(`failed to allocate a distinct free port after ${maxAttempts} attempts`);
}
