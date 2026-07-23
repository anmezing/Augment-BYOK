"use strict";

const fs = require("fs");

function patchDisableAugmentOAuth(extJsPath) {
  const p = String(extJsPath || "");
  if (!p) throw new Error("patchDisableAugmentOAuth: missing extJsPath");

  let src = fs.readFileSync(p, "utf8");

  const marker = "__augment_byok_oauth_replaced_v1";
  if (src.includes(marker)) return;

  const lceCmd = 'require("vscode").commands.executeCommand("augment-byok.loginLCE")';

  // Entry 1: Sign In command handler
  const target1 = "await this._oauthFlow.startFlow()";
  if (!src.includes(target1)) {
    throw new Error("patchDisableAugmentOAuth: _oauthFlow.startFlow() [command] not found");
  }
  src = src.replace(target1, `await ${lceCmd}`);

  // Entry 2: sidebar panel sign-in action
  const target2 = "this._oauthFlow.startFlow(!1)";
  if (!src.includes(target2)) {
    throw new Error("patchDisableAugmentOAuth: _oauthFlow.startFlow(!1) [panel] not found");
  }
  src = src.replace(target2, lceCmd);

  // Entry 3: patch canRun() so signIn command is not gated behind useOAuth
  const target3 = "canRun(){return this._auth.useOAuth?this.commandID===Die.signOutCommandID?this._auth.isLoggedIn===!0:!this._auth.isLoggedIn:!1}";
  if (!src.includes(target3)) {
    throw new Error("patchDisableAugmentOAuth: canRun() useOAuth gate not found");
  }
  src = src.replace(target3, "canRun(){return this.commandID===Die.signOutCommandID?this._auth.isLoggedIn===!0:!0}");

  const markerInsert = `/* ${marker} */`;
  src = markerInsert + src;
  fs.writeFileSync(p, src, "utf8");
}

module.exports = { patchDisableAugmentOAuth };
