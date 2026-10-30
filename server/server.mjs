// Serves the built book and bridges each browser tab to its own `lean --server`.
//
// The browser speaks JSON-RPC messages over a WebSocket at /lsp; this process adds and strips the
// LSP base-protocol framing (Content-Length headers) on the Lean server's stdio.
//
// Lean code can run arbitrary IO through `#eval`, so the server listens on localhost only and
// rejects WebSocket connections from any other origin.

import { spawn } from "node:child_process";
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";

const ROOT = new URL("..", import.meta.url).pathname;
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 8742);
const HOST = "127.0.0.1";
const MAX_SESSIONS = 8;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let path = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!path.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (statSync(path).isDirectory()) {
      if (!url.pathname.endsWith("/")) {
        res.writeHead(301, { Location: url.pathname + "/" + url.search }).end();
        return;
      }
      path = join(path, "index.html");
    }
    const size = statSync(path).size;
    res.writeHead(200, {
      "Content-Type": MIME[extname(path)] ?? "application/octet-stream",
      "Content-Length": size,
      "Cache-Control": "no-cache",
    });
    createReadStream(path).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}

/** Splits Content-Length-framed messages out of a byte stream. */
class FrameReader {
  buffer = Buffer.alloc(0);
  constructor(onMessage) {
    this.onMessage = onMessage;
  }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      this.onMessage(this.buffer.subarray(start, start + length).toString("utf8"));
      this.buffer = this.buffer.subarray(start + length);
    }
  }
}

const server = createServer(serveStatic);
const wss = new WebSocketServer({ noServer: true });
let sessions = 0;

server.on("upgrade", (req, socket, head) => {
  const origin = req.headers.origin;
  const allowed = [`http://${req.headers.host}`];
  if (new URL(req.url, "http://x").pathname !== "/lsp" || !allowed.includes(origin)
      || !/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host ?? "")) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  if (sessions >= MAX_SESSIONS) {
    socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => startSession(ws));
});

function startSession(ws) {
  sessions++;
  // `lean` is elan's proxy; it picks the toolchain from ROOT/lean-toolchain.
  const lean = spawn("lean", ["--server"], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
  const reader = new FrameReader((msg) => ws.readyState === ws.OPEN && ws.send(msg));
  lean.stdout.on("data", (c) => reader.push(c));
  lean.stderr.on("data", (c) => process.stderr.write(`[lean] ${c}`));
  lean.on("exit", (code) => {
    if (ws.readyState === ws.OPEN) ws.close(1011, `lean exited with ${code}`);
  });
  lean.stdin.on("error", () => {});
  ws.on("message", (data) => {
    const body = Buffer.from(data.toString(), "utf8");
    lean.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    lean.stdin.write(body);
  });
  ws.on("close", () => {
    sessions--;
    lean.kill();
  });
}

server.listen(PORT, HOST, () => {
  console.log(`Theorem Proving in Lean 4 (interactive) at http://localhost:${PORT}/`);
});
