const crypto = require("node:crypto");
const path = require("node:path");

const HANDLE_PREFIX = "selected-file:";

function isAbsoluteLocalPath(value) {
  return path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

function createFileSelectionBroker({
  getPathForFile,
  preparePaths,
  randomUUID = () => crypto.randomUUID(),
  maxHandles = 48,
  allowFixturePaths = false,
} = {}) {
  if (typeof getPathForFile !== "function") throw new TypeError("getPathForFile is required");
  if (typeof preparePaths !== "function") throw new TypeError("preparePaths is required");
  const handles = new Map();

  function remember(file) {
    let filePath = "";
    try {
      filePath = String(getPathForFile(file) || "").trim();
    } catch {
      return "";
    }
    if (!filePath || !isAbsoluteLocalPath(filePath)) return "";
    while (handles.size >= maxHandles) handles.delete(handles.keys().next().value);
    const handle = `${HANDLE_PREFIX}${randomUUID()}`;
    handles.set(handle, filePath);
    return handle;
  }

  async function prepare(values) {
    if (!Array.isArray(values)) throw new Error("File handles must be an array");
    const resolved = [];
    const consumed = [];
    for (const value of values) {
      const handle = String(value || "");
      const selectedPath = handles.get(handle);
      if (selectedPath) {
        resolved.push(selectedPath);
        consumed.push(handle);
        continue;
      }
      if (allowFixturePaths && isAbsoluteLocalPath(handle)) {
        resolved.push(handle);
        continue;
      }
      throw new Error("File selection expired or was not created from a trusted file drop");
    }
    try {
      return await preparePaths(resolved);
    } finally {
      for (const handle of consumed) handles.delete(handle);
    }
  }

  return { remember, prepare, pendingCount: () => handles.size };
}

module.exports = { HANDLE_PREFIX, createFileSelectionBroker, isAbsoluteLocalPath };
