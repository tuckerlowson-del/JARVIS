const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, safeStorage, nativeImage } = require('electron');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const path = require('path');
const fs = require('fs');
const os = require('os');
const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const dgram = require('dgram');
const express = require('express');
const cron = require('node-cron');
let si = null;
function getSI(){ return si || (si = require('systeminformation')); }
const { WebSocketServer } = require('ws');
const { autoUpdater } = require('electron-updater');
const windows = require('./windows');

const PORT = 47821;
const APP_VERSION = app.getVersion();
const DEFAULT_UPDATE_FEED = String(process.env.JARVIS_UPDATE_FEED_URL || 'https://github.com/tuckerlowson-del/JARVIS/releases/latest').trim();
const DATA_DIR = () => path.join(app.getPath('userData'), 'data');
const DB_FILE = () => path.join(DATA_DIR(), 'database.json');
const SYSTEM_FAST_TTL = 1800;
const SYSTEM_FULL_TTL = 30000;
const DB_CACHE_TTL = 2500;

let win = null;
let httpServer = null;
let wss = null;
let serverStarted = false;
let systemCache = null;
let dbCache = null;
let dbCacheAt = 0;
let saveTimer = null;
let quitting = false;
const jobs = new Map();

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function freshDB() {
  return { settings: {}, memories: [], automations: [], history: [], devices: [], chat: [], pairedDevices: [] };
}

function readDB(force = false) {
  const now = Date.now();
  if (!force && dbCache && now - dbCacheAt < DB_CACHE_TTL) return dbCache;
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE(), 'utf8'));
    dbCache = { ...freshDB(), ...raw, settings: { ...freshDB().settings, ...(raw.settings || {}) } };
  } catch {
    dbCache = freshDB();
  }
  dbCacheAt = now;
  return dbCache;
}

function db() { return readDB(false); }

