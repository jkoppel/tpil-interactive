// A connection to a Lean language server over the WebSocket bridge in server/server.mjs.
//
// Each example is its own virtual file. The server starts a worker process per open file, so at
// most MAX_OPEN files stay open; the least recently used one is closed to make room, and reopened
// when its editor is used again.

const MAX_OPEN = 6;

export class LeanSession {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.docs = new Map(); // uri -> { text, version, client, open, lastUsed }
    this.ready = null;
    this.statusListeners = new Set();
    this.status = "idle";
  }

  onStatus(fn) {
    this.statusListeners.add(fn);
    fn(this.status);
  }

  setStatus(status) {
    this.status = status;
    for (const fn of this.statusListeners) fn(status);
  }

  /** Connects if needed; resolves once the server is initialized. */
  connect() {
    if (this.ready) return this.ready;
    this.setStatus("connecting");
    this.ready = new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = async () => {
        try {
          await this.request("initialize", {
            processId: null,
            rootUri: null,
            capabilities: { textDocument: { hover: { contentFormat: ["markdown", "plaintext"] } } },
          });
          this.notify("initialized", {});
          this.setStatus("ready");
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      ws.onmessage = (ev) => this.receive(JSON.parse(ev.data));
      ws.onerror = () => {};
      ws.onclose = () => {
        this.ready = null;
        this.setStatus("disconnected");
        for (const { reject: r } of this.pending.values()) r(new Error("Lean server disconnected"));
        this.pending.clear();
        for (const doc of this.docs.values()) {
          doc.open = false;
          doc.client.onDisconnect?.();
        }
        reject(new Error("Lean server disconnected"));
      };
    });
    return this.ready;
  }

  send(msg) {
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", ...msg }));
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ id, method, params });
    });
  }

  notify(method, params) {
    this.send({ method, params });
  }

  receive(msg) {
    if (msg.method === undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message), msg.error));
      else p.resolve(msg.result);
      return;
    }
    if (msg.id !== undefined) {
      // A request from the server (capability registration, refreshes): acknowledge it.
      this.send({ id: msg.id, result: null });
      return;
    }
    const uri = msg.params?.uri ?? msg.params?.textDocument?.uri;
    const doc = uri && this.docs.get(uri);
    if (!doc) return;
    if (msg.method === "textDocument/publishDiagnostics") {
      doc.client.onDiagnostics(msg.params.diagnostics, msg.params.version);
    } else if (msg.method === "$/lean/fileProgress") {
      doc.client.onProgress(msg.params.processing, msg.params.textDocument.version);
    }
  }

  /**
   * Opens or updates a file. `client` receives onDiagnostics, onProgress, and onDisconnect.
   * Returns the version number sent.
   */
  async sync(uri, text, client) {
    await this.connect();
    let doc = this.docs.get(uri);
    if (!doc) {
      doc = { text, version: 0, client, open: false };
      this.docs.set(uri, doc);
    }
    doc.lastUsed = performance.now();
    if (!doc.open) {
      this.evictFor(uri);
      doc.open = true;
      doc.text = text;
      doc.version++;
      this.notify("textDocument/didOpen", {
        textDocument: { uri, languageId: "lean4", version: doc.version, text },
      });
    } else if (doc.text !== text) {
      doc.text = text;
      doc.version++;
      this.notify("textDocument/didChange", {
        textDocument: { uri, version: doc.version },
        contentChanges: [{ text }],
      });
    }
    return doc.version;
  }

  isOpen(uri) {
    return this.docs.get(uri)?.open ?? false;
  }

  evictFor(uri) {
    const open = [...this.docs.entries()].filter(([u, d]) => d.open && u !== uri);
    open.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (open.length >= MAX_OPEN) {
      const [victim, doc] = open.shift();
      doc.open = false;
      this.notify("textDocument/didClose", { textDocument: { uri: victim } });
      doc.client.onEvicted?.();
    }
  }

  touch(uri) {
    const doc = this.docs.get(uri);
    if (doc) doc.lastUsed = performance.now();
  }
}
