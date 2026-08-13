import { resolve } from "node:path";
import { startProdServer } from "vinext/server/prod-server";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

await startProdServer({
  host: process.env.HOST ?? "127.0.0.1",
  port,
  outDir: resolve("dist"),
});