function persistDB(immediate = false) {
  if (saveTimer) clearTimeout(saveTimer);
  const write = () => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR(), { recursive: true });
      const tmp = `${DB_FILE()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(dbCache || freshDB(), null, 2), 'utf8');
      fs.renameSync(tmp, DB_FILE());
    } catch (e) {
      console.error('JARVIS database write failed:', e.message);
    }
  };
  if (immediate) write(); else saveTimer = setTimeout(write, 250);
}

function save(d) {
  dbCache = d;
  dbCacheAt = Date.now();
  persistDB(false);
}

function makePairingToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(5);
  return [...bytes].map(b => chars[b % chars.length]).join('');
}

function token() {
  const d = db();
  if (!/^[A-Z]{5}$/.test(d.settings.pairingToken || '')) {
    d.settings.pairingToken = makePairingToken();
    persistDB(true);
  }
  return d.settings.pairingToken;
}

function lanIP() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return '127.0.0.1';
}

function broadcast(type, data = {}) {
  const msg = { type, data, time: new Date().toISOString() };
  if (wss) for (const c of wss.clients) if (c.readyState === 1) c.send(JSON.stringify(msg));
  if (win && !win.isDestroyed()) win.webContents.send('event', msg);
}

function notify(title, message, kind = 'success') {
  broadcast('notification', { title, message, kind, duration: 5000 });
}

function log(kind, message) {
  const d = db();
  d.history.push({ id: crypto.randomUUID(), kind, message, time: new Date().toISOString() });
  d.history = d.history.slice(-250);
  save(d);
  broadcast('activity', { kind, message });
}

async function system(forceFull = false) {
  const now = Date.now();
  const visible = !!(win && !win.isMinimized() && win.isVisible());
  const fastTTL = visible ? SYSTEM_FAST_TTL : 10000;
  const fastFresh = systemCache && now - systemCache.fastAt < fastTTL;
  const fullFresh = systemCache && now - systemCache.fullAt < SYSTEM_FULL_TTL;
  if (!forceFull && fastFresh && fullFresh) return systemCache;

  const api = getSI();
  const [load, mem] = await Promise.all([api.currentLoad(), api.mem()]);
  const r = systemCache || {
    cpu: {}, ram: {}, storage: [], network: [], gpu: [], battery: null,
    platform: process.platform, hostname: os.hostname(), uptime: 0, fastAt: 0, fullAt: 0
  };

  r.cpu = { load: Number(load.currentLoad) || 0, cores: os.cpus().length, model: os.cpus()[0]?.model || '' };
  r.ram = {
    total: mem.total,
    used: mem.used,
    free: mem.available,
    percent: mem.total ? (mem.used / mem.total) * 100 : 0
  };
  r.uptime = os.uptime();
  r.hostname = os.hostname();
  r.platform = process.platform;
  r.arch = process.arch;
  r.fastAt = now;

  if (forceFull || !fullFresh) {
    try {
      const [fsz, gpu, batt] = await Promise.all([api.fsSize(), api.graphics(), api.battery()]);
      r.storage = fsz.map(x => ({ mount: x.mount, size: x.size, used: x.used, percent: x.use }));
      r.gpu = (gpu.controllers || []).map(x => ({ model: x.model, vram: x.vram, util: x.utilizationGpu, temp: x.temperatureGpu }));
      r.battery = batt;
    } catch (e) {
      log('warning', `Hardware telemetry unavailable: ${e.message}`);
    }
    r.fullAt = Date.now();
  }

  systemCache = r;
  return r;
}

const allowedApps = {
  chrome: 'chrome.exe',
  edge: 'msedge.exe',
  vscode: 'Code.exe',
  notepad: 'notepad.exe',
  calculator: 'calc.exe',
  explorer: 'explorer.exe',
  terminal: 'wt.exe'
};

function launchProcess(executable, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function windowsAction(type, payload = {}) {
  if (process.platform !== 'win32') throw Error('Windows controls are only available on Windows.');
  if (type === 'brightness-set') return windows.setBrightness(payload.value);
  if (type === 'brightness-up') return windows.brightnessDelta(Math.abs(Number(payload.step || 10)));
  if (type === 'brightness-down') return windows.brightnessDelta(-Math.abs(Number(payload.step || 10)));
  if (type === 'brightness-get') return 'Brightness ' + await windows.getBrightness() + '%';
  if (type === 'volume-up') return windows.volume('up');
  if (type === 'volume-down') return windows.volume('down');
  if (type === 'volume-mute') return windows.volume('mute');
  if (type === 'media') return windows.media(String(payload.action || 'playpause'));
  if (type === 'settings') return windows.settings(String(payload.page || ''));
  if (type === 'power') return windows.power(String(payload.action || 'sleep'));
  if (type === 'wifi-status') return windows.wifiStatus();
  throw Error('Unknown Windows control');
}

async function action(type, payload = {}) {
  payload = payload || {};

  if (type === 'launch') {
    const name = String(payload.app || payload.target || '').trim().toLowerCase();
    const executable = allowedApps[name];
    if (!executable) throw Error(`Unsupported app. Available: ${Object.keys(allowedApps).join(', ')}`);

    // Explorer is intentionally launched directly instead of through PowerShell.
    // This avoids the PowerShell process/window handoff that can cause Explorer errors.
    await launchProcess(executable);
    const msg = `Launched ${name}`;
    log('action', msg);
    return msg;
  }

  if (type === 'url') {
    let u = String(payload.url || '').trim();
    if (!u) throw Error('No URL supplied');
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    if (!/^https?:\/\/[^\s]+$/i.test(u)) throw Error('Invalid URL');
    await shell.openExternal(u);
    const msg = `Opened ${u}`;
    log('action', msg);
    return msg;
  }

  if (type === 'lock') {
    await launchProcess('rundll32.exe', ['user32.dll,LockWorkStation']);
    log('action', 'PC locked');
    return 'PC locked';
  }

  if (['brightness-set','brightness-up','brightness-down','brightness-get','volume-up','volume-down','volume-mute','media','settings','power','wifi-status'].includes(type)) {
    const result = await windowsAction(type, payload);
    log('action', result);
    return result;
  }

  if (type === 'clipboard') {
    clipboard.writeText(String(payload.text || ''));
    return 'Clipboard updated';
  }

  if (type === 'notify') {
    notify(String(payload.title || 'JARVIS'), String(payload.body || ''));
    return 'Notification sent';
  }

  if (type === 'system') {
    const s = await system(false);
    return `CPU ${s.cpu.load.toFixed(0)}%, RAM ${s.ram.percent.toFixed(0)}%, uptime ${Math.floor(s.uptime / 3600)}h ${Math.floor((s.uptime % 3600) / 60)}m`;
  }

  if (type === 'scan-network') return (await scanNetwork()).summary;
  if (type === 'wol') return wol(payload.mac, payload.host || '255.255.255.255', payload.port || 9);
  throw Error('Unknown action');
}

function wol(mac, host = '255.255.255.255', port = 9) {
  return new Promise((resolve, reject) => {
    const clean = String(mac).replace(/[^a-fA-F0-9]/g, '');
    if (clean.length !== 12) return reject(Error('Invalid MAC address'));
    const macBuf = Buffer.from(clean.match(/.{2}/g).map(x => parseInt(x, 16)));
    const packet = Buffer.alloc(102, 0xff);
    for (let i = 0; i < 16; i++) macBuf.copy(packet, 6 + i * 6);
    const socket = dgram.createSocket('udp4');
    socket.once('error', e => { socket.close(); reject(e); });
    socket.send(packet, 0, packet.length, port, host, e => {
      socket.close();
      e ? reject(e) : resolve('Wake-on-LAN packet sent');
    });
  });
}

function auth(req, res, next) {
  if (req.path === '/' || req.path.startsWith('/phone') || req.path.startsWith('/assets')) return next();
  const t = req.headers['x-pairing-token'] || req.query.token;
  if (t !== token()) return res.status(401).json({ error: 'Pairing required' });
  next();
}

function ipv4Info() {
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family !== 'IPv4' || n.internal) continue;
      const ip = n.address.split('.').map(Number);
      const mask = (n.netmask || '255.255.255.0').split('.').map(Number);
      const network = ip.map((v, i) => v & mask[i]);
      const bits = mask.reduce((a, v) => a + (v >>> 0).toString(2).padStart(8, '0').split('1').length - 1, 0);
      return { name, ip: n.address, netmask: n.netmask || '255.255.255.0', network, hostBits: bits };
    }
  }
  return null;
}

function parseArp(text) {
  const out = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/\s*(\d+(?:\.\d+){3})\s+([0-9a-f-]{17})\s+(\w+)/i);
    if (m) out.set(m[1], { ip: m[1], mac: m[2], type: m[3], status: m[3].toLowerCase() === 'dynamic' ? 'online' : 'known' });
  }
  return out;
}

async function arpTable() {
  try {
    const { stdout } = await execFileAsync('arp.exe', ['-a'], { windowsHide: true, timeout: 4000 });
    return parseArp(stdout);
  } catch {
    return new Map();
  }
}

async function resolveDeviceName(ip) {
  try {
    const names = await Promise.race([
      dns.reverse(ip),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 700))
    ]);
    const name = Array.isArray(names) ? names[0] : '';
    if (name) return name.split('.')[0];
  } catch {}
  return '';
}

async function scanNetwork() {
  const info = ipv4Info();
  if (!info) return { ok: false, error: 'No active IPv4 network connection found.', devices: [], summary: 'No active IPv4 network connection found.' };

  // The scan is deliberately manual and bounded to /24 or smaller.
  const initial = await arpTable();
  const maxBits = Math.min(info.hostBits, 8);
  const size = 2 ** maxBits;
  const prefix = info.network.join('.').split('.').slice(0, 3).join('.');
  const candidates = [];
  for (let i = 1; i < size - 1; i++) {
    const ip = `${prefix}.${i}`;
    if (!initial.has(ip)) candidates.push(ip);
  }

  let cursor = 0;
  const found = new Map(initial);
  async function worker() {
    while (cursor < candidates.length) {
      const ip = candidates[cursor++];
      try {
        await execFileAsync('ping.exe', ['-n', '1', '-w', '120', ip], { windowsHide: true, timeout: 400 });
        found.set(ip, { ip, status: 'online', type: 'reachable' });
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  const after = await arpTable();
  for (const [ip, v] of after) if (found.has(ip)) found.set(ip, { ...found.get(ip), ...v, status: 'online' });

  const rawDevices = [...found.values()]
    .filter(x => x.ip !== info.ip)
    .sort((a, b) => a.ip.localeCompare(b.ip));

  // Resolve names only after reachability is known. This is bounded and never runs continuously.
  const devices = await Promise.all(rawDevices.map(async x => ({
    ...x,
    name: x.name || await resolveDeviceName(x.ip) || ''
  })));
  const d = db();
  d.devices = devices.map(x => ({ ...x, lastSeen: new Date().toISOString() }));
  save(d);
  broadcast('devices', { devices, localIp: info.ip, netmask: info.netmask });
  return { ok: true, interface: info.name, localIp: info.ip, netmask: info.netmask, devices, summary: `Found ${devices.length} network device${devices.length === 1 ? '' : 's'}` };
}

function decryptKey(d, provider) {
  const env = provider === 'gemini' ? process.env.JARVIS_GEMINI_API_KEY : process.env.JARVIS_OPENAI_API_KEY;
  if (env) return env;
  const encrypted = d.settings.apiKeys?.[provider] || (provider === d.settings.provider ? d.settings.apiKeyEncrypted : '');
  if (!encrypted) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch {}
  return encrypted;
}

function encryptKey(value) {
  if (!value) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) return safeStorage.encryptString(String(value)).toString('base64');
  } catch {}
  return String(value);
}

function requestJson(url, options = {}, body) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(Error('Invalid AI endpoint')); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method: options.method || 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      timeout: 20000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let j;
        try { j = JSON.parse(data); } catch { j = { raw: data }; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(j);
        else reject(Error(j?.error?.message || j?.error || `HTTP ${res.statusCode}`));
      });
    });
    req.on('timeout', () => req.destroy(Error('AI request timed out')));
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function aiReply(text, history = []) {
  const d = db();
  const provider = d.settings.provider || 'ollama';
  const model = d.settings.model || (provider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini');
  const key = decryptKey(d, provider);
  const messages = [
    { role: 'system', content: 'You are JARVIS, a concise Windows personal assistant. Local tools are handled separately. Answer helpfully and briefly.' },
    ...history.slice(-6).map(x => ({ role: x.role === 'assistant' ? 'assistant' : 'user', content: String(x.content || x.text || '') })),
    { role: 'user', content: text }
  ];

  if (provider === 'ollama') {
    const endpoint = (d.settings.endpoint || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const j = await requestJson(`${endpoint}/api/chat`, {}, { model, messages, stream: false });
    return j?.message?.content || 'The local model returned no text.';
  }

  if (!key) throw Error(`No ${provider} API key is configured. Add it in Settings or set the matching Windows environment variable.`);

  if (provider === 'gemini') {
    const contents = messages.filter(x => x.role !== 'system').map(x => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: x.content }] }));
    const system = messages[0].content;
    const j = await requestJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {}, {
      systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.3 }
    });
    return j?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || 'Gemini returned no text.';
  }

  const endpoint = (d.settings.endpoint || 'https://api.openai.com/v1').replace(/\/$/, '');
  const j = await requestJson(`${endpoint}/chat/completions`, { headers: { Authorization: `Bearer ${key}` } }, { model, messages, temperature: 0.3 });
  return j?.choices?.[0]?.message?.content || 'The AI provider returned no text.';
}


async function offlineReply(text) {
  const lower = String(text).toLowerCase();
  if (/^(hi|hello|hey|yo|sup)\b/.test(lower)) return 'Hello. JARVIS is online. I can control supported Windows functions without an internet connection.';
  if (/\b(help|what can you do)\b/.test(lower)) return 'Offline commands: open Chrome, Edge, VS Code, Explorer, Notepad, Calculator or Terminal; lock PC; system status; scan network; open a website; and remember something.';
  if (/\b(time|date|day)\b/.test(lower)) return `It is ${new Date().toLocaleString()}.`;
  if (/\b(status|stats|cpu|ram|memory)\b/.test(lower)) return await action('system');
  return 'I can handle that when an AI provider is configured. For offline use, try “help” to see the built-in commands.';
}

async function assistant(input = {}) {
  const text = String(input.text || '').trim();
  if (!text) return { reply: 'I did not receive a command.', local: true };
  const lower = text.toLowerCase();
  try {
    const launch = lower.match(/^open\s+(chrome|edge|microsoft edge|vs code|visual studio code|notepad|file explorer|explorer|calculator|calc|terminal|windows terminal)\b/);
    if (launch) {
      const map = { 'microsoft edge': 'edge', 'vs code': 'vscode', 'visual studio code': 'vscode', 'file explorer': 'explorer', calc: 'calculator', 'windows terminal': 'terminal' };
      return { reply: await action('launch', { app: map[launch[1]] || launch[1] }), local: true };
    }
    if (/^lock( the)? pc\b|^lock computer\b/.test(lower)) return { reply: await action('lock'), local: true };
    if (/^(show|check|what(?:'s| is)?)\s*(my\s*)?(pc|system|computer)?\s*(status|stats|information|info)?\s*$/i.test(text) || /^system (status|info|information)$/i.test(text)) return { reply: await action('system'), local: true };
    if (/^(scan|find|show|list)\s+(the\s+)?(network|wifi|wi-?fi|devices)/i.test(text)) return { reply: await action('scan-network'), local: true };

    const remember = text.match(/^remember\s+(.+)/i);
    if (remember) {
      const d = db();
      d.memories.push({ id: crypto.randomUUID(), text: remember[1], tags: [], createdAt: new Date().toISOString() });
      save(d);
      log('memory', 'Saved memory');
      return { reply: 'I saved that to memory.', local: true };
    }

    const url = text.match(/^(?:open|go to)\s+(https?:\/\/\S+|[\w.-]+\.[a-z]{2,}(?:\/\S*)?)$/i);
    if (url) return { reply: await action('url', { url: url[1] }), local: true };

    const d = db();
    const provider = d.settings.provider || 'ollama';
    // Useful offline fallback: the chat remains functional even when no AI service is running.
    if (provider === 'ollama' && !d.settings.ollamaEnabled && !process.env.JARVIS_OLLAMA_ENABLED) {
      return { reply: await offlineReply(text), local: true, offline: true };
    }
    try {
      const reply = await aiReply(text, input.history || []);
      return { reply, local: false, provider };
    } catch (e) {
      return { reply: `${await offlineReply(text)}\n\nAI connection: ${e.message}`, local: true, offline: true, error: false };
    }
  } catch (e) {
    log('error', e.message);
    return { reply: `I couldn't complete that: ${e.message}`, local: true, error: true };
  }
}

