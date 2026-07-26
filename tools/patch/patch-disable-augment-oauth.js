"use strict";

const { replaceOnce } = require("../lib/patch");
const { loadPatchText, savePatchText } = require("./patch-target");

const MARKER = "__augment_byok_oauth_replaced_v1";
const AUTH_RELOAD_MARKER = "__augment_byok_auth_reload_webview_v1";

function patchDisableAugmentOAuth(extJsPath) {
  const p = String(extJsPath || "");
  if (!p) throw new Error("patchDisableAugmentOAuth: missing extJsPath");

  const { original, alreadyPatched } = loadPatchText(p, { marker: MARKER });
  if (alreadyPatched) return { changed: false, reason: "already_patched" };

  let src = original;
  const lceCmd = 'require("vscode").commands.executeCommand("augment-byok.loginLCE")';

  // Entry 1: Sign In command handler
  const target1 = "await this._oauthFlow.startFlow()";
  src = replaceOnce(src, target1, `await ${lceCmd}`, "patchDisableAugmentOAuth command OAuth entry");

  // Entry 2: sidebar panel sign-in action
  const target2 = "this._oauthFlow.startFlow(!1)";
  src = replaceOnce(src, target2, lceCmd, "patchDisableAugmentOAuth panel OAuth entry");

  // Entry 3: patch canRun() so signIn command is not gated behind useOAuth
  const target3 = "canRun(){return this._auth.useOAuth?this.commandID===Die.signOutCommandID?this._auth.isLoggedIn===!0:!this._auth.isLoggedIn:!1}";
  src = replaceOnce(
    src,
    target3,
    "canRun(){return this.commandID===Die.signOutCommandID?this._auth.isLoggedIn===!0:!0}",
    "patchDisableAugmentOAuth canRun useOAuth gate"
  );

  // Preserve existing lifecycle Promises used by explicit reload commands.
  src = replaceOnce(
    src,
    "const P=r,H=++n;i(P).then(",
    "const P=r,H=++n;return i(P).then(",
    "patchDisableAugmentOAuth enable lifecycle Promise"
  );
  src = replaceOnce(
    src,
    "a(r),l(`reload (${L})`)}",
    "a(r);return l(`reload (${L})`)}",
    "patchDisableAugmentOAuth reload lifecycle Promise"
  );
  src = replaceOnce(
    src,
    "await this._mainPanelWebview.loadHTML(this._extensionUri)}};",
    `await this._mainPanelWebview.loadHTML(this._extensionUri)}async reloadWebview(){/*${AUTH_RELOAD_MARKER}*/if(!this._mainPanelWebview||!this._webviewView)return;await this._mainPanelWebview.loadHTML(this._extensionUri)}};`,
    "patchDisableAugmentOAuth main panel reload method"
  );
  src = replaceOnce(
    src,
    'A.onDidChangeSession(()=>{c("auth session change")})',
    "A.onDidChangeSession(async()=>{await V.reloadWebview()})",
    "patchDisableAugmentOAuth auth session reload listener"
  );

  savePatchText(p, src, { marker: MARKER });
  return { changed: true, reason: "patched" };
}

module.exports = { AUTH_RELOAD_MARKER, patchDisableAugmentOAuth };
