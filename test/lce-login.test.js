const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { loginLCE, LCE_DEVICE_LOGIN_URL, UPSTREAM_SESSION_SECRET_KEY } = require("../payload/extension/out/byok/runtime/lce/login");

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
  });
}

function makeFakes({ tokenParam }) {
  const seen = { loginUrl: "", savedConfigs: [], secrets: [] };
  const vscode = {
    Uri: { parse: (s) => s },
    env: {
      openExternal: (loginUrl) => {
        seen.loginUrl = String(loginUrl);
        const callback = new URL(String(loginUrl)).searchParams.get("callback");
        setImmediate(() => {
          const target = new URL(callback);
          if (tokenParam !== undefined) target.searchParams.set("token", tokenParam);
          httpGet(target.toString()).catch(() => {});
        });
        return Promise.resolve(true);
      }
    }
  };
  const ctx = {
    secrets: {
      store: async (key, value) => {
        seen.secrets.push({ key, value });
      }
    }
  };
  const cfgMgr = {
    get: () => ({ providers: [] }),
    saveNow: async (cfg, reason) => {
      seen.savedConfigs.push({ cfg, reason });
    }
  };
  return { vscode, ctx, cfgMgr, seen };
}

test("loginLCE: opens /api/auth/device, saves token and writes upstream session", async () => {
  const { vscode, ctx, cfgMgr, seen } = makeFakes({ tokenParam: "sk-lce-test-token" });

  const r = await loginLCE({ vscode, ctx, cfgMgr });

  assert.equal(r.apiToken, "sk-lce-test-token");
  assert.equal(seen.loginUrl.startsWith(`${LCE_DEVICE_LOGIN_URL}?callback=`), true);
  assert.equal(new URL(seen.loginUrl).pathname, "/api/auth/device");

  assert.equal(seen.savedConfigs.length, 1);
  assert.equal(seen.savedConfigs[0].reason, "lce_login");
  assert.equal(seen.savedConfigs[0].cfg.official.apiToken, "sk-lce-test-token");
  assert.equal(typeof seen.savedConfigs[0].cfg.official.completionUrl, "string");

  assert.equal(seen.secrets.length, 1);
  assert.equal(seen.secrets[0].key, UPSTREAM_SESSION_SECRET_KEY);
  const session = JSON.parse(seen.secrets[0].value);
  assert.equal(session.accessToken, "sk-lce-test-token");
  assert.equal(session.tenantURL, seen.savedConfigs[0].cfg.official.completionUrl);
  assert.deepEqual(session.scopes, ["email"]);
});

test("loginLCE: rejects on invalid token and skips config/session writes", async () => {
  const { vscode, ctx, cfgMgr, seen } = makeFakes({ tokenParam: "   " });

  await assert.rejects(() => loginLCE({ vscode, ctx, cfgMgr }), /Token 无效/);
  assert.equal(seen.savedConfigs.length, 0);
  assert.equal(seen.secrets.length, 0);
});
