const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  AUTH_RELOAD_MARKER,
  patchDisableAugmentOAuth
} = require("../tools/patch/patch-disable-augment-oauth");

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function fixtureSource() {
  return [
    `"use strict";`,
    `var cKr=class Kie{`,
    `  _webviewView=void 0;`,
    `  _mainPanelWebview=void 0;`,
    `  async resolveWebviewView(){await this._mainPanelWebview.loadHTML(this._extensionUri)}`,
    `};`,
    `function drn(e){`,
    `  let r,n=0;`,
    `  async function i(L){await L.enable()}`,
    `  function a(L){L.disable()}`,
    "  function l(L){if(!r){t.warn(`Skipping enable cycle for '${L}' because the extension is undefined`);return}const P=r,H=++n;i(P).then(()=>{if(H!==n){t.debug(`Skipping stale post-enable UI finalization after '${L}'`);return}o(L)}).catch(re=>{if(H!==n){t.debug(`Ignoring stale enable failure after '${L}'`,re);return}t.error(`Failed to enable extension after '${L}'`,re)})}",
    "  function c(L){if(!r){t.warn(`Skipping reload due to '${L}' because the extension is undefined`);return}t.info(`======== Reloading extension due to ${L} ========`),a(r),l(`reload (${L})`)}",
    `  const A={onDidChangeSession(){}},V=new cKr(e.extensionUri,A);`,
    `  e.subscriptions.push(A.onDidChangeSession(()=>{c("auth session change")})),e.subscriptions.push(he.window.registerWebviewViewProvider("augment-chat",V,{webviewOptions:{retainContextWhenHidden:!0}}));`,
    `}`,
    `class OAuthCommand{`,
    `  async run(){await this._oauthFlow.startFlow()}`,
    `  open(){this._oauthFlow.startFlow(!1)}`,
    `  canRun(){return this._auth.useOAuth?this.commandID===Die.signOutCommandID?this._auth.isLoggedIn===!0:!this._auth.isLoggedIn:!1}`,
    `}`
  ].join("");
}

test("patchDisableAugmentOAuth: reloads retained webview without restarting services", () => {
  withTempDir("augment-byok-oauth-", (dir) => {
    const filePath = path.join(dir, "extension.js");
    fs.writeFileSync(filePath, fixtureSource(), "utf8");

    const r1 = patchDisableAugmentOAuth(filePath);
    assert.equal(r1.changed, true);

    const out1 = fs.readFileSync(filePath, "utf8");
    assert.ok(out1.includes("__augment_byok_oauth_replaced_v1"));
    assert.ok(out1.includes(AUTH_RELOAD_MARKER));
    assert.ok(out1.includes("const P=r,H=++n;return i(P).then("));
    assert.ok(out1.includes("a(r);return l(`reload (${L})`)}"));
    assert.ok(out1.includes("async reloadWebview()"));
    assert.ok(out1.includes("A.onDidChangeSession(async()=>{await V.reloadWebview()})"));
    assert.equal(out1.includes('c("auth session change")'), false);
    assert.equal(out1.includes("._oauthFlow.startFlow("), false);
    assert.doesNotThrow(() => new Function(out1));

    const r2 = patchDisableAugmentOAuth(filePath);
    assert.equal(r2.changed, false);
    assert.equal(fs.readFileSync(filePath, "utf8"), out1);
  });
});

test("patchDisableAugmentOAuth: fails fast when lifecycle shape drifts", () => {
  withTempDir("augment-byok-oauth-drift-", (dir) => {
    const filePath = path.join(dir, "extension.js");
    const src = fixtureSource().replace(
      "await this._mainPanelWebview.loadHTML(this._extensionUri)",
      "await this._mainPanelWebview.render(this._extensionUri)"
    );
    fs.writeFileSync(filePath, src, "utf8");

    assert.throws(
      () => patchDisableAugmentOAuth(filePath),
      /main panel reload method needle not found/
    );
    assert.equal(fs.readFileSync(filePath, "utf8"), src);
  });
});
