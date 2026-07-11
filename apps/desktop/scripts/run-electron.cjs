const { spawn } = require("node:child_process");

function sanitizedElectronEnvironment(source = process.env) {
  const environment = { ...source };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

function runElectron(args = process.argv.slice(2)) {
  const electronPath = require("electron");
  const child = spawn(electronPath, args, {
    cwd: process.cwd(),
    env: sanitizedElectronEnvironment(),
    stdio: "inherit",
    windowsHide: false,
  });

  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));

  child.once("error", (error) => {
    console.error("Failed to launch Electron.", error);
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
  return child;
}

if (require.main === module) runElectron();

module.exports = { runElectron, sanitizedElectronEnvironment };
