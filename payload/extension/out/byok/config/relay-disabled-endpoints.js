"use strict";

const RELAY_DISABLED_AUXILIARY_ENDPOINTS = Object.freeze([
  "/agents/list-remote-tools",
  "/subscription-banner",
  "/notifications/read",
  "/notifications/mark-as-read",
  "/report-error",
  "/record-request-events"
]);

module.exports = { RELAY_DISABLED_AUXILIARY_ENDPOINTS };
