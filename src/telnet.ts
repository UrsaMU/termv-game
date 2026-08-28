import { startTelnetServer } from "@ursamu/mush";
import { getConfig, initConfig } from "@ursamu/core";

// Bind telnet → hub WebSocket using server.wsPort (not server.http).
// Published @ursamu/mush historically preferred server.http here, which
// breaks when WS and HTTP are on different ports (4202 vs 4203).
await initConfig();
const wsPort =
  getConfig<number>("server.wsPort") ??
  getConfig<number>("server.ws") ??
  4202;

await startTelnetServer({ wsPort });

console.log(`Telnet server is running! (hub ws://localhost:${wsPort})`);
