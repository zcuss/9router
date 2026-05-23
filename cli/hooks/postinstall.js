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

function ensureWindowsBinAlias() {
  if (!isWin) return;
  try {
    const prefix = process.env.npm_config_prefix || path.dirname(process.execPath);
    const cliPath = path.join(__dirname, "..", "cli.js");
    const cmdPath = path.join(prefix, "0router.cmd");
    const ps1Path = path.join(prefix, "0router.ps1");
    const shPath = path.join(prefix, "0router");

    const cmdContent = `@ECHO off\r\nSETLOCAL\r\n"${process.execPath}" "${cliPath}" %*\r\n`;
    const ps1Content = `#!/usr/bin/env pwsh\r\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\r\n& "${process.execPath}" "${cliPath}" $args\r\n`;
    const shContent = `#!/bin/sh\n\"${process.execPath.replace(/\\/g, "\\\\")}\" \"${cliPath.replace(/\\/g, "\\\\")}\" \"$@\"\n`;

    fs.writeFileSync(cmdPath, cmdContent, "utf8");
    fs.writeFileSync(ps1Path, ps1Content, "utf8");
    fs.writeFileSync(shPath, shContent, "utf8");
    console.log("[9router] ensured Windows command alias: 0router");
  } catch (e) {
    console.warn(`[9router] alias creation skipped: ${e.message}`);
  }
}

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

ensureWindowsBinAlias();

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
