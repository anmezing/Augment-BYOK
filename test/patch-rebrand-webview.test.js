const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { patchRebrandWebview, WEBVIEW_REBRAND_MARKER } = require("../tools/patch/patch-rebrand-webview");

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeUtf8(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function makeExtDir(dir) {
  const extDir = path.join(dir, "extension");
  const webviewsDir = path.join(extDir, "common-webviews");
  const assetsDir = path.join(webviewsDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  return { extDir, webviewsDir, assetsDir };
}

test("patchRebrandWebview: rebrands visible strings, appends marker, rewrites html title", () => {
  withTempDir("augment-byok-webview-rebrand-", (dir) => {
    const { extDir, webviewsDir, assetsDir } = makeExtDir(dir);
    const mainPanelJs = path.join(assetsDir, "MainPanel-abc.js");
    const otherJs = path.join(assetsDir, "chat-def.js");
    const untouchedJs = path.join(assetsDir, "vendor-xyz.js");
    const html = path.join(webviewsDir, "main-panel.html");

    writeUtf8(mainPanelJs, 'var u=ne("augment code");var w=k("Welcome to Augment!");st.augmentLink;window.augmentDeps;');
    writeUtf8(otherJs, 'label("Augment Context Engine");');
    writeUtf8(untouchedJs, 'console.log("no brand strings here");');
    writeUtf8(html, "<html><head><title>Augment</title></head></html>");

    const res = patchRebrandWebview(extDir);

    assert.equal(res.changed, true);
    assert.deepEqual(res.patched.sort(), ["MainPanel-abc.js", "chat-def.js"]);

    const mainOut = readUtf8(mainPanelJs);
    assert.equal(mainOut.includes('"augment code"'), false);
    assert.equal(mainOut.includes('ne("LCE")'), true);
    assert.equal(mainOut.includes("Welcome to LCE!"), true);
    // 代码标识符不受影响
    assert.equal(mainOut.includes("st.augmentLink"), true);
    assert.equal(mainOut.includes("window.augmentDeps"), true);
    assert.equal(mainOut.includes(WEBVIEW_REBRAND_MARKER), true);

    assert.equal(readUtf8(otherJs).includes("LCE Context Engine"), true);
    assert.equal(readUtf8(untouchedJs).includes(WEBVIEW_REBRAND_MARKER), false);
    assert.equal(readUtf8(html), "<html><head><title>LCE</title></head></html>");
  });
});

test("patchRebrandWebview: idempotent rerun after wordmark already replaced", () => {
  withTempDir("augment-byok-webview-rebrand-", (dir) => {
    const { extDir, assetsDir } = makeExtDir(dir);
    const mainPanelJs = path.join(assetsDir, "MainPanel-abc.js");
    writeUtf8(mainPanelJs, 'var u=ne("augment code");');

    patchRebrandWebview(extDir);
    const once = readUtf8(mainPanelJs);
    const res = patchRebrandWebview(extDir);
    assert.equal(res.changed, false);
    assert.equal(readUtf8(mainPanelJs), once);
  });
});

test("patchRebrandWebview: throws when sign-in wordmark needle missing on fresh assets", () => {
  withTempDir("augment-byok-webview-rebrand-", (dir) => {
    const { extDir, assetsDir } = makeExtDir(dir);
    writeUtf8(path.join(assetsDir, "MainPanel-abc.js"), 'label("Augment Context Engine");');

    assert.throws(() => patchRebrandWebview(extDir), /required needle/);
  });
});
