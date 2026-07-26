const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  MANAGED_AUTH_BYPASS,
  MARKER,
  patchManagedMcpAuth
} = require("../tools/patch/patch-managed-mcp-auth");

async function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function fixtureSource() {
  return [
    `"use strict";`,
    `let secretReads=0;`,
    `const logs=[];`,
    `const kc=()=>({getSecret:async()=>{secretReads+=1;return""}});`,
    `class McpAuth{`,
    `constructor(){this._logger={error:(...args)=>logs.push(args),debug:(...args)=>logs.push(args)}}`,
    `getAuthSecretKey(name){return name}`,
    `async getAuthHeaders(t){if(!t.name){this._logger.error("MCP server config is missing name");return}`,
    `this._logger.debug("upstream auth lookup");`,
    `await kc().getSecret(this.getAuthSecretKey(t.name));`,
    `return t.headers}`,
    `}`,
    `module.exports={McpAuth,getLogs:()=>logs,getSecretReads:()=>secretReads};`
  ].join("");
}

test("patchManagedMcpAuth: returns managed headers before PluginMcpConfig access", async () => {
  await withTempDir("augment-byok-managed-mcp-", async (dir) => {
    const filePath = path.join(dir, "extension.js");
    fs.writeFileSync(filePath, fixtureSource(), "utf8");

    const first = patchManagedMcpAuth(filePath);
    assert.equal(first.changed, true);

    const patched = fs.readFileSync(filePath, "utf8");
    assert.ok(patched.includes(MARKER));
    assert.ok(patched.includes(MANAGED_AUTH_BYPASS));
    assert.doesNotThrow(() => new Function(patched));

    const loaded = require(filePath);
    const headers = { authorization: "Bearer managed-secret", "x-client-id": "client-1" };
    const result = await new loaded.McpAuth().getAuthHeaders({
      id: "augment-byok-lce",
      name: "LCE",
      type: "http",
      headers
    });
    assert.equal(result, headers);
    assert.equal(loaded.getSecretReads(), 0);
    assert.deepEqual(loaded.getLogs(), []);

    const second = patchManagedMcpAuth(filePath);
    assert.equal(second.changed, false);
    assert.equal(fs.readFileSync(filePath, "utf8"), patched);
  });
});

test("patchManagedMcpAuth: leaves other MCP servers on upstream auth handling", async () => {
  await withTempDir("augment-byok-managed-mcp-other-", async (dir) => {
    const filePath = path.join(dir, "extension.js");
    fs.writeFileSync(filePath, fixtureSource(), "utf8");
    patchManagedMcpAuth(filePath);

    const loaded = require(filePath);
    const headers = { authorization: "Bearer other-secret" };
    const result = await new loaded.McpAuth().getAuthHeaders({
      id: "other-server",
      name: "Other",
      type: "http",
      headers
    });
    assert.equal(result, headers);
    assert.equal(loaded.getSecretReads(), 1);
    assert.equal(loaded.getLogs().length, 1);
  });
});

test("patchManagedMcpAuth: fails fast when getAuthHeaders validation drifts", async () => {
  await withTempDir("augment-byok-managed-mcp-drift-", (dir) => {
    const filePath = path.join(dir, "extension.js");
    const source = fixtureSource().replace(
      "MCP server config is missing name",
      "MCP server name is required"
    );
    fs.writeFileSync(filePath, source, "utf8");

    assert.throws(
      () => patchManagedMcpAuth(filePath),
      /getAuthHeaders validation needle not found/
    );
    assert.equal(fs.readFileSync(filePath, "utf8"), source);
  });
});
