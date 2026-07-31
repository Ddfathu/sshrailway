#!/usr/bin/env node

const http = require("http");
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

const UPLOAD_URL = process.env.UPLOAD_URL || '';      
const PROJECT_URL = process.env.PROJECT_URL || '';    
const AUTO_ACCESS = process.env.AUTO_ACCESS || false; 
const FILE_PATH = process.env.FILE_PATH || '.tmp';   
const SUB_PATH = process.env.SUB_PATH || 'sub';       
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;        
const UUID = process.env.UUID || '1f37ac4f-fdd0-49df-9406-1eda70a1d512'; 
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';        
const NEZHA_PORT = process.env.NEZHA_PORT || '';            
const NEZHA_KEY = process.env.NEZHA_KEY || '';              

const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';          
const ARGO_AUTH = process.env.ARGO_AUTH || process.env.CF2 || '';               
const ARGO_PORT = process.env.ARGO_PORT || 8001;            

const CFIP = process.env.CFIP || '104.18.17.214';            
const CFPORT = process.env.CFPORT || 443;                   
const NAME = process.env.NAME || 'ddfathu';                        

if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH);
  console.log(`${FILE_PATH} is created`);
}

function generateRandomName() {
  const characters = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

let subContent = null;
const npmName = generateRandomName();
const webName = generateRandomName();
const botName = generateRandomName();
const phpName = generateRandomName();
let npmPath = path.join(FILE_PATH, npmName);
let phpPath = path.join(FILE_PATH, phpName);
let webPath = path.join(FILE_PATH, webName);
let botPath = path.join(FILE_PATH, botName);
let subPath = path.join(FILE_PATH, 'sub.txt');
let listPath = path.join(FILE_PATH, 'list.txt');
let bootLogPath = path.join(FILE_PATH, 'boot.log');
let configPath = path.join(FILE_PATH, 'config.json');

function deleteNodes() {
  try {
    if (!UPLOAD_URL) return;
    if (!fs.existsSync(subPath)) return;
    let fileContent = fs.readFileSync(subPath, 'utf-8');
    const decoded = Buffer.from(fileContent, 'base64').toString('utf-8');
    const nodes = decoded.split('\n').filter(line => /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line));
    if (nodes.length === 0) return;
    axios.post(`${UPLOAD_URL}/api/delete-nodes`, JSON.stringify({ nodes }), { headers: { 'Content-Type': 'application/json' } }).catch(()=>{});
  } catch (err) {}
}

function cleanupOldFiles() {
  try {
    const files = fs.readdirSync(FILE_PATH);
    files.forEach(file => {
      const filePath = path.join(FILE_PATH, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) fs.unlinkSync(filePath);
      } catch (err) {}
    });
  } catch (err) {}
}

function readPathsFromFile(filename, defaultPath) {
  try {
    if (fs.existsSync(filename)) {
      const content = fs.readFileSync(filename, 'utf-8');
      const paths = content.split('\n').map(p => p.trim()).filter(p => p.startsWith('/'));
      if (paths.length > 0) return paths;
    }
  } catch (e) {}
  return [defaultPath];
}

