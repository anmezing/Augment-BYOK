"use strict";

const { info, warn } = require("../../infra/log");
const { buildWorkspaceManifest, readFileForIndex } = require("./index-workspace");
const { completeIndexJob, createIndexJob, failIndexJob, uploadIndexBatch } = require("./index-relay");

const INDEX_BATCH_SIZE = 20;
const INDEX_BATCH_DELAY_MS = 300;
const SCAN_DEBOUNCE_MS = 1500;
const INITIAL_SCAN_DELAY_MS = 3000;

let vscodeRef = null;
let indexingActive = false;
let activePromise = null;
let activeController = null;
let rerunQueued = false;
let scanTimer = null;
let initialTimer = null;
let hideTimer = null;
let watcherDisposable = null;
let statusBarItem = null;
let getConnectionRef = null;

function getConnection() {
  const connection = typeof getConnectionRef === "function" ? getConnectionRef() : null;
  if (!connection || !connection.completionURL || !connection.apiToken) return null;
  return connection;
}

function showStatus(text) {
  if (!statusBarItem && vscodeRef) {
    statusBarItem = vscodeRef.window.createStatusBarItem(vscodeRef.StatusBarAlignment.Left, 0);
    statusBarItem.show();
  }
  if (statusBarItem) {
    statusBarItem.text = text;
    statusBarItem.tooltip = "LCE workspace indexing";
  }
}

function hideStatus() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (statusBarItem) {
    statusBarItem.dispose();
    statusBarItem = null;
  }
}

function showFinalStatus(text, delayMs) {
  showStatus(text);
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(hideStatus, delayMs || 5000);
}

function formatProgress(job) {
  const totalFiles = Math.max(0, Number(job && job.totalFiles) || 0);
  const indexedFiles = Math.max(0, Number(job && job.indexedFiles) || 0);
  const percent = totalFiles ? Math.min(100, Math.floor(indexedFiles * 100 / totalFiles)) : 100;
  const indexedChunks = Math.max(0, Number(job && job.indexedChunks) || 0);
  const totalChunks = Math.max(indexedChunks, Number(job && job.totalChunks) || 0);
  const approximate = job && job.chunkCountEstimated ? "~" : "";
  return `${percent}% ${indexedFiles}/${totalFiles} files | ${approximate}${indexedChunks}/${approximate}${totalChunks} chunks`;
}

