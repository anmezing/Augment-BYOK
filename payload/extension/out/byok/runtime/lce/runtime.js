"use strict";

const { info, warn } = require("../../infra/log");
const { startWatching, stopWatching } = require("./auto-index");
const { createLceMcpToolsRuntime } = require("./mcp-tools");
const { UPSTREAM_SESSION_SECRET_KEY, connectionFromSession, readUpstreamSession } = require("./session");

function connectionKey(connection) {
  if (!connection) return "";
  return `${connection.completionURL}\n${connection.apiToken}`;
}

async function startLceRuntime({ vscode, ctx, mcpRuntime, indexRuntime } = {}) {
  if (!vscode || !ctx) throw new Error("startLceRuntime: missing vscode or extension context");
  const mcp = mcpRuntime || createLceMcpToolsRuntime();
  const indexing = indexRuntime || { startWatching, stopWatching };
  let activeConnection = null;
  let activeKey = "";
  let disposed = false;
  let reconcileQueue = Promise.resolve();

  async function reconcile() {
    if (disposed) return;
    const session = await readUpstreamSession(ctx);
    const nextConnection = connectionFromSession(session);
    const nextKey = connectionKey(nextConnection);
    if (nextKey === activeKey) return;

    activeConnection = nextConnection;
    activeKey = nextKey;
    if (!nextConnection) {
      indexing.stopWatching();
      await mcp.setConnection(null);
      info("LCE session absent; indexing and MCP tools disabled");
      return;
    }

    await mcp.setConnection(nextConnection);
    indexing.startWatching(vscode, { getConnection: () => activeConnection });
    info("LCE session active; workspace indexing and MCP tools enabled");
  }

  function scheduleReconcile() {
    reconcileQueue = reconcileQueue.then(reconcile, reconcile);
    return reconcileQueue.catch((err) => {
      warn("LCE session reconcile failed:", err instanceof Error ? err.message : String(err));
    });
  }

  const secretListener = ctx.secrets && typeof ctx.secrets.onDidChange === "function"
    ? ctx.secrets.onDidChange((event) => {
      if (event && event.key === UPSTREAM_SESSION_SECRET_KEY) scheduleReconcile();
    })
    : null;

  await scheduleReconcile();
  return {
    async dispose() {
      disposed = true;
      if (secretListener) {
        try { secretListener.dispose(); } catch {}
      }
      indexing.stopWatching();
      await mcp.dispose();
    },
    reconcile: scheduleReconcile
  };
}

module.exports = { connectionKey, startLceRuntime };
