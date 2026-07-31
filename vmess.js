#!/usr/bin/env node

const http = require("http");
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

// Alamat unggah otomatis untuk node atau langganan (isi dengan beranda proyek Merge-sub setelah diterapkan, contoh: https://merge.xxx.com)
const UPLOAD_URL = process.env.UPLOAD_URL || '';      
// Isi URL proyek jika perlu mengunggah langganan atau menjaga agar proyek tetap aktif, contoh: https://google.com
const PROJECT_URL = process.env.PROJECT_URL || '';    
// false mematikan fitur jaga aktif otomatis, true mengaktifkan (wajib mengisi variabel PROJECT_URL bersamaan)
const AUTO_ACCESS = process.env.AUTO_ACCESS || false; 
// Direktori operasi, tempat berkas sub node disimpan
const FILE_PATH = process.env.FILE_PATH || '.tmp';   
// Jalur langganan
const SUB_PATH = process.env.SUB_PATH || 'sub';       
// Port layanan HTTP untuk langganan
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;        
// Menggunakan Nezha v1, jika dijalankan di berbagai platform berbeda perlu mengubah UUID agar tidak tertimpa
const UUID = process.env.UUID || '1f37ac4f-fdd0-49df-9406-1eda70a1d512'; 
// Format pengisian Nezha v1: nz.abc.com:8008 | Format pengisian Nezha v0: nz.abc.com
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';        
// Jika menggunakan Nezha v1 biarkan kosong, Nezha v0 wajib diisi
const NEZHA_PORT = process.env.NEZHA_PORT || '';            
// NZ_CLIENT_SECRET untuk Nezha v1 atau kunci agen untuk Nezha v0
const NEZHA_KEY = process.env.NEZHA_KEY || '';              

// ========================================================
// VARIABEL ARGO TUNNEL DIBIKIN DINAMIS (ANTI HARDCODE)
// ========================================================
// Domain terowongan tetap, jika kosong otomatis mengaktifkan terowongan sementara (Quick Tunnel)
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';          
// JSON atau token terowongan tetap milik lu sendiri, diisi via Env Dashboard
const ARGO_AUTH = process.env.ARGO_AUTH || '';              
// Port terowongan tetap bawaan asli (8001)
const ARGO_PORT = process.env.ARGO_PORT || 8001;            

// Domain atau IP tujuan pilihan untuk node
const CFIP = process.env.CFIP || '104.18.17.214';            
// Port yang sesuai untuk domain atau IP tujuan pilihan node
const CFPORT = process.env.CFPORT || 443;                   
// Nama Node
const NAME = process.env.NAME || 'ddfathu';                        

// Membuat folder operasi jika belum ada
if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH);
  console.log(`${FILE_PATH} is created`);
} else {
  console.log(`${FILE_PATH} already exists`);
}

// Menghasilkan nama acak 6 karakter untuk penyamaran proses
function generateRandomName() {
  const characters = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// Konstanta Global
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

// Menghapus node lama pada server langganan remote jika ada riwayat operasi sebelumnya
function deleteNodes() {
  try {
    if (!UPLOAD_URL) return;
    if (!fs.existsSync(subPath)) return;

    let fileContent;
    try {
      fileContent = fs.readFileSync(subPath, 'utf-8');
    } catch {
      return null;
    }

    const decoded = Buffer.from(fileContent, 'base64').toString('utf-8');
    const nodes = decoded.split('\n').filter(line =>
      /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line)
    );

    if (nodes.length === 0) return;

    axios.post(`${UPLOAD_URL}/api/delete-nodes`,
      JSON.stringify({ nodes }),
      { headers: { 'Content-Type': 'application/json' } }
    ).catch((error) => {
      return null;
    });
    return null;
  } catch (err) {
    return null;
  }
}

// Membersihkan berkas riwayat lama di direktori kerja
function cleanupOldFiles() {
  try {
    const files = fs.readdirSync(FILE_PATH);
    files.forEach(file => {
      const filePath = path.join(FILE_PATH, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        // Mengabaikan semua galat tanpa mencatat log
      }
    });
  } catch (err) {
    // Mengabaikan semua galat tanpa mencatat log
  }
}

