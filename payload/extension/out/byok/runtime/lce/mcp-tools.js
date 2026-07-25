"use strict";

const { warn } = require("../../infra/log");
const { normalizeRawToken, normalizeString } = require("../../infra/util");
const { findDeep, getByokUpstreamGlobals } = require("../upstream/discovery");
const { applyClientIdHeader } = require("../device-identity");

const LCE_MCP_SERVER_ID = "augment-byok-lce";
const MODEL_POLL_INTERVAL_MS = 1000;

function isToolsModelCandidate(value) {
  return value && typeof value === "object" &&
    typeof value.setAdditionalEphemeralMcpServers === "function" &&
    typeof value.getToolDefinitions === "function" &&
    typeof value.callTool === "function";
}

function getCurrentToolsModel() {
  const { upstream } = getByokUpstreamGlobals();
  if (!upstream) return null;
  if (typeof upstream.getToolsModel === "function") {
    try {
      const model = upstream.getToolsModel();
      if (isToolsModelCandidate(model)) return model;
    } catch {}
  }
  if (isToolsModelCandidate(upstream.toolsModel)) return upstream.toolsModel;
  return (
    findDeep(upstream.augmentExtension, isToolsModelCandidate, { maxDepth: 5, maxNodes: 4000 }) ||
    findDeep(upstream, isToolsModelCandidate, { maxDepth: 4, maxNodes: 4000 })
  );
}

function buildLceMcpUrl(completionURL) {
  try {
    return new URL("/mcp", normalizeString(completionURL)).toString();
  } catch {
    return "";
  }
}

function buildLceMcpServer(connection) {
  const url = buildLceMcpUrl(connection && connection.completionURL);
  const apiToken = normalizeRawToken(connection && connection.apiToken);
  if (!url || !apiToken) return null;
  return {
    id: LCE_MCP_SERVER_ID,
    type: "http",
    name: "lce",
    disabled: false,
    url,
    headers: applyClientIdHeader({ authorization: `Bearer ${apiToken}` })
  };
}

function withoutManagedServer(servers) {
  return (Array.isArray(servers) ? servers : []).filter((server) => server && server.id !== LCE_MCP_SERVER_ID);
}

function mergeServers(baseServers, managedServer) {
  const base = withoutManagedServer(baseServers);
  return managedServer ? [...base, managedServer] : base;
}

function readExistingServers(model) {
  const service = model && (model._mcpService || model.mcpService);
  return withoutManagedServer(service && service._additionalEphemeralServerConfigs);
}

function createLceMcpToolsRuntime(options) {
  const opts = options && typeof options === "object" ? options : {};
  const resolveToolsModel = typeof opts.getToolsModel === "function" ? opts.getToolsModel : getCurrentToolsModel;
  const pollIntervalMs = Number(opts.pollIntervalMs) > 0 ? Number(opts.pollIntervalMs) : MODEL_POLL_INTERVAL_MS;
  let connection = null;
  let managedServer = null;
  let attached = null;
  let timer = null;
  let disposed = false;
  let reconciling = false;

  async function detachCurrent() {
    const current = attached;
    attached = null;
    if (!current) return;
    try {
      await current.original.call(current.model, current.baseServers);
    } catch (err) {
      warn("LCE MCP removal failed:", err instanceof Error ? err.message : String(err));
    } finally {
      if (current.hadOwnMethod) current.model.setAdditionalEphemeralMcpServers = current.previousMethod;
      else delete current.model.setAdditionalEphemeralMcpServers;
    }
  }

  async function attachModel(model) {
    const previousMethod = model.setAdditionalEphemeralMcpServers;
    const hadOwnMethod = Object.prototype.hasOwnProperty.call(model, "setAdditionalEphemeralMcpServers");
    const original = previousMethod;
    const state = {
      model,
      original,
      previousMethod,
      hadOwnMethod,
      baseServers: readExistingServers(model)
    };
    model.setAdditionalEphemeralMcpServers = async function setAdditionalEphemeralMcpServersWithLce(servers) {
      state.baseServers = withoutManagedServer(servers);
      return await original.call(model, mergeServers(state.baseServers, managedServer));
    };
    attached = state;
    await original.call(model, mergeServers(state.baseServers, managedServer));
    if (typeof model.waitForMcpInitialization === "function") {
      await model.waitForMcpInitialization(30000);
    }
  }

  async function reconcileModel(options) {
    if (disposed || reconciling) return;
    const force = Boolean(options && options.force);
    reconciling = true;
    try {
      const model = managedServer ? resolveToolsModel() : null;
      if (attached && attached.model !== model) await detachCurrent();
      if (model && !attached) {
        try {
          await attachModel(model);
        } catch (err) {
          await detachCurrent();
          warn("LCE MCP registration failed:", err instanceof Error ? err.message : String(err));
        }
      } else if (attached && force) {
        await attached.original.call(attached.model, mergeServers(attached.baseServers, managedServer));
      }
    } finally {
      reconciling = false;
    }
  }

  function updatePolling() {
    if (managedServer && !timer) {
      timer = setInterval(() => {
        reconcileModel().catch(() => {});
      }, pollIntervalMs);
    } else if (!managedServer && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  async function setConnection(nextConnection) {
    if (disposed) return;
    connection = nextConnection || null;
    managedServer = buildLceMcpServer(connection);
    updatePolling();
    await reconcileModel({ force: true });
  }

  async function dispose() {
    disposed = true;
    connection = null;
    managedServer = null;
    if (timer) clearInterval(timer);
    timer = null;
    await detachCurrent();
  }

  return { dispose, reconcileModel, setConnection };
}

module.exports = {
  LCE_MCP_SERVER_ID,
  buildLceMcpServer,
  buildLceMcpUrl,
  createLceMcpToolsRuntime,
  getCurrentToolsModel,
  isToolsModelCandidate,
  mergeServers,
  withoutManagedServer
};
