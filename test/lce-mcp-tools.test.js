const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LCE_MCP_SERVER_ID,
  buildLceMcpServer,
  buildLceMcpUrl,
  createLceMcpToolsRuntime
} = require("../payload/extension/out/byok/runtime/lce/mcp-tools");

function makeToolsModel(initialServers) {
  const calls = [];
  const model = {
    _mcpService: { _additionalEphemeralServerConfigs: initialServers },
    getToolDefinitions: async () => [],
    callTool: async () => ({}),
    setAdditionalEphemeralMcpServers: async function (servers) {
      calls.push(servers);
      this._mcpService._additionalEphemeralServerConfigs = servers;
    },
    waitForMcpInitialization: async () => {}
  };
  return { calls, model };
}

test("LCE MCP URL targets relay origin instead of /relay/mcp", () => {
  assert.equal(buildLceMcpUrl("https://relay.example/relay/"), "https://relay.example/mcp");
});

test("LCE MCP server uses the authenticated session token in memory", () => {
  const server = buildLceMcpServer({
    completionURL: "https://relay.example/relay/",
    apiToken: "session-token"
  });
  assert.equal(server.id, LCE_MCP_SERVER_ID);
  assert.equal(server.url, "https://relay.example/mcp");
  assert.equal(server.headers.authorization, "Bearer session-token");
});

test("LCE MCP registration preserves user servers and removes only its managed server", async () => {
  const userServer = { id: "user-server", type: "http", name: "docs", url: "https://docs.example/mcp" };
  const { calls, model } = makeToolsModel([userServer]);
  const runtime = createLceMcpToolsRuntime({ getToolsModel: () => model, pollIntervalMs: 60000 });

  await runtime.setConnection({
    completionURL: "https://relay.example/relay/",
    apiToken: "session-token"
  });
  assert.deepEqual(calls[0][0], userServer);
  assert.equal(calls[0][1].id, LCE_MCP_SERVER_ID);

  const laterUserServer = { id: "later-server", type: "http", name: "later", url: "https://later.example/mcp" };
  await model.setAdditionalEphemeralMcpServers([laterUserServer]);
  assert.deepEqual(calls[1][0], laterUserServer);
  assert.equal(calls[1][1].id, LCE_MCP_SERVER_ID);

  await runtime.setConnection(null);
  assert.deepEqual(calls.at(-1), [laterUserServer]);
  await runtime.dispose();
});

test("LCE MCP registration follows an asynchronously replaced toolsModel", async () => {
  const first = makeToolsModel([]);
  const second = makeToolsModel([]);
  let current = first.model;
  const runtime = createLceMcpToolsRuntime({ getToolsModel: () => current, pollIntervalMs: 60000 });

  await runtime.setConnection({
    completionURL: "https://relay.example/relay/",
    apiToken: "session-token"
  });
  current = second.model;
  await runtime.reconcileModel();

  assert.equal(first.calls.at(-1).some((server) => server.id === LCE_MCP_SERVER_ID), false);
  assert.equal(second.calls.at(-1).some((server) => server.id === LCE_MCP_SERVER_ID), true);
  await runtime.dispose();
});