// Fungsi pembantu untuk membaca path dari file eksternal secara aman
function readPathsFromFile(filename, defaultPath) {
  try {
    if (fs.existsSync(filename)) {
      const content = fs.readFileSync(filename, 'utf-8');
      const paths = content.split('\n')
                           .map(p => p.trim())
                           .filter(p => p.startsWith('/')); // Validasi wajib diawali tanda '/'
      if (paths.length > 0) return paths;
    }
  } catch (e) {
    // Jika gagal baca file, otomatis lempar ke default bawaan script
  }
  return [defaultPath];
}

// Membuat berkas konfigurasi xray (MULTI-PATH PINTAR DARI FILE EKSTERNAL)
async function generateConfig() {
  // Ambil daftar path dinamis dari file teks masing-masing
  const vlessPaths = readPathsFromFile('pathvless.txt', '/vless-argo');
  const vmessPaths = readPathsFromFile('pathvmess.txt', '/vmess-argo');
  const trojanPaths = readPathsFromFile('pathtrojan.txt', '/trojan-argo');

  const fallbacksList = [{ dest: 3001 }]; // Fallback default utama TCP
  const inboundsList = [
    // Pintu masuk gerbang utama dari Argo Tunnel
    { 
      port: ARGO_PORT, 
      protocol: 'vless', 
      settings: { 
        clients: [{ id: UUID, flow: 'xtls-rprx-vision' }], 
        decryption: 'none', 
        fallbacks: fallbacksList 
      }, 
      streamSettings: { network: 'tcp' } 
    },
    // Port 3001 bawaan asli untuk TCP fallback murni
    { port: 3001, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "tcp", security: "none" } },
    
    // 🌟 SEKTOR PENAMBAHAN VMESS DIRECT PORT 8082 VIA LOKAL/WEB-SOCKET 🌟
    {
      port: 8082,
      listen: "0.0.0.0", // Buka akses publik agar bisa ditembak direct tanpa lewat Argo jika perlu
      protocol: "vmess",
      settings: {
        clients: [{ id: UUID, alterId: 0 }]
      },
      streamSettings: {
        network: "ws",
        wsSettings: {
          path: vmessPaths[0] // Otomatis memakai path pertama dari berkas pathvmess.txt lu bos
        }
      },
      sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false }
    }
  ];

  // Penghitung alokasi port internal dinamis (dimulai dari port 3100 biar aman)
  let nextPort = 3100;

  // Daftarkan semua daftar path VLESS secara otomatis
  vlessPaths.forEach(p => {
    const currentPort = nextPort++;
    fallbacksList.push({ path: p, dest: currentPort });
    inboundsList.push({
      port: currentPort, listen: "127.0.0.1", protocol: "vless",
      settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" },
      streamSettings: { network: "ws", security: "none", wsSettings: { path: p } },
      sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false }
    });
  });

  // Daftarkan semua daftar path VMESS secara otomatis
  vmessPaths.forEach(p => {
    const currentPort = nextPort++;
    fallbacksList.push({ path: p, dest: currentPort });
    inboundsList.push({
      port: currentPort, listen: "127.0.0.1", protocol: "vmess",
      settings: { clients: [{ id: UUID, alterId: 0 }] },
      streamSettings: { network: "ws", wsSettings: { path: p } },
      sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false }
    });
  });

  // Daftarkan semua daftar path TROJAN secara otomatis
  trojanPaths.forEach(p => {
    const currentPort = nextPort++;
    fallbacksList.push({ path: p, dest: currentPort });
    inboundsList.push({
      port: currentPort, listen: "127.0.0.1", protocol: "trojan",
      settings: { clients: [{ password: UUID }] },
      streamSettings: { network: "ws", security: "none", wsSettings: { path: p } },
      sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false }
    });
  });

  const config = {
    log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
    inbounds: inboundsList,
    dns: { servers: ["https+local://8.8.8.8/dns-query"] },
    outbounds: [{ protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "block" }]
  };

  fs.writeFileSync(path.join(FILE_PATH, 'config.json'), JSON.stringify(config, null, 2));
}

// Mendeteksi arsitektur sistem operasi (ARM vs AMD)
function getSystemArchitecture() {
  const arch = os.arch();
  if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') {
    return 'arm';
  } else {
    return 'amd';
  }
}

