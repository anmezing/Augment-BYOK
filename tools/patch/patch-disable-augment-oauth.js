"use strict";

const fs = require("fs");

function patchDisableAugmentOAuth(extJsPath) {
  const p = String(extJsPath || "");
  if (!p) throw new Error("patchDisableAugmentOAuth: missing extJsPath");

  let src = fs.readFileSync(p, "utf8");

  const marker = "__augment_byok_oauth_replaced_v1";
  if (src.includes(marker)) return;

  const target = "await this._oauthFlow.startFlow()";
  if (!src.includes(target)) {
    throw new Error("patchDisableAugmentOAuth: _oauthFlow.startFlow() not found in extension.js");
  }

  src = src.replace(
    target,
    'await require("vscode").commands.executeCommand("augment-byok.loginLCE")'
  );

  const markerInsert = `/* ${marker} */`;
  src = markerInsert + src;
  fs.writeFileSync(p, src, "utf8");
}

module.exports = { patchDisableAugmentOAuth };
