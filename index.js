const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, makeInMemoryStore, DisconnectReason, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const qrcode = require('qrcode');

// Replit: ffmpeg sudah tersedia dari sistem (via replit.nix), tidak perlu ffmpeg-static

// ─────────────────────────────────────────────
// KONFIGURASI AUTO REPLY
// ─────────────────────────────────────────────
const PREFIX = '.'; // Ganti prefix di sini jika mau, contoh: '!' atau '/'

const AUTO_REPLY = {
  '.halo': '👋 Halo! Ketik *.menu* untuk lihat semua fitur.',
  '.hi':   '👋 Hi! Ketik *.menu* untuk lihat semua fitur.',
  '.menu': `🤖 *MENU BOT*\n\n📸 *Stiker* — Kirim foto/GIF dengan caption: \`.stiker\`\n👁️ *View Once* — Kirim foto dengan caption: \`.vo\`\n⬇️ *Download* — Kirim link YouTube/TikTok/IG\n❓ *Help* — Ketik \`.help\``,
  '.help': `💡 *CARA PAKAI*\n\n*Buat Stiker:*\nKirim foto/GIF + caption \`.stiker\`\n\n*View Once:*\nKirim foto + caption \`.vo\`\n\n*Download Video:*\nKirim link YT/TikTok/IG langsung\n\n*Download Audio:*\nKirim link + caption \`.audio\``,
};

const DEFAULT_REPLY = '😊 Ketik *.menu* untuk lihat semua fitur bot.';

// ─────────────────────────────────────────────
// HELPER: TEMP FILE
// ─────────────────────────────────────────────
const TMP = '/tmp/wa-bot';
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

function tmpFile(name) {
  return path.join(TMP, name);
}

