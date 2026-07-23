"use strict";

const http = require("http");
const { info, warn } = require("../../infra/log");
const { normalizeRawToken } = require("../../infra/util");
const { ensureConfigManager, state, setRuntimeEnabled, CONFIG_SYNC_KEYS, RUNTIME_ENABLED_KEY } = require("../../config/state");
const { DEFAULT_OFFICIAL_COMPLETION_URL } = require("../../config/official");
const { openConfigPanel } = require("../../ui/config-panel");
const { exportConfigWithDialog, importConfigWithDialog, runIoWithUiErrorBoundary } = require("../../ui/config-io");
const { clearHistorySummaryCacheAll, setHistorySummaryStorage } = require("../../core/augment-history-summary/auto");

function install({ vscode, getActivate, setActivate }) {
  if (state.installed) return;
  state.installed = true;
  state.vscode = vscode || null;

  if (!vscode || typeof getActivate !== "function" || typeof setActivate !== "function") {
    warn("bootstrap install missing hooks");
    return;
  }

  const origActivate = getActivate();
  if (typeof origActivate !== "function") {
    warn("bootstrap: exported activate not function");
    return;
  }

  setActivate(async (ctx) => {
    state.vscode = vscode;

    try {
      setHistorySummaryStorage(ctx?.globalState);
    } catch {}

    try {
      const saved = ctx?.globalState?.get?.(RUNTIME_ENABLED_KEY);
      if (typeof saved === "boolean") state.runtimeEnabled = saved;
    } catch {}

    try {
      ctx?.globalState?.setKeysForSync?.(CONFIG_SYNC_KEYS);
    } catch {}

    const cfgMgr = ensureConfigManager({ ctx });
    const rr = cfgMgr.reloadNow("activate");
    if (!rr.ok && rr.reason === "missing") {
      try {
        await cfgMgr.resetNow("init_default");
      } catch (err) {
        warn("bootstrap: init default config failed:", err instanceof Error ? err.message : String(err));
      }
    }

    registerCommandsOnce(vscode, ctx, cfgMgr);
    return await origActivate(ctx);
  });
}

let commandsRegistered = false;

function registerCommandsOnce(vscode, ctx, cfgMgr) {
  if (commandsRegistered) return;
  commandsRegistered = true;

  const register = (id, fn) => {
    try {
      const d = vscode.commands.registerCommand(id, fn);
      if (ctx && Array.isArray(ctx.subscriptions)) ctx.subscriptions.push(d);
    } catch (err) {
      warn(`registerCommand failed: ${id}`, err instanceof Error ? err.message : String(err));
    }
  };

  register("augment-byok.enable", async () => {
    await setRuntimeEnabled(ctx, true);
    info("BYOK enabled (runtime)");
    try { await vscode.window.showInformationMessage("BYOK enabled"); } catch {}
  });

  register("augment-byok.disable", async () => {
    await setRuntimeEnabled(ctx, false);
    info("BYOK disabled (rollback)");
    try { await vscode.window.showWarningMessage("BYOK disabled (rollback to official)"); } catch {}
  });

  register("augment-byok.reloadConfig", async () => {
    const r = cfgMgr.reloadNow("command");
    try {
      await vscode.window.showInformationMessage(r.ok ? "BYOK config reloaded" : "BYOK config reload failed (kept last good)");
    } catch {}
  });

  register("augment-byok.openConfigPanel", async () => {
    try {
      await openConfigPanel({ vscode, ctx, cfgMgr, state });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      warn("openConfigPanel failed:", m);
      try { await vscode.window.showErrorMessage(`Open BYOK Config Panel failed: ${m}`); } catch {}
    }
  });

  register("augment-byok.loginLCE", async () => {
    let server = null;
    let timeout = null;
    try {
      const token = await new Promise((resolve, reject) => {
        server = http.createServer((req, res) => {
          const url = new URL(req.url, `http://localhost`);
          const t = url.searchParams.get("token");
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" });
          if (t) {
            res.end("<html><body><h2>登录成功，可以关闭此页面。</h2><script>window.close()</script></body></html>");
            resolve(t);
          } else {
            res.end("<html><body><h2>未收到 Token，请重试。</h2></body></html>");
          }
        });
        server.listen(0, "127.0.0.1", () => {
          const port = server.address().port;
          const callbackUrl = encodeURIComponent(`http://127.0.0.1:${port}/callback`);
          const loginUrl = `https://513689.xyz/auth/device?callback=${callbackUrl}`;
          info(`LCE login: opening browser, callback port=${port}`);
          try {
            vscode.env.openExternal(vscode.Uri.parse(loginUrl));
          } catch (err) {
            reject(new Error("无法打开浏览器: " + (err instanceof Error ? err.message : String(err))));
          }
        });
        timeout = setTimeout(() => {
          reject(new Error("登录超时（120 秒），请重试"));
        }, 120000);
      });

      if (timeout) clearTimeout(timeout);
      if (server) { try { server.close(); } catch {} }

      const apiToken = normalizeRawToken(token);
      if (!apiToken) {
        try { await vscode.window.showErrorMessage("LCE 登录失败：收到的 Token 无效"); } catch {}
        return;
      }

      const cfg = cfgMgr.get();
      const updated = { ...cfg };
      updated.official = { ...(updated.official || {}), apiToken, completionUrl: DEFAULT_OFFICIAL_COMPLETION_URL };
      await cfgMgr.saveNow(updated, "lce_login");
      info("LCE login: token saved via command");
      try { await vscode.window.showInformationMessage("LCE 登录成功，API Token 已保存"); } catch {}
    } catch (err) {
      if (timeout) clearTimeout(timeout);
      if (server) { try { server.close(); } catch {} }
      const m = err instanceof Error ? err.message : String(err);
      warn("LCE login failed:", m);
      try { await vscode.window.showErrorMessage(`LCE 登录失败: ${m}`); } catch {}
    }
  });

  register("augment-byok.clearHistorySummaryCache", async () => {
    try {
      const n = await clearHistorySummaryCacheAll();
      info(`historySummary cache cleared: ${n}`);
      try { await vscode.window.showInformationMessage(n ? `Cleared history summary cache (${n})` : "History summary cache already empty"); } catch {}
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      warn("clearHistorySummaryCache failed:", m);
      try { await vscode.window.showErrorMessage(`Clear history summary cache failed: ${m}`); } catch {}
    }
  });

  register("augment-byok.exportConfig", async () => {
    try {
      await runIoWithUiErrorBoundary(async () => {
        const r = await exportConfigWithDialog({ vscode, cfg: cfgMgr.get(), defaultFileName: "augment-byok.config.json" });
        if (!r.ok) return;
        try { await vscode.window.showInformationMessage(`BYOK config exported: ${String(r.uri)}`); } catch {}
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      try { await vscode.window.showErrorMessage(`Export BYOK config failed: ${m}`); } catch {}
    }
  });

  register("augment-byok.importConfig", async () => {
    try {
      await runIoWithUiErrorBoundary(async () => {
        const r = await importConfigWithDialog({ vscode, cfgMgr, requireConfirm: true, preserveSecretsByDefault: true });
        if (!r.ok) return;
        try { await vscode.window.showInformationMessage(`BYOK config imported: ${String(r.uri)}`); } catch {}
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      try { await vscode.window.showErrorMessage(`Import BYOK config failed: ${m}`); } catch {}
    }
  });
}

module.exports = { install };
