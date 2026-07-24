import { loadGatewayConfig, missingGatewayConfiguration } from "./config.js";
import { createGatewayServer } from "./server.js";

const config = loadGatewayConfig();
const server = createGatewayServer(config);

server.listen(config.port, "0.0.0.0", () => {
  const missing = missingGatewayConfiguration(config);
  console.log(JSON.stringify({
    event: "gateway_started",
    port: config.port,
    model: config.upstreamModel,
    configured: !missing.length,
    ...(missing.length ? { missing } : {}),
  }));
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