function cleanup(...files) {
  for (const f of files) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

// ─────────────────────────────────────────────
// HELPER: DOWNLOAD MEDIA DARI BAILEYS
// ─────────────────────────────────────────────
async function downloadMedia(message, type) {
  const stream = await downloadContentFromMessage(message, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// ─────────────────────────────────────────────
// FITUR: BUAT STIKER
// ─────────────────────────────────────────────
async function makeSticker(sock, jid, msg, quoted) {
  await sock.sendMessage(jid, { text: '⏳ Membuat stiker...' }, { quoted });

  const isGif = quoted.message?.videoMessage?.gifPlayback;
  const isVideo = !!quoted.message?.videoMessage && !isGif;
  const isImage = !!quoted.message?.imageMessage;
  const isGifMsg = !!quoted.message?.videoMessage?.gifPlayback;

  try {
    let stickerBuffer;

    if (isImage) {
      // Gambar → WebP statis
      const imgBuffer = await downloadMedia(quoted.message.imageMessage, 'image');
      stickerBuffer = await sharp(imgBuffer)
        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp()
        .toBuffer();
    } else if (isGifMsg || isVideo) {
      // GIF/Video → WebP animasi via ffmpeg
      const videoBuffer = await downloadMedia(quoted.message.videoMessage, 'video');
      const inputPath = tmpFile(`input_${Date.now()}.mp4`);
      const outputPath = tmpFile(`sticker_${Date.now()}.webp`);
      fs.writeFileSync(inputPath, videoBuffer);

      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions([
            '-vcodec libwebp',
            '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0.0',
            '-loop', '0',
            '-preset', 'default',
            '-an',
            '-vsync', '0',
            '-t', '00:00:05', // max 5 detik
          ])
          .toFormat('webp')
          .on('end', resolve)
          .on('error', reject)
          .save(outputPath);
      });

      stickerBuffer = fs.readFileSync(outputPath);
      cleanup(inputPath, outputPath);
    } else {
      return sock.sendMessage(jid, { text: '❌ Kirim foto atau GIF untuk dibuat stiker.' }, { quoted });
    }

    await sock.sendMessage(jid, {
      sticker: stickerBuffer,
    }, { quoted });

  } catch (err) {
    console.error('Stiker error:', err);
    await sock.sendMessage(jid, { text: '❌ Gagal buat stiker. Coba lagi.' }, { quoted });
  }
}

// ─────────────────────────────────────────────
// FITUR: VIEW ONCE
// ─────────────────────────────────────────────
async function sendViewOnce(sock, jid, msg, quoted) {
  await sock.sendMessage(jid, { text: '⏳ Memproses view once...' }, { quoted });

  try {
    const imgBuffer = await downloadMedia(quoted.message.imageMessage, 'image');

    await sock.sendMessage(jid, {
      image: imgBuffer,
      viewOnce: true,
      caption: '👁️ Foto ini hanya bisa dilihat sekali!',
    }, { quoted });

  } catch (err) {
    console.error('View once error:', err);
    await sock.sendMessage(jid, { text: '❌ Gagal proses view once.' }, { quoted });
  }
}

// ─────────────────────────────────────────────
// FITUR: DOWNLOAD VIDEO / AUDIO
// ─────────────────────────────────────────────
const SUPPORTED_PLATFORMS = ['youtube.com', 'youtu.be', 'tiktok.com', 'instagram.com', 'twitter.com', 'x.com', 'facebook.com'];
const URL_REGEX = /(https?:\/\/[^\s]+)/g;

async function downloadWithYtDlp(url, audioOnly = false) {
  const outputTemplate = tmpFile(`dl_${Date.now()}.%(ext)s`);
  const format = audioOnly
    ? '-x --audio-format mp3 --audio-quality 0'
    : '-f "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best[height<=720]" --merge-output-format mp4';

  const cmd = `yt-dlp ${format} --no-playlist --max-filesize 50m -o "${outputTemplate}" "${url}"`;

  await execAsync(cmd, { timeout: 120000 }); // 2 menit timeout

  // Cari file hasil download
  const dir = TMP;
  const files = fs.readdirSync(dir).filter(f => f.startsWith('dl_'));
  const latest = files
    .map(f => ({ name: f, time: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time)[0];

  if (!latest) throw new Error('File tidak ditemukan setelah download');
  return path.join(dir, latest.name);
}

async function handleDownload(sock, jid, text, quoted, audioOnly = false) {
  const urls = text.match(URL_REGEX);
  if (!urls) return false;

  const url = urls[0];
  const isSupported = SUPPORTED_PLATFORMS.some(p => url.includes(p));
  if (!isSupported) return false;

  await sock.sendMessage(jid, {
    text: `⬇️ Mendownload ${audioOnly ? 'audio' : 'video'}...\n${url}`,
  }, { quoted });

  let filePath;
  try {
    filePath = await downloadWithYtDlp(url, audioOnly);
    const fileBuffer = fs.readFileSync(filePath);

    if (audioOnly) {
      await sock.sendMessage(jid, {
        audio: fileBuffer,
        mimetype: 'audio/mpeg',
        ptt: false,
      }, { quoted });
    } else {
      await sock.sendMessage(jid, {
        video: fileBuffer,
        caption: '✅ Download selesai!',
      }, { quoted });
    }

    cleanup(filePath);
  } catch (err) {
    if (filePath) cleanup(filePath);
    console.error('Download error:', err);
    await sock.sendMessage(jid, {
      text: '❌ Gagal download. Pastikan:\n• Link valid\n• Video tidak privat\n• Ukuran < 50MB',
    }, { quoted });
  }

  return true;
}

// ─────────────────────────────────────────────
// PROSES PESAN MASUK
// ─────────────────────────────────────────────
async function processMessage(sock, msg) {
  // Abaikan pesan dari bot sendiri
  if (msg.key.fromMe) return;

  const jid = msg.key.remoteJid;
  const type = Object.keys(msg.message || {})[0];

  // ── Teks biasa ───────────────────────────────
  if (type === 'conversation' || type === 'extendedTextMessage') {
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    const lower = text.toLowerCase().trim();

    // Hanya proses command jika diawali prefix
    if (lower.startsWith(PREFIX)) {
      if (AUTO_REPLY[lower]) {
        return sock.sendMessage(jid, { text: AUTO_REPLY[lower] }, { quoted: msg });
      }
    }

    // Download audio jika ada flag ".audio" atau "audio" setelah URL
    if (lower.includes('audio') || lower.includes('mp3')) {
      const downloaded = await handleDownload(sock, jid, text, msg, true);
      if (downloaded) return;
    }

    // Download video jika ada URL
    const downloaded = await handleDownload(sock, jid, text, msg, false);
    if (downloaded) return;

    // Default — hanya balas jika pakai prefix
    if (lower.startsWith(PREFIX)) {
      return sock.sendMessage(jid, { text: DEFAULT_REPLY }, { quoted: msg });
    }
  }

  // ── Gambar ───────────────────────────────────
  if (type === 'imageMessage') {
    const caption = (msg.message.imageMessage?.caption || '').toLowerCase().trim();

    if (caption === '.stiker' || caption === '.s') {
      return makeSticker(sock, jid, msg, msg);
    }

    if (caption === '.vo' || caption === '.rvo' || caption === '.view once') {
      return sendViewOnce(sock, jid, msg, msg);
    }

    return sock.sendMessage(jid, {
      text: `📸 Gambar diterima! Mau diapain?\n\nKirim ulang dengan caption:\n• \`.stiker\` — jadikan stiker\n• \`.vo\` — view once`,
    }, { quoted: msg });
  }

  // ── Video / GIF ──────────────────────────────
  if (type === 'videoMessage') {
    const caption = (msg.message.videoMessage?.caption || '').toLowerCase().trim();

    if (caption === '.stiker' || caption === '.s') {
      return makeSticker(sock, jid, msg, msg);
    }

    return sock.sendMessage(jid, {
      text: `🎥 Video diterima! Kirim ulang dengan caption \`.stiker\` untuk dijadikan stiker animasi.`,
    }, { quoted: msg });
  }

  // ── Pesan quoted (reply ke media) ────────────
  if (type === 'extendedTextMessage') {
    const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
    const text = msg.message.extendedTextMessage?.text?.toLowerCase().trim() || '';

    if (quoted && (text === '.stiker' || text === '.s')) {
      const fakeQuoted = { message: quoted, key: msg.key };
      return makeSticker(sock, jid, msg, fakeQuoted);
    }

    if (quoted?.imageMessage && (text === '.vo' || text === '.rvo')) {
      const fakeQuoted = { message: quoted, key: msg.key };
      return sendViewOnce(sock, jid, msg, fakeQuoted);
    }
  }
}

// ─────────────────────────────────────────────
// SETUP KONEKSI BAILEYS
// ─────────────────────────────────────────────
const SESSION_DIR = './session';

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true, // QR code muncul di terminal
    auth: state,
    browser: ['WA Bot', 'Chrome', '1.0.0'],
    generateHighQualityLinkPreview: false,
  });

  // Simpan session saat update
  sock.ev.on('creds.update', saveCreds);

  // Handle koneksi
  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      currentQR = qr;
      console.log('QR code diperbarui — buka URL Replit untuk scan!');
    }

    if (connection === 'close') {
      currentQR = null;
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log('Koneksi terputus, kode:', code, shouldReconnect ? '— Reconnecting...' : '— Logged out.');
      if (shouldReconnect) startBot();
    }

    if (connection === 'open') {
      currentQR = null;
      console.log('✅ Bot terhubung ke WhatsApp!');
    }
  });

  // Handle pesan masuk
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        await processMessage(sock, msg);
      } catch (err) {
        console.error('Error proses pesan:', err);
      }
    }
  });
}

