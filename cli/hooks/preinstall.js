#!/usr/bin/env node

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const isWin = process.platform === "win32";
const appDataDir = isWin
  ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router")
  : path.join(os.homedir(), ".9router");
const restartMarker = path.join(appDataDir, "update-restart.json");

function cleanupWindowsGlobalShims() {
  if (!isWin) return;

  const candidates = new Set();
  const npmPrefix = process.env.npm_config_prefix;
  if (npmPrefix) candidates.add(path.join(npmPrefix, "0router.cmd"));

  const nodeDir = path.dirname(process.execPath || "");
  if (nodeDir) {
    candidates.add(path.join(nodeDir, "0router.cmd"));
    candidates.add(path.join(nodeDir, "0router"));
  }

  for (const shimPath of candidates) {
    try {
      if (fs.existsSync(shimPath)) fs.rmSync(shimPath, { force: true });
    } catch {}
  }
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function getWindowsProcesses() {
  try {
    const output = execSync(
      "powershell -NoProfile -NonInteractive -Command \"Get-CimInstance Win32_Process -Filter 'Name=\\\"node.exe\\\"' | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation\"",
      { encoding: "utf8", windowsHide: true, timeout: 10000 }
    );
    return output
      .split(/\r?\n/)
      .slice(1)
      .filter(Boolean)
      .map((line) => {
        const [pid, commandLine] = parseCsvLine(line);
        return { pid: Number(pid), commandLine: commandLine || "" };
      })
      .filter((p) => p.pid && p.pid !== process.pid);
  } catch {
    return [];
  }
}

function getUnixProcesses() {
  try {
    const output = execSync("ps -eo pid=,command=", { encoding: "utf8", timeout: 10000 });
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s+(.+)$/);
        return match ? { pid: Number(match[1]), commandLine: match[2] } : null;
      })
      .filter((p) => p && p.pid !== process.pid);
  } catch {
    return [];
  }
}

function isInstallerOrCurrentFlow(commandLine) {
  const cmd = String(commandLine || "").toLowerCase();
  return (
    cmd.includes("npm install") ||
    cmd.includes("npm.cmd install") ||
    cmd.includes("npm-cli.js") ||
    cmd.includes("hooks/preinstall.js") ||
    cmd.includes("hooks\\preinstall.js") ||
    cmd.includes("_cacache") ||
    cmd.includes("\\temp\\npm-")
  );
}

function is9routerProcess(commandLine) {
  const cmd = String(commandLine || "").toLowerCase();
  if (isInstallerOrCurrentFlow(cmd)) return false;

  return (
    (cmd.includes("0router") && (cmd.includes("cli.js") || cmd.includes("server.js"))) ||
    (cmd.includes(".9router") && cmd.includes("runtime") && cmd.includes("app") && cmd.includes("server.js")) ||
    cmd.includes("next-server")
  );
}

function extractPort(commandLine) {
  const cmd = String(commandLine || "");
  const match = cmd.match(/(?:--port|-p)\s+(\d+)/i) || cmd.match(/PORT=(\d+)/i);
  return match ? Number(match[1]) : 20128;
}

function wasTray(commandLine) {
  return /(?:--tray|-t)(?:\s|$)/i.test(String(commandLine || ""));
}

function killPid(pid) {
  try {
    if (isWin) {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore", windowsHide: true, timeout: 5000 });
    } else {
      try { process.kill(pid, "SIGTERM"); } catch {}
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        try { process.kill(pid, 0); } catch { return; }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      }
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
  } catch {}
}

cleanupWindowsGlobalShims();

const running = (isWin ? getWindowsProcesses() : getUnixProcesses()).filter((p) => is9routerProcess(p.commandLine));

if (running.length > 0) {
  const primary = running.find((p) => /cli\.js/i.test(p.commandLine)) || running[0];
  try {
    fs.mkdirSync(appDataDir, { recursive: true });
    fs.writeFileSync(
      restartMarker,
      JSON.stringify({ restart: true, tray: wasTray(primary.commandLine), port: extractPort(primary.commandLine), at: Date.now() }, null, 2),
      "utf8"
    );
  } catch {}

  for (const proc of running) {
    killPid(proc.pid);
  }

  console.log(`[9router] stopped ${running.length} running process(es) before update`);
}
