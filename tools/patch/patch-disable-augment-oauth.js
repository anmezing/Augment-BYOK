"use strict";

const fs = require("fs");

function patchDisableAugmentOAuth(extJsPath) {
  const p = String(extJsPath || "");
  if (!p) throw new Error("patchDisableAugmentOAuth: missing extJsPath");

  let src = fs.readFileSync(p, "utf8");

  const marker = "__augment_byok_oauth_disabled_v1";
  if (src.includes(marker)) return;

  const target = '"https://auth.augmentcode.com"';
  if (!src.includes(target)) {
    throw new Error("patchDisableAugmentOAuth: auth.augmentcode.com URL not found in extension.js");
  }

  src = src.replace(target, '"https://127.0.0.1:0/oauth-disabled"');

  const markerInsert = `/* ${marker} */`;
  src = markerInsert + src;
  fs.writeFileSync(p, src, "utf8");
}

module.exports = { patchDisableAugmentOAuth };
