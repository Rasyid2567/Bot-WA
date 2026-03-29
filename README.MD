# 🤖 WhatsApp Bot — Replit

Gratis, tanpa kartu kredit, langsung dari HP.

---

## 🚀 CARA DEPLOY

### 1. Buat Akun Replit
- Buka https://replit.com
- Daftar gratis pakai Google/GitHub

### 2. Import dari GitHub
- Klik **"+ Create Repl"**
- Pilih tab **"Import from GitHub"**
- Paste URL repo GitHub kamu
- Klik **"Import from GitHub"**

### 3. Jalankan Bot
- Klik tombol **"Run"** (▶️) di atas
- Tunggu install dependencies (~2-3 menit pertama kali)
- QR code akan muncul di tab **Console**
- Scan dengan WhatsApp → **Setelan → Perangkat Tertaut**

Bot aktif! ✅

---

## 😴 BIAR BOT TIDAK TIDUR (Gratis)

Replit free akan "tidur" kalau tidak ada request masuk. Solusinya:

1. Daftar gratis di https://uptimerobot.com
2. Klik **"+ Add New Monitor"**
3. Pilih tipe: **HTTP(s)**
4. URL: `https://NAMA-REPL.NAMA-USER.repl.co`
   *(URL ini muncul di pojok kanan atas saat bot jalan)*
5. Interval: **5 minutes**
6. Klik **"Create Monitor"**

UptimeRobot akan ping bot tiap 5 menit → bot tidak pernah tidur! 🎉

---

## ⚠️ SESSION HILANG SAAT RESTART

Sama seperti platform gratis lainnya, session WA bisa hilang saat restart.
Solusi: simpan session ke **Supabase** (gratis). Bilang kalau mau dibantu!

---

## 💬 CARA PAKAI BOT

| Fitur | Cara |
|---|---|
| 📸 Stiker | Kirim foto + caption `.stiker` |
| 🎞️ Stiker animasi | Kirim GIF + caption `.stiker` |
| 👁️ View once | Kirim foto + caption `.vo` |
| ⬇️ Download video | Kirim link YT/TikTok/IG |
| 🎵 Download audio | Kirim link + kata `audio` |
| 📋 Menu | Ketik `.menu` |

---

## ✏️ EDIT BOT DARI HP

1. Buka repo di GitHub
2. Edit `index.js`
3. Commit perubahan
4. Di Replit → klik **"Pull"** untuk update, lalu **"Run"** lagi