// ─────────────────────────────────────────────
// STATE: QR CODE
// ─────────────────────────────────────────────
let currentQR = null;

// ─────────────────────────────────────────────
// HTTP SERVER — tampilkan QR di halaman web
// ─────────────────────────────────────────────
const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer(async (req, res) => {
  if (req.url === '/') {
    if (currentQR) {
      // Generate QR sebagai PNG base64
      const qrImage = await qrcode.toDataURL(currentQR, { width: 300, margin: 2 });

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WA Bot — Scan QR</title>
  <meta http-equiv="refresh" content="10"> <!-- auto refresh tiap 10 detik -->
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #111;
      color: #fff;
      font-family: sans-serif;
      text-align: center;
      padding: 24px;
    }
    .card {
      background: #1e1e1e;
      border-radius: 20px;
      padding: 32px;
      max-width: 360px;
      width: 100%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    h1 { font-size: 20px; margin-bottom: 8px; }
    p { color: #aaa; font-size: 14px; margin-bottom: 24px; }
    img {
      width: 240px;
      height: 240px;
      border-radius: 12px;
      background: #fff;
      padding: 8px;
    }
    .badge {
      margin-top: 20px;
      background: #25d366;
      color: #fff;
      border-radius: 999px;
      padding: 6px 16px;
      font-size: 13px;
      display: inline-block;
    }
    .note { margin-top: 16px; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🤖 WhatsApp Bot</h1>
    <p>Scan QR ini dengan WhatsApp kamu</p>
    <img src="${qrImage}" alt="QR Code">
    <div class="badge">📱 Setelan → Perangkat Tertaut</div>
    <p class="note">Halaman ini refresh otomatis tiap 10 detik</p>
  </div>
</body>
</html>`);
    } else {
      // Bot sudah terhubung atau sedang loading
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WA Bot</title>
  <meta http-equiv="refresh" content="5">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #111;
      color: #fff;
      font-family: sans-serif;
      text-align: center;
      padding: 24px;
    }
    .card {
      background: #1e1e1e;
      border-radius: 20px;
      padding: 40px 32px;
      max-width: 360px;
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; margin-bottom: 8px; }
    p { color: #aaa; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Bot Aktif!</h1>
    <p>WhatsApp bot sudah terhubung dan siap digunakan.<br><br>Jika QR belum muncul, tunggu beberapa detik...</p>
  </div>
</body>
</html>`);
    }
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(PORT, () => {
  console.log(`Web server jalan di port ${PORT} — buka URL Replit untuk scan QR!`);
});

startBot().catch(console.error);
