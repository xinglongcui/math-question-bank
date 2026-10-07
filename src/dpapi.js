import { spawn } from "node:child_process";

const ENTROPY = "MathQuestionBank:credential-v1";

const PROTECT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputText = [Console]::In.ReadToEnd().Trim()
$plain = [Convert]::FromBase64String($inputText)
$entropy = [Text.Encoding]::UTF8.GetBytes('${ENTROPY}')
$cipher = [Security.Cryptography.ProtectedData]::Protect(
  $plain,
  $entropy,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Convert]::ToBase64String($cipher))
`;

const UNPROTECT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputText = [Console]::In.ReadToEnd().Trim()
$cipher = [Convert]::FromBase64String($inputText)
$entropy = [Text.Encoding]::UTF8.GetBytes('${ENTROPY}')
$plain = [Security.Cryptography.ProtectedData]::Unprotect(
  $cipher,
  $entropy,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Convert]::ToBase64String($plain))
`;

function runPowerShell(script, input, signal) {
  if (process.platform !== "win32") {
    throw new Error("Secure credential storage requires Windows DPAPI");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, signal },
    );
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Windows DPAPI operation failed (${code}): ${Buffer.concat(stderr).toString("utf8").trim()}`));
        return;
      }
      try {
        resolve(Buffer.from(Buffer.concat(stdout).toString("utf8").trim(), "base64"));
      } catch (error) {
        reject(new Error("Windows DPAPI returned invalid data", { cause: error }));
      }
    });
    child.stdin.end(input.toString("base64"));
  });
}

export class DpapiProtector {
  protect(plain, { signal } = {}) {
    return runPowerShell(PROTECT_SCRIPT, Buffer.from(plain), signal);
  }

  unprotect(cipher, { signal } = {}) {
    return runPowerShell(UNPROTECT_SCRIPT, Buffer.from(cipher), signal);
  }
}
