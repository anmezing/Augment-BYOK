"use strict";

const http = require("http");
const { info } = require("../../infra/log");
const { normalizeRawToken } = require("../../infra/util");
const { DEFAULT_OFFICIAL_COMPLETION_URL } = require("../../config/official");
const { UPSTREAM_SESSION_SECRET_KEY, writeUpstreamSession } = require("./session");
const { getDeviceIdentity } = require("../device-identity");

const LCE_ORIGIN = new URL(DEFAULT_OFFICIAL_COMPLETION_URL).origin;
// 前端设备登录端点是 Next.js API route：/api/auth/device（不是 /auth/device 页面）。
const LCE_DEVICE_LOGIN_URL = `${LCE_ORIGIN}/api/auth/device`;

const LOGIN_TIMEOUT_MS = 120000;

// device_id/device_name 供前端注册设备（设备绑定，防账号共用）；
// 缺省时前端按旧客户端兼容处理（不注册，relay log 模式放行）。
function buildDeviceLoginUrl(callbackUrl) {
  const url = new URL(LCE_DEVICE_LOGIN_URL);
  url.searchParams.set("callback", callbackUrl);
  const { clientId, clientName } = getDeviceIdentity();
  if (clientId) url.searchParams.set("device_id", clientId);
  if (clientName) url.searchParams.set("device_name", clientName);
  return url.toString();
}

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
      const loginUrl = buildDeviceLoginUrl(`http://127.0.0.1:${port}/callback`);
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
  return { apiToken };
}

module.exports = { loginLCE, buildDeviceLoginUrl, LCE_DEVICE_LOGIN_URL, UPSTREAM_SESSION_SECRET_KEY };
