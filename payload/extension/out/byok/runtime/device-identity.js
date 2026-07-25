"use strict";

const os = require("os");
const { normalizeString } = require("../infra/util");

// 设备标识用于 LCE relay 的设备绑定（防账号共用）：
// - clientId 取 vscode.env.machineId（同机器稳定，不含隐私信息）；
// - 登录时随 /api/auth/device 注册设备，之后每个 relay 请求带 x-client-id 头。
// 只发往 LCE relay；LLM provider 请求不得携带（避免向第三方泄露机器标识）。
let cachedClientId = "";
let cachedClientName = "";

function initDeviceIdentity(vscode) {
  cachedClientId = normalizeString(vscode && vscode.env && vscode.env.machineId) || "";
  try {
    cachedClientName = normalizeString(os.hostname()) || "";
  } catch {
    cachedClientName = "";
  }
}

function getDeviceIdentity() {
  return { clientId: cachedClientId, clientName: cachedClientName };
}

function applyClientIdHeader(headers) {
  if (!headers || typeof headers !== "object") return headers;
  if (cachedClientId && headers["x-client-id"] === undefined) headers["x-client-id"] = cachedClientId;
  return headers;
}

function resetDeviceIdentityForTest() {
  cachedClientId = "";
  cachedClientName = "";
}

module.exports = { initDeviceIdentity, getDeviceIdentity, applyClientIdHeader, resetDeviceIdentityForTest };
