"use strict";

const http = require("http");
const { info } = require("../../infra/log");
const { normalizeRawToken } = require("../../infra/util");
const { DEFAULT_OFFICIAL_COMPLETION_URL } = require("../../config/official");
const { triggerIndexNow } = require("./auto-index");

const LCE_ORIGIN = new URL(DEFAULT_OFFICIAL_COMPLETION_URL).origin;
// 前端设备登录端点是 Next.js API route：/api/auth/device（不是 /auth/device 页面）。
const LCE_DEVICE_LOGIN_URL = `${LCE_ORIGIN}/api/auth/device`;

// 上游 AuthSessionStore 读取的 SecretStorage key（extension.js 内 mC="augment.sessions"）。
// 写入后上游 secrets.onDidChange -> onDidChangeSession -> isLoggedIn=true，
// 侧边栏才会从 Sign In 界面进入 chat；signOut 走上游 removeSession 删除同一 key。
// 注意：这不是 BYOK 配置源（配置仍只在 globalState），只是补齐上游登录态。
const UPSTREAM_SESSION_SECRET_KEY = "augment.sessions";
const UPSTREAM_SESSION_SCOPES = ["email"];
const LOGIN_TIMEOUT_MS = 120000;

function waitForTokenViaBrowser(vscode) {
  let server = null;
  let timeout = null;
  const cleanup = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    if (server) {
      try {
        server.close();
      } catch {}
      server = null;
    }
  };
  const p = new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://localhost");
      const t = url.searchParams.get("token");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      if (t) {
        res.end("<html><body><h2>登录成功，可以关闭此页面。</h2><script>window.close()</script></body></html>");
        resolve(t);
      } else {
        res.end("<html><body><h2>未收到 Token，请重试。</h2></body></html>");
      }
    });
    server.on("error", (err) => {
      reject(new Error("本地回调服务启动失败: " + (err instanceof Error ? err.message : String(err))));
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const callbackUrl = encodeURIComponent(`http://127.0.0.1:${port}/callback`);
      const loginUrl = `${LCE_DEVICE_LOGIN_URL}?callback=${callbackUrl}`;
      info(`LCE login: opening browser, callback port=${port}`);
      try {
        vscode.env.openExternal(vscode.Uri.parse(loginUrl));
      } catch (err) {
        reject(new Error("无法打开浏览器: " + (err instanceof Error ? err.message : String(err))));
      }
    });
    timeout = setTimeout(() => {
      reject(new Error("登录超时（120 秒），请重试"));
    }, LOGIN_TIMEOUT_MS);
  });
  return p.finally(cleanup);
}

async function writeUpstreamSession(ctx, apiToken) {
  const secrets = ctx && ctx.secrets;
  if (!secrets || typeof secrets.store !== "function") {
    throw new Error("extension context secrets unavailable");
  }
  await secrets.store(
    UPSTREAM_SESSION_SECRET_KEY,
    JSON.stringify({ accessToken: apiToken, tenantURL: DEFAULT_OFFICIAL_COMPLETION_URL, scopes: UPSTREAM_SESSION_SCOPES })
  );
}

async function loginLCE({ vscode, ctx, cfgMgr }) {
  if (!vscode) throw new Error("loginLCE: missing vscode");
  if (!ctx) throw new Error("loginLCE: missing ctx");
  if (!cfgMgr) throw new Error("loginLCE: missing cfgMgr");

  const token = await waitForTokenViaBrowser(vscode);
  const apiToken = normalizeRawToken(token);
  if (!apiToken) throw new Error("收到的 Token 无效");

  const cfg = cfgMgr.get();
  const updated = { ...cfg };
  updated.official = { ...(updated.official || {}), apiToken, completionUrl: DEFAULT_OFFICIAL_COMPLETION_URL };
  await cfgMgr.saveNow(updated, "lce_login");

  await writeUpstreamSession(ctx, apiToken);
  info("LCE login: token saved; upstream session written");
  triggerIndexNow();
  return { apiToken };
}

module.exports = { loginLCE, LCE_DEVICE_LOGIN_URL, UPSTREAM_SESSION_SECRET_KEY };