// Mengunduh berkas dependensi sesuai arsitektur sistem
function downloadFile(fileName, fileUrl, callback) {
  const filePath = fileName;

  if (!fs.existsSync(FILE_PATH)) {
    fs.mkdirSync(FILE_PATH, { recursive: true });
  }

  const writer = fs.createWriteStream(filePath);

  axios({
    method: 'get',
    url: fileUrl,
    responseType: 'stream',
  })
    .then(response => {
      response.data.pipe(writer);

      writer.on('finish', () => {
        writer.close();
        console.log(`Download ${path.basename(filePath)} successfully`);
        callback(null, filePath);
      });

      writer.on('error', err => {
        fs.unlink(filePath, () => { });
        const errorMessage = `Download ${path.basename(filePath)} failed: ${err.message}`;
        console.error(errorMessage);
        callback(errorMessage);
      });
    })
    .catch(err => {
      const errorMessage = `Download ${path.basename(filePath)} failed: ${err.message}`;
      console.error(errorMessage);
      callback(errorMessage);
    });
}

// Mengunduh berkas dependensi dan menjalankannya
async function downloadFilesAndRun() {
  const architecture = getSystemArchitecture();
  const filesToDownload = getFilesForArchitecture(architecture);

  if (filesToDownload.length === 0) {
    console.log(`Can't find a file for the current architecture`);
    return;
  }

  const downloadPromises = filesToDownload.map(fileInfo => {
    return new Promise((resolve, reject) => {
      downloadFile(fileInfo.fileName, fileInfo.fileUrl, (err, filePath) => {
        if (err) {
          reject(err);
        } else {
          resolve(filePath);
        }
      });
    });
  });

  try {
    await Promise.all(downloadPromises);
  } catch (err) {
    console.error('Error downloading files:', err);
    return;
  }

  // Memberikan izin eksekusi berkas binary (chmod 775)
  function authorizeFiles(filePaths) {
    const newPermissions = 0o775;
    filePaths.forEach(absoluteFilePath => {
      if (fs.existsSync(absoluteFilePath)) {
        fs.chmod(absoluteFilePath, newPermissions, (err) => {
          if (err) {
            console.error(`Empowerment failed for ${absoluteFilePath}: ${err}`);
          } else {
            console.log(`Empowerment success for ${absoluteFilePath}: ${newPermissions.toString(8)}`);
          }
        });
      }
    });
  }
  const filesToAuthorize = NEZHA_PORT ? [npmPath, webPath, botPath] : [phpPath, webPath, botPath];
  authorizeFiles(filesToAuthorize);

  // Menjalankan Nezha Agen Monitor
  if (NEZHA_SERVER && NEZHA_KEY) {
    if (!NEZHA_PORT) {
      const port = NEZHA_SERVER.includes(':') ? NEZHA_SERVER.split(':').pop() : '';
      const tlsPorts = new Set(['443', '8443', '2096', '2087', '2083', '2053']);
      const nezhatls = tlsPorts.has(port) ? 'true' : 'false';
      const configYaml = `
client_secret: ${NEZHA_KEY}
debug: false
disable_auto_update: true
disable_command_execute: false
disable_force_update: true
disable_nat: false
disable_send_query: false
gpu: false
insecure_tls: true
ip_report_period: 1800
report_delay: 4
server: ${NEZHA_SERVER}
skip_connection_count: true
skip_procs_count: true
temperature: false
tls: ${nezhatls}
use_gitee_to_upgrade: false
use_ipv6_country_code: false
uuid: ${UUID}`;

      fs.writeFileSync(path.join(FILE_PATH, 'config.yaml'), configYaml);

      const command = `nohup ${phpPath} -c "${FILE_PATH}/config.yaml" >/dev/null 2>&1 &`;
      try {
        await exec(command);
        console.log(`${phpName} is running`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`php running error: ${error}`);
      }
    } else {
      let NEZHA_TLS = '';
      const tlsPorts = ['443', '8443', '2096', '2087', '2083', '2053'];
      if (tlsPorts.includes(NEZHA_PORT)) {
        NEZHA_TLS = '--tls';
      }
      const command = `nohup ${npmPath} -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${NEZHA_TLS} --disable-auto-update --report-delay 4 --skip-conn --skip-procs >/dev/null 2>&1 &`;
      try {
        await exec(command);
        console.log(`${npmName} is running`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`npm running error: ${error}`);
      }
    }
  } else {
    console.log('NEZHA variable is empty,skip running');
  }

  // Menjalankan core xray backend
  const command1 = `nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`;
  try {
    await exec(command1);
    console.log(`${webName} is running`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (error) {
    console.error(`web running error: ${error}`);
  }

  // Menjalankan daemon cloudflared argo tunnel
  if (fs.existsSync(botPath)) {
    let args;

    if (ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;
    } else if (ARGO_AUTH.match(/TunnelSecret/)) {
      args = `tunnel --edge-ip-version auto --config ${FILE_PATH}/tunnel.yml run`;
    } else {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${FILE_PATH}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;
    }

    try {
      await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
      console.log(`${botName} is running`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`Error executing command: ${error}`);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

// Mengembalikan URL berkas berdasarkan arsitektur sistem
function getFilesForArchitecture(architecture) {
  let baseFiles;
  if (architecture === 'arm') {
    baseFiles = [
      { fileName: webPath, fileUrl: "https://arm64.ssss.nyc.mn/web" },
      { fileName: botPath, fileUrl: "https://arm64.ssss.nyc.mn/bot" }
    ];
  } else {
    baseFiles = [
      { fileName: webPath, fileUrl: "https://amd64.ssss.nyc.mn/web" },
      { fileName: botPath, fileUrl: "https://amd64.ssss.nyc.mn/bot" }
    ];
  }

  if (NEZHA_SERVER && NEZHA_KEY) {
    if (NEZHA_PORT) {
      const npmUrl = architecture === 'arm'
        ? "https://arm64.ssss.nyc.mn/agent"
        : "https://amd64.ssss.nyc.mn/agent";
      baseFiles.unshift({
        fileName: npmPath,
        fileUrl: npmUrl
      });
    } else {
      const phpUrl = architecture === 'arm'
        ? "https://arm64.ssss.nyc.mn/v1"
        : "https://amd64.ssss.nyc.mn/v1";
      baseFiles.unshift({
        fileName: phpPath,
        fileUrl: phpUrl
      });
    }
  }

  return baseFiles;
}

// Memproses konfigurasi berkas JSON terowongan tetap
function argoType() {
  if (!ARGO_AUTH || !ARGO_DOMAIN) {
    console.log("ARGO_DOMAIN or ARGO_AUTH is empty, use quick tunnels");
    return;
  }

  if (ARGO_AUTH.includes('TunnelSecret')) {
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.json'), ARGO_AUTH);
    const tunnelYaml = `
  tunnel: ${ARGO_AUTH.split('"')[11]}
  credentials-file: ${path.join(FILE_PATH, 'tunnel.json')}
  protocol: http2
  
  ingress:
    - hostname: ${ARGO_DOMAIN}
      service: http://localhost:${ARGO_PORT}
      originRequest:
        noTLSVerify: true
    - service: http_status:404
  `;
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.yml'), tunnelYaml);
  } else {
    console.log(`Using token connect to tunnel, please set ${ARGO_PORT} in cloudflare`);
  }
}

// Mengekstrak alamat domain dari terowongan sementara
async function extractDomains() {
  let argoDomain;

  if (ARGO_AUTH && ARGO_DOMAIN) {
    argoDomain = ARGO_DOMAIN;
    console.log('ARGO_DOMAIN:', argoDomain);
    await generateLinks(argoDomain);
  } else {
    try {
      const fileContent = fs.readFileSync(path.join(FILE_PATH, 'boot.log'), 'utf-8');
      const lines = fileContent.split('\n');
      const argoDomains = [];
      lines.forEach((line) => {
        const domainMatch = line.match(/https?:\/\/([^ ]*trycloudflare\.com)\/?/);
        if (domainMatch) {
          const domain = domainMatch[1];
          argoDomains.push(domain);
        }
      });

      if (argoDomains.length > 0) {
        argoDomain = argoDomains[0];
        console.log('ArgoDomain:', argoDomain);
        await generateLinks(argoDomain);
      } else {
        console.log('ArgoDomain not found, re-running bot to obtain ArgoDomain');
        fs.unlinkSync(path.join(FILE_PATH, 'boot.log'));
        async function killBotProcess() {
          try {
            if (process.platform === 'win32') {
              await exec(`taskkill /f /im ${botName}.exe > nul 2>&1`);
            } else {
              await exec(`pkill -f "[${botName.charAt(0)}]${botName.substring(1)}" > /dev/null 2>&1`);
            }
          } catch (error) {
            // Mengabaikan keluaran
          }
        }
        killBotProcess();
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${FILE_PATH}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;
        try {
          await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
          console.log(`${botName} is running`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          await extractDomains();
        } catch (error) {
          console.error(`Error executing command: ${error}`);
        }
      }
    } catch (error) {
      console.error('Error reading boot.log:', error);
    }
  }
}

// Tempat menyimpan data domain terowongan secara global agar bisa ditarik API UI
let currentActiveDomain = '';

// Mendapatkan informasi metadata penyedia internet (ISP) lokal server
async function getMetaInfo() {
  try {
    const response1 = await axios.get('https://api.ip.sb/geoip', { headers: { 'User-Agent': 'Mozilla/5.0', timeout: 3000 } });
    if (response1.data && response1.data.country_code && response1.data.isp) {
      return `${response1.data.country_code}-${response1.data.isp}`.replace(/\s+/g, '_');
    }
  } catch (error) {
    try {
      const response2 = await axios.get('http://ip-api.com/json', { headers: { 'User-Agent': 'Mozilla/5.0', timeout: 3000 } });
      if (response2.data && response2.data.status === 'success' && response2.data.countryCode && response2.data.org) {
        return `${response2.data.countryCode}-${response2.data.org}`.replace(/\s+/g, '_');
      }
    } catch (error) {
      // Mengabaikan kegagalan API cadangan
    }
  }
  return 'Unknown';
}

// Membuat tautan mentah untuk daftar list node dan langganan (sub)
async function generateLinks(argoDomain) {
  currentActiveDomain = argoDomain; // Amankan alamat domain aktif ke memori global
  const ISP = await getMetaInfo();
  const nodeName = NAME ? `${NAME}-${ISP}` : ISP;
  return new Promise((resolve) => {
    setTimeout(() => {
      // Link bawaan utama tetap digenerate berdasarkan path default index ke-0
      const defaultVless = readPathsFromFile('pathvless.txt', '/vless-argo')[0];
      const defaultVmess = readPathsFromFile('pathvmess.txt', '/vmess-argo')[0];
      const defaultTrojan = readPathsFromFile('pathtrojan.txt', '/trojan-argo')[0];

      const VMESS = { v: '2', ps: `${nodeName}`, add: CFIP, port: CFPORT, id: UUID, aid: '0', scy: 'auto', net: 'ws', type: 'none', host: argoDomain, path: `${defaultVmess}?ed=2560`, tls: 'tls', sni: argoDomain, alpn: '', fp: 'firefox' };
      
      // 🌟 PEMBUATAN STRUK VMESS DIRECT UNTUK LOG/SUB LENGKAP 🌟
      const VMESS_DIRECT = { v: '2', ps: `${nodeName}-Direct8082`, add: 'LU_ISI_IP_SERVER_DISINI', port: 8082, id: UUID, aid: '0', scy: 'auto', net: 'ws', type: 'none', host: '', path: `${defaultVmess}`, tls: '', sni: '', alpn: '', fp: '' };

      const subTxt = `
vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=${encodeURIComponent(defaultVless + '?ed=2560')}#${nodeName}

vmess://${Buffer.from(JSON.stringify(VMESS)).toString('base64')}

vmess://${Buffer.from(JSON.stringify(VMESS_DIRECT)).toString('base64')}

trojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=${encodeURIComponent(defaultTrojan + '?ed=2560')}#${nodeName}
    `;
      console.log(Buffer.from(subTxt).toString('base64'));
      fs.writeFileSync(subPath, Buffer.from(subTxt).toString('base64'));
      console.log(`${FILE_PATH}/sub.txt saved successfully`);
      // Menyimpan konten langganan ke variabel global untuk digunakan oleh server HTTP
      subContent = Buffer.from(subTxt).toString('base64');
      uploadNodes();
      resolve(subTxt);
    }, 2000);
  });
}

// Unggah node atau langganan secara otomatis ke server remote
async function uploadNodes() {
  if (UPLOAD_URL && PROJECT_URL) {
    const subscriptionUrl = `${PROJECT_URL}/${SUB_PATH}`;
    const jsonData = {
      subscription: [subscriptionUrl]
    };
    try {
      const response = await axios.post(`${UPLOAD_URL}/api/add-subscriptions`, jsonData, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response && response.status === 200) {
        console.log('Subscription uploaded successfully');
        return response;
      } else {
        return null;
      }
    } catch (error) {
      if (error.response) {
        if (error.response.status === 400) {
          // Mengabaikan jika langganan sudah ada
        }
      }
    }
  } else if (UPLOAD_URL) {
    if (!fs.existsSync(listPath)) return;
    const content = fs.readFileSync(listPath, 'utf-8');
    const nodes = content.split('\n').filter(line => /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line));

    if (nodes.length === 0) return;

    const jsonData = JSON.stringify({ nodes });

    try {
      const response = await axios.post(`${UPLOAD_URL}/api/add-nodes`, jsonData, {
        headers: { 'Content-Type': 'application/json' }
      });
      if (response && response.status === 200) {
        console.log('Nodes uploaded successfully');
        return response;
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
  } else {
    // Mengabaikan proses unggah node
    return;
  }
}

// Fitur anti-forensik: Menghapus berkas terkait dari penyimpanan disk setelah 90 detik operasional
function cleanFiles() {
  setTimeout(() => {
    const filesToDelete = [bootLogPath, configPath, webPath, botPath];

    if (NEZHA_PORT) {
      filesToDelete.push(npmPath);
    } else if (NEZHA_SERVER && NEZHA_KEY) {
      filesToDelete.push(phpPath);
    }

    if (process.platform === 'win32') {
      exec(`del /f /q ${filesToDelete.join(' ')} > nul 2>&1`, (error) => {
        console.clear();
        console.log('App is running');
        console.log('Thank you for using this script, enjoy!');
      });
    } else {
      exec(`rm -rf ${filesToDelete.join(' ')} >/dev/null 2>&1`, (error) => {
        console.clear();
        console.log('App is running');
        console.log('Thank you for using this script, enjoy!');
      });
    }
  }, 90000);
}
cleanFiles();

// Mengirimkan tugas kunjungan otomatis ke tautan proyek (Keep Alive Serv00)
async function AddVisitTask() {
  if (!AUTO_ACCESS || !PROJECT_URL) {
    console.log("Skipping adding automatic access task");
    return;
  }

  try {
    const response = await axios.post('https://oooo.serv00.net/add-url', {
      url: PROJECT_URL
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log(`automatic access task added successfully`);
    return response;
  } catch (error) {
    console.error(`Add automatic access task faild: ${error.message}`);
    return null;
  }
}

// Logika alur eksekusi utama saat boot server
async function startserver() {
  try {
    argoType();
    deleteNodes();
    cleanupOldFiles();
    await generateConfig();
    await downloadFilesAndRun();
    await extractDomains();
    await AddVisitTask();
  } catch (error) {
    console.error('Error in startserver:', error);
  }
}
startserver().catch(error => {
  console.error('Unhandled error in startserver:', error);
});

// Membuat antarmuka Server HTTP lokal untuk web
const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];

  // Jalur Rute Langganan Akun VPN
  if (urlPath === `/${SUB_PATH}`) {
    if (subContent) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(subContent);
    } else {
      // Jika konten langganan belum dibuat di RAM, coba baca dari berkas disk cadangan
      try {
        const fileContent = fs.readFileSync(subPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(fileContent);
      } catch (err) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Subscription content not yet available, please try again later.');
      }
    }
    return;
  }

  // 🌟 JALUR KHUSUS: API internal rahasia untuk melempar data UUID & Path ke Javascript Browser
  if (urlPath === '/__info') {
    const defaultVless = readPathsFromFile('pathvless.txt', '/vless-argo')[0];
    const defaultVmess = readPathsFromFile('pathvmess.txt', '/vmess-argo')[0];
    const defaultTrojan = readPathsFromFile('pathtrojan.txt', '/trojan-argo')[0];

    const infoData = {
      uuid: UUID,
      domain: currentActiveDomain || req.headers.host || ARGO_DOMAIN || '',
      paths: {
        vless: defaultVless,
        vmess: defaultVmess,
        trojan: defaultTrojan
      }
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(infoData));
    return;
  }

  // Rute Utama: / (Membaca file index.html asli bawaan lu 100%)
  if (urlPath === '/') {
    try {
      const filePath = path.join(__dirname, 'index.html');
      const data = await fs.promises.readFile(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end("Hello world!<br><br>You can access /{SUB_PATH}(Default: /sub) to get your nodes!");
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(PORT, () => console.log(`http server is running on port:${PORT}!`));
