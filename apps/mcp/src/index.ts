#!/usr/bin/env node
import { createInterface } from "node:readline";
import { handleMessage, type JsonRpcRequest } from "./server.js";

export * from "./server.js";

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  if (!line.trim()) return;
  void (async () => {
    try {
      const request = JSON.parse(line) as JsonRpcRequest;
      const response = await handleMessage(request);
      if (response) process.stdout.write(JSON.stringify(response) + "\n");
    } catch (error) {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: error instanceof Error ? error.message : "Parse error" },
      }) + "\n");
    }
  })();
});
