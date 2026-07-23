"use strict";

const crypto = require("crypto");
const { info, warn, debug } = require("../../infra/log");
const { normalizeString, normalizeRawToken } = require("../../infra/util");
const { getOfficialConnection } = require("../../config/official");
const { safeFetch, joinBaseUrl } = require("../../providers/http");

const INDEX_BATCH_SIZE = 20;
const INDEX_BATCH_DELAY_MS = 500;
const SCAN_DEBOUNCE_MS = 5000;
const MAX_FILE_SIZE = 512 * 1024;
const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.git\//,
  /dist\//,
  /build\//,
  /\.next\//,
  /__pycache__/,
  /\.pyc$/,
  /\.class$/,
  /\.o$/,
  /\.so$/,
  /\.dll$/,
  /\.exe$/,
  /\.wasm$/,
  /\.min\.js$/,
  /\.min\.css$/,
  /\.map$/,
  /\.lock$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.env/,
  /\.pem$/,
  /\.key$/,
  /\.cert$/,
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.gif$/,
  /\.ico$/,
  /\.svg$/,
  /\.woff/,
  /\.ttf$/,
  /\.eot$/,
  /\.mp[34]$/,
  /\.zip$/,
  /\.tar/,
  /\.gz$/,
  /\.rar$/,
  /\.pdf$/,
];

let vscodeRef = null;
let indexingActive = false;
let scanTimer = null;
let fileWatcher = null;
let gitHeadWatcher = null;
let statusBarItem = null;

function shouldExclude(path) {
  const p = path.replace(/\\/g, "/");
  return EXCLUDE_PATTERNS.some((re) => re.test(p));
}

function fileHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function getConnection() {
  const { completionURL, apiToken } = getOfficialConnection();
  if (!completionURL || !apiToken) return null;
  return { completionURL, apiToken };
}

