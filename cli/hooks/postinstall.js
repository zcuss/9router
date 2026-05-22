#!/usr/bin/env node

// Postinstall: warm-up SQLite deps into ~/.9router/runtime so the first
// `9router` start doesn't need network. Failure here is non-fatal —
// cli.js will retry at runtime if anything is missing.
const { ensureSqliteRuntime } = require("./sqliteRuntime");
const { ensureTrayRuntime } = require("./trayRuntime");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const isWin = process.platform === "win32";
const appDataDir = isWin
  ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router")
  : path.join(os.homedir(), ".9router");
const restartMarker = path.join(appDataDir, "update-restart.json");

try {
  ensureSqliteRuntime({ silent: false });
  console.log("[9router] runtime SQLite deps ready");
} catch (e) {
  console.warn(`[9router] runtime warm-up skipped: ${e.message}`);
}

try {
  ensureTrayRuntime({ silent: false });
} catch (e) {
  console.warn(`[9router] tray runtime skipped: ${e.message}`);
}

try {
  if (fs.existsSync(restartMarker)) {
    const meta = JSON.parse(fs.readFileSync(restartMarker, "utf8"));
    fs.rmSync(restartMarker, { force: true });

    if (meta && meta.restart) {
      const cliPath = path.join(__dirname, "..", "cli.js");
      const port = Number(meta.port) || 20128;
      const args = [cliPath, "--skip-update", "-p", String(port)];
      if (meta.tray !== false) args.push("--tray");

      const detached = spawn(process.execPath, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: process.env,
      });
      detached.unref();
      console.log(`[9router] restarted after update (port ${port}${meta.tray !== false ? ", tray" : ""})`);
    }
  }
} catch (e) {
  console.warn(`[9router] restart skipped: ${e.message}`);
}

process.exit(0);