// 🛠️ FIX TOTAL: Buka paksa listen "0.0.0.0" untuk port 8001 dan port internalnya
async function generateConfig() {
  const vlessPaths = readPathsFromFile('pathvless.txt', '/vless-argo');
  const vmessPaths = readPathsFromFile('pathvmess.txt', '/vmess-argo');
  const trojanPaths = readPathsFromFile('pathtrojan.txt', '/trojan-argo');

  const fallbacksList = [{ dest: 3001 }]; 
  const inboundsList = [
    // Pintu Utama 8001 dipaksa buka publik untuk eksternal/domain Railway
    { 
      port: parseInt(ARGO_PORT, 10), 
      listen: "0.0.0.0", 
      protocol: 'vless', 
      settings: { clients: [{ id: UUID, flow: 'xtls-rprx-vision' }], decryption: 'none', fallbacks: fallbacksList }, 
      streamSettings: { network: 'tcp' } 
    },
    { port: 3001, listen: "0.0.0.0", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "tcp", security: "none" } },
    
    // PORT VMESS DIRECT 8082
    {
      port: 8082, listen: "0.0.0.0", protocol: "vmess",
      settings: { clients: [{ id: UUID, alterId: 0 }] },
      streamSettings: { network: "ws", wsSettings: { path: vmessPaths[0] } },
      sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false }
    }
  ];

  let nextPort = 3100;
  vlessPaths.forEach(p => {
    const currentPort = nextPort++;
    fallbacksList.push({ path: p, dest: currentPort });
    inboundsList.push({ port: currentPort, listen: "0.0.0.0", protocol: "vless", settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" }, streamSettings: { network: "ws", security: "none", wsSettings: { path: p } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } });
  });
  vmessPaths.forEach(p => {
    const currentPort = nextPort++;
    fallbacksList.push({ path: p, dest: currentPort });
    inboundsList.push({ port: currentPort, listen: "0.0.0.0", protocol: "vmess", settings: { clients: [{ id: UUID, alterId: 0 }] }, streamSettings: { network: "ws", wsSettings: { path: p } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } });
  });
  trojanPaths.forEach(p => {
    const currentPort = nextPort++;
    fallbacksList.push({ path: p, dest: currentPort });
    inboundsList.push({ port: currentPort, listen: "0.0.0.0", protocol: "trojan", settings: { clients: [{ password: UUID }] }, streamSettings: { network: "ws", security: "none", wsSettings: { path: p } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } });
  });

  const config = { log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' }, inbounds: inboundsList, dns: { servers: ["https+local://8.8.8.8/dns-query"] }, outbounds: [{ protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "block" }] };
  fs.writeFileSync(path.join(FILE_PATH, 'config.json'), JSON.stringify(config, null, 2));
}

function getSystemArchitecture() {
  const arch = os.arch();
  return (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') ? 'arm' : 'amd';
}

function downloadFile(fileName, fileUrl, callback) {
  const filePath = fileName;
  if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });
  const writer = fs.createWriteStream(filePath);
  axios({ method: 'get', url: fileUrl, responseType: 'stream' }).then(response => {
    response.data.pipe(writer);
    writer.on('finish', () => { writer.close(); callback(null, filePath); });
    writer.on('error', err => { fs.unlink(filePath, () => {}); callback(err.message); });
  }).catch(err => { callback(err.message); });
}

async function downloadFilesAndRun() {
  const architecture = getSystemArchitecture();
  const filesToDownload = getFilesForArchitecture(architecture);
  if (filesToDownload.length === 0) return;

  const downloadPromises = filesToDownload.map(fileInfo => {
    return new Promise((resolve, reject) => {
      downloadFile(fileInfo.fileName, fileInfo.fileUrl, (err, filePath) => {
        if (err) reject(err); else resolve(filePath);
      });
    });
  });

  try { await Promise.all(downloadPromises); } catch (err) { return; }

  function authorizeFiles(filePaths) {
    filePaths.forEach(absoluteFilePath => {
      if (fs.existsSync(absoluteFilePath)) fs.chmodSync(absoluteFilePath, 0o775);
    });
  }
  authorizeFiles(NEZHA_PORT ? [npmPath, webPath, botPath] : [phpPath, webPath, botPath]);

  if (NEZHA_SERVER && NEZHA_KEY) {
    if (!NEZHA_PORT) {
      const port = NEZHA_SERVER.includes(':') ? NEZHA_SERVER.split(':').pop() : '';
      const tlsPorts = new Set(['443', '8443', '2096', '2087', '2083', '2053']);
      const nezhatls = tlsPorts.has(port) ? 'true' : 'false';
      const configYaml = `client_secret: ${NEZHA_KEY}\ndebug: false\ndisable_auto_update: true\ndisable_command_execute: false\ndisable_force_update: true\ndisable_nat: false\ndisable_send_query: false\ngpu: false\ninsecure_tls: true\nip_report_period: 1800\nreport_delay: 4\nserver: ${NEZHA_SERVER}\nskip_connection_count: true\nskip_procs_count: true\ntemperature: false\ntls: ${nezhatls}\nuse_gitee_to_upgrade: false\nuse_ipv6_country_code: false\nuuid: ${UUID}`;
      fs.writeFileSync(path.join(FILE_PATH, 'config.yaml'), configYaml);
      await exec(`nohup ${phpPath} -c "${FILE_PATH}/config.yaml" >/dev/null 2>&1 &`);
    } else {
      let NEZHA_TLS = ['443', '8443', '2096', '2087', '2083', '2053'].includes(NEZHA_PORT) ? '--tls' : '';
      await exec(`nohup ${npmPath} -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${NEZHA_TLS} --disable-auto-update --report-delay 4 --skip-conn --skip-procs >/dev/null 2>&1 &`);
    }
  }

  await exec(`nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`);

  if (fs.existsSync(botPath)) {
    let args;
    if (ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;
    } else if (ARGO_AUTH.match(/TunnelSecret/)) {
      args = `tunnel --edge-ip-version auto --config ${FILE_PATH}/tunnel.yml run`;
    } else {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${FILE_PATH}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;
    }
    await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

function getFilesForArchitecture(architecture) {
  let baseFiles = (architecture === 'arm') ? 
    [{ fileName: webPath, fileUrl: "https://arm64.ssss.nyc.mn/web" }, { fileName: botPath, fileUrl: "https://arm64.ssss.nyc.mn/bot" }] :
    [{ fileName: webPath, fileUrl: "https://amd64.ssss.nyc.mn/web" }, { fileName: botPath, fileUrl: "https://amd64.ssss.nyc.mn/bot" }];
  if (NEZHA_SERVER && NEZHA_KEY) {
    baseFiles.unshift({ fileName: NEZHA_PORT ? npmPath : phpPath, fileUrl: architecture === 'arm' ? (NEZHA_PORT ? "https://arm64.ssss.nyc.mn/agent" : "https://arm64.ssss.nyc.mn/v1") : (NEZHA_PORT ? "https://amd64.ssss.nyc.mn/agent" : "https://amd64.ssss.nyc.mn/v1") });
  }
  return baseFiles;
}

function argoType() {
  if (!ARGO_AUTH || !ARGO_DOMAIN) return;
  if (ARGO_AUTH.includes('TunnelSecret')) {
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.json'), ARGO_AUTH);
    const tunnelYaml = `tunnel: ${ARGO_AUTH.split('"')[11]}\ncredentials-file: ${path.join(FILE_PATH, 'tunnel.json')}\nprotocol: http2\ningress:\n  - hostname: ${ARGO_DOMAIN}\n    service: http://localhost:${ARGO_PORT}\n    originRequest:\n      noTLSVerify: true\n  - service: http_status:404`;
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.yml'), tunnelYaml);
  }
}

async function extractDomains() {
  let argoDomain;
  if (ARGO_AUTH && ARGO_DOMAIN) {
    argoDomain = ARGO_DOMAIN;
    await generateLinks(argoDomain);
  } else {
    try {
      if (!fs.existsSync(path.join(FILE_PATH, 'boot.log'))) return;
      const fileContent = fs.readFileSync(path.join(FILE_PATH, 'boot.log'), 'utf-8');
      const domainMatch = fileContent.match(/https?:\/\/([^ ]*trycloudflare\.com)\/?/);
      if (domainMatch) {
        argoDomain = domainMatch[1];
        await generateLinks(argoDomain);
      }
    } catch (error) {}
  }
}

async function getMetaInfo() {
  try {
    const res = await axios.get('https://api.ip.sb/geoip', { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 3000 });
    return `${res.data.country_code}-${res.data.isp}`.replace(/\s+/g, '_');
  } catch (error) { return 'Unknown'; }
}

async function generateLinks(argoDomain) {
  currentActiveDomain = argoDomain; 
  const ISP = await getMetaInfo();
  const nodeName = NAME ? `${NAME}-${ISP}` : ISP;
  const defaultVless = readPathsFromFile('pathvless.txt', '/vless-argo')[0];
  const defaultVmess = readPathsFromFile('pathvmess.txt', '/vmess-argo')[0];
  const defaultTrojan = readPathsFromFile('pathtrojan.txt', '/trojan-argo')[0];

  const VMESS = { v: '2', ps: `${nodeName}`, add: CFIP, port: CFPORT, id: UUID, aid: '0', scy: 'auto', net: 'ws', type: 'none', host: argoDomain, path: `${defaultVmess}?ed=2560`, tls: 'tls', sni: argoDomain, alpn: '', fp: 'firefox' };
  const VMESS_DIRECT = { v: '2', ps: `${nodeName}-Direct8082`, add: 'IP_LU', port: 8082, id: UUID, aid: '0', scy: 'auto', net: 'ws', type: 'none', host: '', path: `${defaultVmess}`, tls: '', sni: '', alpn: '', fp: '' };

  const subTxt = `vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=${encodeURIComponent(defaultVless + '?ed=2560')}#${nodeName}\n\nvmess://${Buffer.from(JSON.stringify(VMESS)).toString('base64')}\n\nvmess://${Buffer.from(JSON.stringify(VMESS_DIRECT)).toString('base64')}\n\ntrojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=${encodeURIComponent(defaultTrojan + '?ed=2560')}#${nodeName}`;
  fs.writeFileSync(subPath, Buffer.from(subTxt).toString('base64'));
  subContent = Buffer.from(subTxt).toString('base64');
  uploadNodes();
}

async function uploadNodes() {
  if (!UPLOAD_URL) return;
  const subscriptionUrl = `${PROJECT_URL}/${SUB_PATH}`;
  axios.post(`${UPLOAD_URL}/api/add-subscriptions`, { subscription: [subscriptionUrl] }, { headers: { 'Content-Type': 'application/json' } }).catch(()=>{});
}

function cleanFiles() {
  setTimeout(() => {
    const filesToDelete = [bootLogPath, configPath, webPath, botPath];
    if (NEZHA_PORT) filesToDelete.push(npmPath);
    else if (NEZHA_SERVER && NEZHA_KEY) filesToDelete.push(phpPath);
    
    if (process.platform === 'win32') {
      exec(`del /f /q ${filesToDelete.join(' ')} > nul 2>&1`, () => {});
    } else {
      exec(`rm -rf ${filesToDelete.join(' ')} >/dev/null 2>&1`, () => {});
    }
  }, 90000);
}
cleanFiles();

async function startserver() {
  try { argoType(); deleteNodes(); cleanupOldFiles(); await generateConfig(); await downloadFilesAndRun(); await extractDomains(); } catch (error) {}
}
startserver();

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  if (urlPath === `/${SUB_PATH}`) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(subContent || '');
    return;
  }
  if (urlPath === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end("App is running");
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(PORT);
