const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatProgress,
  isGitPath,
  startWatching,
  stopWatching,
  triggerIndexNow
} = require("../payload/extension/out/byok/runtime/lce/auto-index");
const { createIndexJob, uploadIndexBatch } = require("../payload/extension/out/byok/runtime/lce/index-relay");
const { createWorkspaceFixture } = require("./lce-workspace-fixture");

test("LCE status progress includes file and chunk counts", () => {
  assert.equal(formatProgress({
    totalFiles: 8,
    indexedFiles: 2,
    totalChunks: 40,
    indexedChunks: 10,
    chunkCountEstimated: true
  }), "25% 2/8 files | ~10/~40 chunks");
});

test("LCE general watcher ignores git internals", () => {
  assert.equal(isGitPath({ fsPath: String.raw`C:\repo\.git\index` }), true);
  assert.equal(isGitPath({ path: "/repo/.git/refs/heads/main" }), true);
  assert.equal(isGitPath({ path: "/repo/src/git-client.js" }), false);
});

test("LCE index relay sends manifests and pending content to the new protocol", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ job: { id: "job-1" }, pendingFiles: ["src/index.js"] })
    };
  };

  try {
    const connection = { completionURL: "https://relay.example/relay/", apiToken: "token-1" };
    const file = {
      path: "src/index.js",
      hash: "hash-1",
      size: 12,
      estimatedChunks: 1,
      content: "const x = 1;"
    };
    await createIndexJob(connection, {
      workspaceId: "workspace-1",
      workspaceName: "workspace",
      branch: "main",
      revision: "abc",
      files: [file],
      unreadableFiles: ["locked/secret.txt"]
    });
    await uploadIndexBatch(connection, "job-1", [file]);
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://relay.example/relay/index-jobs");
  assert.equal(calls[1].url, "https://relay.example/relay/remote-index");
  assert.equal(calls[0].init.headers.authorization, "Bearer token-1");
  assert.deepEqual(JSON.parse(calls[0].init.body).files, [{
    path: "src/index.js",
    hash: "hash-1",
    size: 12,
    estimatedChunks: 1
  }]);
  assert.deepEqual(JSON.parse(calls[0].init.body).unreadableFiles, ["locked/secret.txt"]);
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    jobId: "job-1",
    files: [{
      path: "src/index.js",
      hash: "hash-1",
      content: "const x = 1;",
      estimatedChunks: 1
    }]
  });
});

test("LCE watchers dispose every listener and watcher", () => {
  const disposed = [];
  const disposable = (name) => ({ dispose: () => disposed.push(name) });
  let watcherNumber = 0;
  const vscode = {
    StatusBarAlignment: { Left: 1 },
    window: {
      createStatusBarItem: () => ({ show() {}, dispose() {} })
    },
    workspace: {
      workspaceFolders: [],
      onDidSaveTextDocument: () => disposable("save"),
      createFileSystemWatcher: () => {
        watcherNumber += 1;
        const id = watcherNumber;
        return {
          dispose: () => disposed.push(`watcher-${id}`),
          onDidCreate: () => disposable(`create-${id}`),
          onDidChange: () => disposable(`change-${id}`),
          onDidDelete: () => disposable(`delete-${id}`)
        };
      }
    }
  };

  const watcher = startWatching(vscode, {
    getConnection: () => ({ completionURL: "https://relay.example/relay/", apiToken: "session-token" })
  });
  watcher.dispose();
  assert.equal(disposed.length, 17);
  assert.equal(disposed.includes("save"), true);
  assert.equal(disposed.includes("watcher-4"), true);
  stopWatching();
});

test("LCE true empty workspace still creates a job so stale indexes are cleared", async () => {
  const fixture = createWorkspaceFixture({
    primary: [],
    directories: { "": [] }
  });
  let statusText = "";
  const fetchCalls = [];
  const disposable = () => ({ dispose() {} });
  fixture.vscode.StatusBarAlignment = { Left: 1 };
  fixture.vscode.window = {
    createStatusBarItem: () => ({
      set text(value) { statusText = value; },
      get text() { return statusText; },
      show() {},
      dispose() {}
    })
  };
  fixture.vscode.workspace.onDidSaveTextDocument = disposable;
  fixture.vscode.workspace.createFileSystemWatcher = () => ({
    dispose() {},
    onDidCreate: disposable,
    onDidChange: disposable,
    onDidDelete: disposable
  });

  const emptyJob = { id: "job-empty", totalFiles: 0, indexedFiles: 0, deletedCount: 0 };
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ job: emptyJob, pendingFiles: [], deletedFiles: [] })
    };
  };
  try {
    startWatching(fixture.vscode, {
      getConnection: () => ({ completionURL: "https://relay.example/relay/", apiToken: "session-token" })
    });
    const result = await triggerIndexNow();
    assert.equal(result.id, "job-empty");
    assert.deepEqual(fetchCalls.map((call) => call.url), [
      "https://relay.example/relay/index-jobs",
      "https://relay.example/relay/index-jobs/job-empty/complete"
    ]);
    assert.deepEqual(JSON.parse(fetchCalls[0].init.body).files, []);
    assert.match(statusText, /LCE: no indexable files/);
  } finally {
    stopWatching();
    global.fetch = originalFetch;
  }
});