function schedule(a) {
  if (!a.enabled) return;
  try {
    const job = cron.schedule(a.cron, async () => {
      try {
        await action(a.action.type, a.action.payload || a.action);
        const d = db();
        const item = d.automations.find(x => x.id === a.id);
        if (item) item.lastRun = { time: new Date().toISOString(), status: 'success' };
        save(d);
        log('automation', `${a.name} executed`);
        notify('Automation complete', a.name);
      } catch (e) {
        const d = db();
        const item = d.automations.find(x => x.id === a.id);
        if (item) item.lastRun = { time: new Date().toISOString(), status: `error: ${e.message}` };
        save(d);
        log('error', `${a.name}: ${e.message}`);
        notify('Automation failed', `${a.name}: ${e.message}`, 'error');
      }
    }, { noOverlap: true });
    jobs.set(a.id, job);
  } catch (e) {
    log('error', `Schedule failed: ${e.message}`);
  }
}

function startSchedules() {
  for (const a of db().automations || []) if (a.enabled) schedule(a);
}

async function checkForUpdates() {
  try {
    const r = await autoUpdater.checkForUpdates();
    const v = r?.updateInfo?.version;
    if (v && v !== APP_VERSION) return { ok: true, available: true, currentVersion: APP_VERSION, version: v };
    return { ok: true, available: false, currentVersion: APP_VERSION };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

autoUpdater.on('update-available', i => {
  broadcast('update', { status: 'available', version: i.version });
  notify('New JARVIS update', `Version ${i.version} is available.`, 'update');
});
autoUpdater.on('update-not-available', i => broadcast('update', { status: 'not-available', version: i?.version || APP_VERSION }));
autoUpdater.on('download-progress', p => broadcast('update', { status: 'downloading', percent: p.percent }));
autoUpdater.on('update-downloaded', i => {
  broadcast('update', { status: 'downloaded', version: i.version });
  notify('Update downloaded', `JARVIS ${i.version} is ready to install.`);
});
autoUpdater.on('error', e => broadcast('update', { status: 'error', error: e.message }));

function createApp() {
  const e = express();
  e.use(express.json({ limit: '1mb' }));
  e.use(auth);
  e.use('/assets', express.static(path.join(__dirname, '../public/phone/assets')));
  e.get('/', (_, r) => r.sendFile(path.join(__dirname, '../public/phone/index.html')));
  e.get('/phone', (_, r) => r.sendFile(path.join(__dirname, '../public/phone/index.html')));
  e.get('/web', (_, r) => r.sendFile(path.join(__dirname, '../public/web/index.html')));
  e.use('/web', express.static(path.join(__dirname, '../public/web')));
  e.get('/api/info', (_, r) => r.json({ name: 'JARVIS', version: APP_VERSION, ip: lanIP(), port: PORT, token: token() }));
  e.get('/api/system', async (_, r) => r.json(await system(false)));
  e.get('/api/db', (_, r) => {
    const d = db();
    r.json({ settings: { provider: d.settings.provider || 'ollama', model: d.settings.model || '', pairingToken: token() }, memories: d.memories, automations: d.automations, history: d.history.slice(-100), devices: d.devices, chat: d.chat.slice(-50) });
  });
  e.get('/api/health', (_, r) => r.json({ ok: true, time: new Date().toISOString(), version: APP_VERSION, serverStarted }));
  e.post('/api/action', async (req, r) => {
    try { r.json({ ok: true, result: await action(req.body.type, req.body.payload || {}) }); }
    catch (x) { r.status(400).json({ ok: false, error: x.message }); }
  });
  e.post('/api/assistant', async (req, r) => r.json(await assistant(req.body || {})));
  e.post('/api/network/scan', async (_, r) => {
    try { r.json(await scanNetwork()); }
    catch (x) { r.status(500).json({ ok: false, error: x.message, devices: [] }); }
  });
  e.post('/api/memory', (req, r) => {
    const d = db();
    const text = String(req.body.text || '').trim();
    if (!text) return r.status(400).json({ ok: false, error: 'Memory cannot be empty' });
    const m = { id: crypto.randomUUID(), text, tags: req.body.tags || [], createdAt: new Date().toISOString() };
    d.memories.push(m); save(d); r.json(m);
  });
  e.delete('/api/memory/:id', (req, r) => {
    const d = db(); d.memories = d.memories.filter(x => x.id !== req.params.id); save(d); r.json({ ok: true });
  });
  e.post('/api/automations', (req, r) => {
    const d = db();
    const a = {
      id: crypto.randomUUID(),
      name: String(req.body.name || 'Automation'),
      cron: String(req.body.cron || ''),
      action: req.body.action || { type: 'notify', payload: { title: 'JARVIS', body: 'Automation fired' } },
      enabled: req.body.enabled !== false,
      createdAt: new Date().toISOString()
    };
    if (!cron.validate(a.cron)) return r.status(400).json({ ok: false, error: 'Invalid cron expression' });
    d.automations.push(a); save(d); schedule(a); r.json({ ok: true, ...a });
  });
  e.delete('/api/automations/:id', (req, r) => {
    const d = db(); d.automations = d.automations.filter(x => x.id !== req.params.id); save(d);
    if (jobs.has(req.params.id)) { jobs.get(req.params.id).stop(); jobs.delete(req.params.id); }
    r.json({ ok: true });
  });
  e.post('/api/automations/:id/toggle', (req, r) => {
    const d = db(); const a = d.automations.find(x => x.id === req.params.id);
    if (!a) return r.status(404).json({ ok: false, error: 'Automation not found' });
    a.enabled = !!req.body.enabled; save(d);
    if (jobs.has(a.id)) { jobs.get(a.id).stop(); jobs.delete(a.id); }
    if (a.enabled) schedule(a);
    r.json({ ok: true, ...a });
  });
  e.post('/api/update/check', async (_, r) => r.json(await checkForUpdates()));
  e.post('/api/android/pair', (req, r) => {
    const d = db();
    const device = { id: String(req.body.id || crypto.randomUUID()), name: String(req.body.name || 'Android'), model: String(req.body.model || ''), pairedAt: new Date().toISOString() };
    d.pairedDevices = d.pairedDevices || [];
    d.pairedDevices = d.pairedDevices.filter(x => x.id !== device.id);
    d.pairedDevices.push(device); save(d); r.json({ ok: true, device });
  });
  e.get('/api/android/devices', (_, r) => r.json({ devices: db().pairedDevices || [] }));
  return e;
}

function createWindow() {
  const iconPath = path.join(__dirname, '../assets/jarvis-icon.ico');
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#070a0f',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true
    }
  });
  win.loadFile(path.join(__dirname, '../public/desktop/index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
}

function startServer() {
  const e = createApp();
  httpServer = http.createServer(e);
  wss = new WebSocketServer({ server: httpServer });
  wss.on('connection', ws => ws.send(JSON.stringify({ type: 'hello', data: { ip: lanIP(), token: token() } })));
  httpServer.on('error', e => log('error', `Phone server: ${e.message}`));
  httpServer.listen(PORT, '0.0.0.0', () => {
    serverStarted = true;
    log('system', `Phone remote ready on ${lanIP()}:${PORT}`);
    startSchedules();
  });
}

ipcMain.handle('info', () => ({
  ip: lanIP(),
  addresses: [lanIP()],
  port: PORT,
  token: token(),
  url: `http://${lanIP()}:${PORT}/phone`,
  version: APP_VERSION,
  quickSystem: { cpuModel: os.cpus()[0]?.model || '', cores: os.cpus().length, totalMemory: os.totalmem(), freeMemory: os.freemem(), uptime: os.uptime() }, remoteUrl: `http://${lanIP()}:${PORT}/phone`, pairingToken: token()
}));
ipcMain.handle('system', async () => {
  const s = await system(false);
  return { ...s, cpu: { ...s.cpu, usage: s.cpu.load }, ram: { ...s.ram, usage: s.ram.percent }, host: s.hostname, arch: process.arch, platform: process.platform };
});
ipcMain.handle('db', () => db());
ipcMain.handle('config', () => {
  const d = db();
  return {
    provider: d.settings.provider || 'ollama',
    model: d.settings.model || (d.settings.provider === 'gemini' ? 'gemini-2.5-flash' : d.settings.provider === 'openai' ? 'gpt-4o-mini' : 'llama3.2'),
    endpoint: d.settings.endpoint || (d.settings.provider === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.openai.com/v1'),
    updateFeedUrl: d.settings.updateFeedUrl || DEFAULT_UPDATE_FEED,

    hasOpenAIKey: !!d.settings.apiKeys?.openai || !!process.env.JARVIS_OPENAI_API_KEY,
    hasGeminiKey: !!d.settings.apiKeys?.gemini || !!process.env.JARVIS_GEMINI_API_KEY
  };
});
ipcMain.handle('save-config', (_, cfg) => {
  const d = db();
  d.settings.provider = String(cfg.provider || 'ollama');
  d.settings.model = String(cfg.model || (d.settings.provider === 'gemini' ? 'gemini-2.5-flash' : d.settings.provider === 'openai' ? 'gpt-4o-mini' : 'llama3.2'));
  d.settings.ollamaEnabled = cfg.ollamaEnabled === true;
  d.settings.endpoint = String(cfg.endpoint || (d.settings.provider === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.openai.com/v1'));
  d.settings.updateFeedUrl = String(cfg.updateFeedUrl || '');
  d.settings.apiKeys = d.settings.apiKeys || {};
  if (cfg.apiKey) d.settings.apiKeys[d.settings.provider] = encryptKey(cfg.apiKey);
  if (cfg.openaiApiKey) d.settings.apiKeys.openai = encryptKey(cfg.openaiApiKey);
  if (cfg.geminiApiKey) d.settings.apiKeys.gemini = encryptKey(cfg.geminiApiKey);
  save(d); persistDB(true);
  return { ok: true };
});
ipcMain.handle('assistant', async (_, p) => {
  const r = await assistant(p);
  notify(r.error ? 'JARVIS error' : 'JARVIS', r.reply, r.error ? 'error' : 'success');
  return r;
});
ipcMain.handle('action', async (_, p) => {
  try {
    const r = await action(p.type, p.payload || {});
    notify('JARVIS', r);
    return r;
  } catch (e) {
    notify('JARVIS error', e.message, 'error');
    throw e;
  }
});
ipcMain.handle('scan-network', () => scanNetwork());
ipcMain.handle('check-for-updates', () => checkForUpdates());
ipcMain.handle('download-update', () => autoUpdater.downloadUpdate());
ipcMain.handle('install-update', () => { autoUpdater.quitAndInstall(); return { ok: true }; });
ipcMain.handle('clipboard-write', (_, text) => { clipboard.writeText(String(text || '')); return true; });
ipcMain.handle('memory-add', (_, text) => {
  const d = db(); const value = String(text || '').trim(); if (!value) throw Error('Memory cannot be empty');
  d.memories.push({ id: crypto.randomUUID(), text: value, tags: [], createdAt: new Date().toISOString() }); save(d); return true;
});
ipcMain.handle('memory-delete', (_, id) => { const d = db(); d.memories = d.memories.filter(x => x.id !== id); save(d); return true; });
ipcMain.handle('automation-add', (_, payload) => {
  const d = db();
  const a = { id: crypto.randomUUID(), name: String(payload.name || 'Automation'), cron: String(payload.cron || ''), action: payload.action, enabled: true, createdAt: new Date().toISOString() };
  if (!cron.validate(a.cron)) throw Error('Invalid cron expression');
  d.automations.push(a); save(d); schedule(a); return a;
});
ipcMain.handle('automation-delete', (_, id) => {
  const d = db(); d.automations = d.automations.filter(x => x.id !== id); save(d);
  if (jobs.has(id)) { jobs.get(id).stop(); jobs.delete(id); }
  return true;
});
ipcMain.handle('automation-toggle', (_, { id, enabled }) => {
  const d = db(); const a = d.automations.find(x => x.id === id); if (!a) throw Error('Automation not found');
  a.enabled = !!enabled; save(d); if (jobs.has(id)) { jobs.get(id).stop(); jobs.delete(id); } if (a.enabled) schedule(a); return a;
});
ipcMain.handle('pick-file', async () => { const x = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] }); return x.canceled ? [] : x.filePaths; });
ipcMain.handle('save-file', async (_, name, text) => { const x = await dialog.showSaveDialog(win, { defaultPath: name }); if (x.canceled) return null; await fs.promises.writeFile(x.filePath, text, 'utf8'); return x.filePath; });

app.whenReady().then(() => {
  // Do not run network checks, LAN scans, AI startup, or full hardware probes during launch.
  createWindow();
  startServer();
  // Lightweight background update check: one request after startup, then no polling loop.
  setTimeout(async () => {
    if (!app.isPackaged) return;
    const result = await checkForUpdates();
    if (result.ok && result.available) broadcast('update', { status: 'available', version: result.version });
  }, 8000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => {
  if (quitting) return;
  quitting = true;
  if (saveTimer) { clearTimeout(saveTimer); persistDB(true); }
  for (const j of jobs.values()) j.stop();
  try { wss?.close(); } catch {}
  try { httpServer?.close(); } catch {}
  serverStarted = false;
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