async function callRelay(completionURL, apiToken, endpoint, body, timeoutMs) {
  const url = joinBaseUrl(normalizeString(completionURL), endpoint);
  if (!url) return null;
  const headers = { "content-type": "application/json" };
  if (apiToken) headers.authorization = `Bearer ${apiToken}`;
  const resp = await safeFetch(
    url,
    { method: "POST", headers, body: JSON.stringify(body) },
    { timeoutMs: timeoutMs || 30000, label: `lce/${endpoint}` }
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${endpoint} ${resp.status}: ${text.slice(0, 200)}`);
  }
  return await resp.json().catch(() => null);
}

function setStatus(text) {
  if (statusBarItem) statusBarItem.text = text;
}

function showStatus() {
  if (!statusBarItem && vscodeRef) {
    statusBarItem = vscodeRef.window.createStatusBarItem(vscodeRef.StatusBarAlignment.Left, 0);
    statusBarItem.show();
  }
}

function hideStatus() {
  if (statusBarItem) {
    statusBarItem.hide();
    statusBarItem.dispose();
    statusBarItem = null;
  }
}

async function scanAndIndex() {
  if (indexingActive) return;
  const conn = getConnection();
  if (!conn) return;

  const vscode = vscodeRef;
  if (!vscode) return;

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) return;

  indexingActive = true;
  showStatus();
  setStatus("$(sync~spin) LCE: 扫描文件...");

  try {
    const files = await vscode.workspace.findFiles("**/*", "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.next/**,**/__pycache__/**}");
    const candidates = [];
    for (const uri of files) {
      const rel = vscode.workspace.asRelativePath(uri, false);
      if (shouldExclude(rel)) continue;
      let stat;
      try { stat = await vscode.workspace.fs.stat(uri); } catch { continue; }
      if (stat.size > MAX_FILE_SIZE || stat.size === 0) continue;
      candidates.push({ uri, path: rel, size: stat.size });
    }

    if (!candidates.length) {
      setStatus("$(check) LCE: 无需索引");
      setTimeout(hideStatus, 3000);
      indexingActive = false;
      return;
    }

    setStatus(`$(sync~spin) LCE: 检查 ${candidates.length} 个文件...`);

    const fileEntries = [];
    for (const c of candidates) {
      let content;
      try { content = await vscode.workspace.fs.readFile(c.uri); } catch { continue; }
      const text = Buffer.from(content).toString("utf8");
      const h = fileHash(text);
      fileEntries.push({ path: c.path, hash: h, size: c.size, content: text, uri: c.uri });
    }

    const checkPayload = fileEntries.map((f) => ({ path: f.path, hash: f.hash, size: f.size }));
    let missing;
    try {
      const resp = await callRelay(conn.completionURL, conn.apiToken, "find-missing", { files: checkPayload }, 30000);
      missing = resp && Array.isArray(resp.missing) ? resp.missing : [];
    } catch (err) {
      warn("LCE auto-index find-missing failed:", err instanceof Error ? err.message : String(err));
      setStatus("$(error) LCE: 索引检查失败");
      setTimeout(hideStatus, 5000);
      indexingActive = false;
      return;
    }

    if (!missing.length) {
      info(`LCE auto-index: all ${fileEntries.length} files up to date`);
      setStatus("$(check) LCE: 索引已是最新");
      setTimeout(hideStatus, 3000);
      indexingActive = false;
      return;
    }

    const missingSet = new Set(missing.map((m) => typeof m === "string" ? m : (m && m.path ? m.path : "")));
    const toUpload = fileEntries.filter((f) => missingSet.has(f.path));

    info(`LCE auto-index: ${toUpload.length} files to index`);
    let indexed = 0;

    for (let i = 0; i < toUpload.length; i += INDEX_BATCH_SIZE) {
      const batch = toUpload.slice(i, i + INDEX_BATCH_SIZE);
      const payload = batch.map((f) => ({ path: f.path, content: f.content, hash: f.hash }));
      setStatus(`$(sync~spin) LCE: 索引中 ${indexed}/${toUpload.length}`);
      try {
        await callRelay(conn.completionURL, conn.apiToken, "remote-index", { files: payload }, 60000);
        indexed += batch.length;
      } catch (err) {
        warn("LCE auto-index batch failed:", err instanceof Error ? err.message : String(err));
      }
      if (i + INDEX_BATCH_SIZE < toUpload.length) {
        await new Promise((r) => setTimeout(r, INDEX_BATCH_DELAY_MS));
      }
    }

    info(`LCE auto-index: indexed ${indexed}/${toUpload.length} files`);
    setStatus(`$(check) LCE: 已索引 ${indexed} 个文件`);
    setTimeout(hideStatus, 5000);
  } catch (err) {
    warn("LCE auto-index error:", err instanceof Error ? err.message : String(err));
    setStatus("$(error) LCE: 索引出错");
    setTimeout(hideStatus, 5000);
  } finally {
    indexingActive = false;
  }
}

function scheduleScan() {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    scanTimer = null;
    scanAndIndex().catch((err) => warn("LCE scan error:", err instanceof Error ? err.message : String(err)));
  }, SCAN_DEBOUNCE_MS);
}

function onFileSaved(doc) {
  if (!doc || !doc.uri) return;
  const conn = getConnection();
  if (!conn) return;
  const rel = vscodeRef.workspace.asRelativePath(doc.uri, false);
  if (shouldExclude(rel)) return;
  const text = doc.getText();
  if (!text || text.length > MAX_FILE_SIZE) return;
  const h = fileHash(text);
  debug(`LCE: file saved, indexing ${rel}`);
  callRelay(conn.completionURL, conn.apiToken, "remote-index", {
    files: [{ path: rel, content: text, hash: h }]
  }, 30000).catch((err) => warn("LCE index on save failed:", err instanceof Error ? err.message : String(err)));
}

function onFileDeleted(uri) {
  // Deletion triggers a full rescan to let the relay detect stale entries
  scheduleScan();
}

function startWatching(vscode) {
  if (fileWatcher) return;
  vscodeRef = vscode;

  vscode.workspace.onDidSaveTextDocument(onFileSaved);

  fileWatcher = vscode.workspace.createFileSystemWatcher("**/*");
  fileWatcher.onDidCreate(() => scheduleScan());
  fileWatcher.onDidDelete((uri) => onFileDeleted(uri));

  gitHeadWatcher = vscode.workspace.createFileSystemWatcher("**/.git/HEAD");
  gitHeadWatcher.onDidChange(() => {
    info("LCE: branch switch detected, scheduling rescan");
    scheduleScan();
  });
}

function stopWatching() {
  if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
  if (fileWatcher) { fileWatcher.dispose(); fileWatcher = null; }
  if (gitHeadWatcher) { gitHeadWatcher.dispose(); gitHeadWatcher = null; }
  hideStatus();
}

function triggerIndexNow() {
  scanAndIndex().catch((err) => warn("LCE triggerIndex error:", err instanceof Error ? err.message : String(err)));
}

module.exports = { startWatching, stopWatching, triggerIndexNow, scanAndIndex };