function isAbortError(err) {
  return Boolean(err && typeof err === "object" && err.name === "AbortError");
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    let onAbort = null;
    const timer = setTimeout(() => {
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (!signal) return;
    onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      const error = new Error("Indexing aborted");
      error.name = "AbortError";
      reject(error);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function runIndexOnce() {
  const connection = getConnection();
  const vscode = vscodeRef;
  if (!connection || !vscode) return null;
  if (!vscode.workspace.workspaceFolders || !vscode.workspace.workspaceFolders.length) return null;

  activeController = new AbortController();
  const signal = activeController.signal;
  let jobId = "";
  try {
    showStatus("$(sync~spin) LCE: scanning workspace...");
    const manifest = await buildWorkspaceManifest(vscode, (done, total) => {
      if (done === total || done % 100 === 0) {
        showStatus(`$(sync~spin) LCE: scanning ${done}/${total} files`);
      }
    });
    if (!manifest) return null;

    showStatus(`$(sync~spin) LCE: comparing ${manifest.files.length} files...`);
    const created = await createIndexJob(connection, manifest, signal);
    let job = created && created.job;
    jobId = job && job.id || "";
    if (!jobId) throw new Error("relay did not return an index job id");

    const byPath = new Map(manifest.files.map((file) => [file.path, file]));
    const pendingPaths = Array.isArray(created.pendingFiles) ? created.pendingFiles : [];
    const pending = pendingPaths.map((filePath) => byPath.get(filePath)).filter(Boolean);
    if (pending.length !== pendingPaths.length) {
      throw new Error("relay returned files outside the current workspace manifest");
    }

    showStatus(`$(sync~spin) LCE: ${formatProgress(job)}`);
    if (pending.length === 0 && Number(job.deletedCount) > 0) {
      const response = await uploadIndexBatch(connection, jobId, [], signal);
      job = response.job || job;
      showStatus(`$(sync~spin) LCE: ${formatProgress(job)}`);
    }

    for (let offset = 0; offset < pending.length; offset += INDEX_BATCH_SIZE) {
      const batch = await Promise.all(
        pending.slice(offset, offset + INDEX_BATCH_SIZE).map((file) => readFileForIndex(vscode, file))
      );
      const response = await uploadIndexBatch(connection, jobId, batch, signal);
      job = response.job || job;
      showStatus(`$(sync~spin) LCE: ${formatProgress(job)}`);
      if (offset + INDEX_BATCH_SIZE < pending.length) {
        await sleep(INDEX_BATCH_DELAY_MS, signal);
      }
    }

    const completed = await completeIndexJob(connection, jobId, signal);
    job = completed.job || job;
    info(`LCE index completed: workspace=${manifest.workspaceId} mode=${job.mode} files=${job.indexedFiles} chunks=${job.indexedChunks}`);
    if (Number(job.totalFiles) === 0 && Number(job.deletedCount) === 0) {
      showFinalStatus("$(check) LCE: index is up to date", 3000);
    } else {
      showFinalStatus(`$(check) LCE: ${formatProgress(job)}`, 6000);
    }
    return job;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jobId) {
      try {
        await failIndexJob(connection, jobId, message);
      } catch (cleanupErr) {
        warn("LCE index cleanup failed:", cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr));
      }
    }
    if (!isAbortError(err)) {
      warn("LCE auto-index failed:", message);
      showFinalStatus("$(error) LCE: indexing failed", 6000);
    }
    throw err;
  } finally {
    activeController = null;
  }
}

function scanAndIndex() {
  if (indexingActive) {
    rerunQueued = true;
    return activePromise || Promise.resolve(null);
  }
  indexingActive = true;
  activePromise = runIndexOnce()
    .catch((err) => {
      if (!isAbortError(err)) return null;
      return null;
    })
    .finally(() => {
      indexingActive = false;
      activePromise = null;
      if (rerunQueued && vscodeRef) {
        rerunQueued = false;
        setTimeout(() => scanAndIndex(), 0);
      }
    });
  return activePromise;
}

function scheduleScan() {
  if (indexingActive) {
    rerunQueued = true;
    return;
  }
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    scanTimer = null;
    scanAndIndex();
  }, SCAN_DEBOUNCE_MS);
}

function isGitPath(uri) {
  const value = String(uri && (uri.fsPath || uri.path) || "").replace(/\\/g, "/");
  return /(^|\/)\.git(?:\/|$)/.test(value);
}

function startWatching(vscode, options) {
  getConnectionRef = options && typeof options.getConnection === "function" ? options.getConnection : null;
  if (!getConnection()) return null;
  if (watcherDisposable) return watcherDisposable;
  vscodeRef = vscode;
  const disposables = [];
  const registerWatcher = (glob, handler) => {
    const watcher = vscode.workspace.createFileSystemWatcher(glob);
    disposables.push(watcher);
    disposables.push(watcher.onDidCreate(handler));
    disposables.push(watcher.onDidChange(handler));
    disposables.push(watcher.onDidDelete(handler));
  };

  disposables.push(vscode.workspace.onDidSaveTextDocument(() => scheduleScan()));
  registerWatcher("**/*", (uri) => {
    if (!isGitPath(uri)) scheduleScan();
  });
  registerWatcher("**/.git/HEAD", scheduleScan);
  registerWatcher("**/.git/refs/**", scheduleScan);
  registerWatcher("**/.git/packed-refs", scheduleScan);

  watcherDisposable = {
    _items: disposables,
    dispose() {
      stopWatching();
    }
  };
  initialTimer = setTimeout(() => {
    initialTimer = null;
    scanAndIndex();
  }, INITIAL_SCAN_DELAY_MS);
  return watcherDisposable;
}

function stopWatching() {
  if (scanTimer) clearTimeout(scanTimer);
  if (initialTimer) clearTimeout(initialTimer);
  scanTimer = null;
  initialTimer = null;
  rerunQueued = false;
  if (activeController) activeController.abort();
  const disposable = watcherDisposable;
  watcherDisposable = null;
  if (disposable && Array.isArray(disposable._items)) {
    for (const item of disposable._items) {
      try { item.dispose(); } catch {}
    }
  }
  hideStatus();
  getConnectionRef = null;
  vscodeRef = null;
}

function triggerIndexNow() {
  if (scanTimer) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  return scanAndIndex();
}

module.exports = { formatProgress, isGitPath, scanAndIndex, scheduleScan, startWatching, stopWatching, triggerIndexNow };
