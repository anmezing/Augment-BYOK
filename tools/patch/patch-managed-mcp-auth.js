"use strict";

const { replaceOnce } = require("../lib/patch");
const { loadPatchText, savePatchText } = require("./patch-target");

const MARKER = "__augment_byok_managed_mcp_auth_v1";
const VALIDATION_NEEDLE = 'async getAuthHeaders(t){if(!t.name){this._logger.error("MCP server config is missing name");return}';
const MANAGED_AUTH_BYPASS = `if(t.id==="augment-byok-lce"&&(t.type==="http"||t.type==="sse")&&t.headers){/*${MARKER}*/return t.headers}`;

function patchManagedMcpAuth(extJsPath) {
  const filePath = String(extJsPath || "");
  if (!filePath) throw new Error("patchManagedMcpAuth: missing extJsPath");

  const { original, alreadyPatched } = loadPatchText(filePath, { marker: MARKER });
  if (alreadyPatched) return { changed: false, reason: "already_patched" };

  const next = replaceOnce(
    original,
    VALIDATION_NEEDLE,
    `${VALIDATION_NEEDLE}${MANAGED_AUTH_BYPASS}`,
    "patchManagedMcpAuth getAuthHeaders validation"
  );
  savePatchText(filePath, next, { marker: MARKER });
  return { changed: true, reason: "patched" };
}

module.exports = { MANAGED_AUTH_BYPASS, MARKER, patchManagedMcpAuth };
