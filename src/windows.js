const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

async function powershell(script, timeout = 8000) {
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script
  ], { windowsHide: true, timeout, maxBuffer: 1024 * 1024 });
  return String(stdout || '').trim();
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, Number(n))); }

async function setBrightness(value) {
  const level = clamp(value, 0, 100);
  const script = "$m=Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods; if(-not $m){throw 'Windows did not expose software brightness control for this display.'}; $m | ForEach-Object { [void]$_.WmiSetBrightness(0," + level + ") }; Write-Output '" + level + "'";
  await powershell(script);
  return 'Brightness set to ' + level + '%';
}
async function getBrightness() {
  const out = await powershell("$b=Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1 -ExpandProperty CurrentBrightness; if($null -eq $b){throw 'Brightness telemetry is unavailable.'}; Write-Output $b");
  return Number(out);
}
async function brightnessDelta(delta) {
  const current = await getBrightness();
  return setBrightness(current + Number(delta || 10));
}
async function key(code, count = 1) {
  const c = Number(code), n = Math.max(1, Math.min(20, Number(count) || 1));
  const script = "Add-Type @'\nusing System;\nusing System.Runtime.InteropServices;\npublic static class JarvisKeys {\n [DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);\n}\n'@; for($i=0;$i -lt " + n + ";$i++){ [JarvisKeys]::keybd_event(" + c + ",0,0,[UIntPtr]::Zero); [JarvisKeys]::keybd_event(" + c + ",0,2,[UIntPtr]::Zero); Start-Sleep -Milliseconds 35 }";
  await powershell(script);
}
async function volume(action) {
  const codes = { up: 0xAF, down: 0xAE, mute: 0xAD };
  if (!(action in codes)) throw Error('Unknown volume action.');
  await key(codes[action], action === 'mute' ? 1 : 2);
  return action === 'mute' ? 'Volume muted/unmuted' : 'Volume ' + action;
}
async function media(action) {
  const codes = { playpause: 0xB3, next: 0xB0, previous: 0xB1, stop: 0xB2 };
  if (!(action in codes)) throw Error('Unknown media action.');
  await key(codes[action]);
  return 'Media ' + action;
}
async function settings(page = '') {
  const uri = page ? 'ms-settings:' + String(page).replace(/^ms-settings:/i,'') : 'ms-settings:';
  const { shell } = require('electron');
  await shell.openExternal(uri);
  return 'Opened Windows Settings' + (page ? ' (' + page + ')' : '');
}
async function power(action) {
  const map = {
    sleep: ['rundll32.exe', ['powrprof.dll,SetSuspendState','0','1','0']],
    restart: ['shutdown.exe', ['/r','/t','0']],
    shutdown: ['shutdown.exe', ['/s','/t','0']]
  };
  if (!map[action]) throw Error('Unsupported power action.');
  await execFileAsync(map[action][0], map[action][1], { windowsHide: true });
  return 'PC ' + action + ' requested';
}
async function wifiStatus() {
  return powershell("Get-NetAdapter -Physical | Where-Object Status -ne 'Disabled' | Select-Object Name,Status,LinkSpeed | ConvertTo-Json -Compress");
}
module.exports = { setBrightness, getBrightness, brightnessDelta, volume, media, settings, power, wifiStatus };