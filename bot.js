const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const sharp = require('sharp');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Configuration
const CONFIG = {
    MAX_FILE_SIZE: 8 * 1024 * 1024, // 8MB
    STICKER_SIZE: 512,
    STICKER_AUTHOR: 'Bot Sticker WA',
    DEFAULT_STICKER_NAME: 'Bot WhatsApp', // Nama default
    TRIGGER_COMMAND: '.s',
    WATERMARK_COMMAND: '.wm',
    TAGALL_COMMAND: '.tagall' // Command baru untuk tagall
};

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('Scan QR code di atas dengan WhatsApp HP-mu!');
});

client.on('ready', () => {
    console.log('Bot siap!');
    console.log('Gunakan:');
    console.log('- ".s" untuk sticker dengan nama default');
    console.log('- ".s [nama]" untuk custom nama sticker');
    console.log('- "Reply sticker .wm <nama>" untuk ganti nama sticker');
    console.log('- ".tagall" untuk tag semua member group');
    console.log('- ".help" untuk bantuan');
});

client.on('message', async message => {
    // Skip if message is from status broadcast
    if (message.from === 'status@broadcast') return;

    const text = message.body ? message.body.trim() : '';

    try {
        // Check jika message ada media dan image dengan command .s
        if (message.hasMedia && message.type === 'image' && text.toLowerCase().startsWith(CONFIG.TRIGGER_COMMAND)) {
            // Extract nama sticker dari command
            const stickerName = extractStickerName(text, CONFIG.TRIGGER_COMMAND);
            await processSticker(message, stickerName);
        } 
        // Check jika message adalah command .wm (harus reply)
        else if (text.toLowerCase().startsWith(CONFIG.WATERMARK_COMMAND)) {
            const watermarkText = text.substring(CONFIG.WATERMARK_COMMAND.length).trim();
            
            if (!watermarkText) {
                await message.reply('❌ Format salah! Gunakan: *.wm nama-sticker*');
                return;
            }

            // HARUS reply ke sticker
            if (message.hasQuotedMsg) {
                const quotedMsg = await message.getQuotedMessage();
                
                if (quotedMsg.hasMedia && quotedMsg.type === 'sticker') {
                    await processStickerFromReply(quotedMsg, watermarkText, message);
                } else {
                    await message.reply('❌ Reply harus ke sticker!');
                }
            } else {
                await message.reply('❌ Kirim command ini dengan reply ke sticker!');
            }
        }
        // Check jika message adalah command .tagall
        else if (text.toLowerCase().startsWith(CONFIG.TAGALL_COMMAND)) {
            await tagAllMembers(message);
        }
        // Help command
        else if (text === '.help' || text === '!sticker' || text === '!stiker') {
            await sendHelpMessage(message);
        }
    } catch (error) {
        console.error('Error processing message:', error);
        await message.reply('❌ Maaf, terjadi error saat memproses permintaan.');
    }
});

// Function untuk extract nama sticker dari command
function extractStickerName(text, command) {
    const remainingText = text.substring(command.length).trim();
    
    if (!remainingText) {
        return CONFIG.DEFAULT_STICKER_NAME; // "Bot WhatsApp"
    }
    
    return remainingText; // Custom nama
}

// Function untuk tag semua member group
async function tagAllMembers(message) {
    try {
        const chat = await message.getChat();
        
        // Cek apakah ini group chat
        if (!chat.isGroup) {
            await message.reply('❌ Command ini hanya bisa digunakan di group!');
            return;
        }

        // Cek apakah pengirim adalah admin
        if (!chat.isGroup) {
            await message.reply('❌ Command ini hanya untuk group!');
            return;
        }

        const participants = chat.participants;
        
        // Filter bot sendiri dan buat list mentions
        let mentionText = '';
        let mentions = [];
        
        participants.forEach((participant, index) => {
            // Skip bot sendiri
            if (participant.id._serialized === message.author) {
                return;
            }
            
            mentionText += `@${participant.id.user} `;
            mentions.push(participant.id._serialized);
        });

        // Tambahkan pesan custom jika ada
        const customMessage = message.body.substring(CONFIG.TAGALL_COMMAND.length).trim();
        const finalMessage = customMessage ? `${customMessage}\n\n${mentionText}` : `📢 Tag All!\n\n${mentionText}`;

        // Kirim pesan dengan mentions
        await chat.sendMessage(finalMessage, { mentions: mentions });
        
        console.log(`✅ Tagall executed in group: ${chat.name}`);
        
    } catch (error) {
        console.error('Error tagall:', error);
        await message.reply('❌ Gagal melakukan tagall: ' + error.message);
    }
}

async function processSticker(message, stickerName) {
    try {
        console.log('Mendownload media...');
        
        const media = await Promise.race([
            message.downloadMedia(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout download media')), 30000)
            )
        ]);

        if (!media) {
            throw new Error('Media tidak ditemukan');
        }

        if (!media.data && !media.mediaBase64) {
            throw new Error('Data media kosong');
        }

        const mediaData = media.mediaBase64 || media.data;
        
        if (!mediaData) {
            throw new Error('Tidak ada data media yang valid');
        }

        // Calculate file size
        const fileSize = (mediaData.length * 3) / 4;
        if (fileSize > CONFIG.MAX_FILE_SIZE) {
            throw new Error(`Ukuran gambar terlalu besar (${(fileSize / 1024 / 1024).toFixed(2)}MB). Maksimal 8MB.`);
        }

        console.log('Processing gambar...');
        
        const buffer = Buffer.from(mediaData, 'base64');
        
        if (buffer.length === 0) {
            throw new Error('Buffer gambar kosong');
        }

        // Process image
        const processedBuffer = await sharp(buffer)
            .resize(CONFIG.STICKER_SIZE, CONFIG.STICKER_SIZE, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .png()
            .toBuffer();

        await sendSticker(message.from, processedBuffer, stickerName);
        
        // Kirim pesan konfirmasi yang berbeda
        if (stickerName === CONFIG.DEFAULT_STICKER_NAME) {
            await message.reply('✅ Sticker berhasil dibuat! 🎉');
        } else {
            await message.reply(`✅ Sticker "${stickerName}" berhasil dibuat! 🎉`);
        }
        
        console.log('Sticker berhasil dikirim!');

    } catch (error) {
        console.error('Error konversi sticker:', error);
        handleStickerError(error, message);
    }
}

async function processStickerFromReply(quotedMsg, watermarkText, originalMessage) {
    try {
        console.log('Mendownload sticker dari reply...');
        
        const media = await Promise.race([
            quotedMsg.downloadMedia(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout download media')), 30000)
            )
        ]);

        if (!media) {
            throw new Error('Sticker tidak ditemukan');
        }

        if (!media.data && !media.mediaBase64) {
            throw new Error('Data sticker kosong');
        }

        const mediaData = media.mediaBase64 || media.data;
        
        if (!mediaData) {
            throw new Error('Tidak ada data sticker yang valid');
        }

        console.log('Menggunakan sticker asli dengan nama baru:', watermarkText);
        
        // Decode base64 data
        const buffer = Buffer.from(mediaData, 'base64');
        
        if (buffer.length === 0) {
            throw new Error('Buffer sticker kosong');
        }

        // Kirim sticker yang sama persis, hanya ganti nama saja
        await sendSticker(originalMessage.from, buffer, watermarkText);
        
        await originalMessage.reply(`✅ Sticker "${watermarkText}" berhasil dibuat! 🎉`);
        console.log('Sticker dengan nama baru berhasil dikirim!');

    } catch (error) {
        console.error('Error mengubah nama sticker:', error);
        handleStickerError(error, originalMessage);
    }
}

async function sendSticker(chatId, buffer, stickerName) {
    // Convert buffer ke base64 untuk MessageMedia
    const processedBase64 = buffer.toString('base64');
    
    // Create MessageMedia object
    const stickerMedia = new MessageMedia(
        'image/png',
        processedBase64,
        'sticker.png'
    );
    
    // Kirim sebagai sticker dengan nama custom
    await client.sendMessage(chatId, stickerMedia, {
        sendMediaAsSticker: true,
        stickerAuthor: CONFIG.STICKER_AUTHOR,
        stickerName: stickerName,
    });
}

function handleStickerError(error, message) {
    let errorMessage = '❌ Maaf, terjadi error saat memproses sticker.';
    
    if (error.message.includes('too large')) {
        errorMessage = '❌ Gambar terlalu besar! Maksimal 8MB.';
    } else if (error.message.includes('tidak valid') || error.message.includes('kosong')) {
        errorMessage = '❌ Sticker tidak valid. Coba dengan sticker lain.';
    } else if (error.message.includes('Format gambar')) {
        errorMessage = '❌ Format tidak didukung.';
    } else if (error.message.includes('Timeout')) {
        errorMessage = '❌ Timeout saat mengunduh sticker. Coba lagi.';
    }
    
    message.reply(`${errorMessage}\n\nDetail: ${error.message}`);
}

async function sendHelpMessage(message) {
    const helpText = `
🤖 *BOT STICKER WA* 🤖

*Cara penggunaan:*

*1. Sticker dengan Nama Default:*
   - Kirim gambar dengan caption *".s"*
   - Nama sticker: "Bot WhatsApp"

*2. Sticker dengan Nama Custom:*
   - Kirim gambar dengan caption *".s nama-sticker"*
   - Contoh: 
     • ".s Lucu" → nama sticker "Lucu"
     • ".s Keren Banget" → nama sticker "Keren Banget"

*3. Ganti Nama Sticker (.wm):*
   - *Reply* sebuah sticker dengan *".wm nama-baru"*
   - Contoh: Reply sticker + tulis ".wm Lucu"

*4. Tag All Members (.tagall):*
   - Ketik *".tagall"* di group untuk tag semua member
   - Atau *".tagall pesan-custom"* dengan pesan custom

*Note:* 
• Maksimal ukuran gambar 8MB
• .wm harus reply ke sticker yang sudah ada
• .tagall hanya bekerja di group
    `;
    
    await message.reply(helpText);
    console.log('Ada yang minta bantuan nih');
}

// Event handlers
client.on('auth_failure', () => {
    console.log('❌ Gagal autentikasi. Hapus folder .wwebjs_auth dan scan QR ulang.');
});

client.on('disconnected', (reason) => {
    console.log('🔌 Bot terputus:', reason);
    console.log('🔄 Menghubungkan ulang dalam 5 detik...');
    setTimeout(() => {
        client.initialize();
    }, 5000);
});

client.on('change_state', state => {
    console.log('🔄 State changed:', state);
});

// Error handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🛑 Shutting down bot...');
    await client.destroy();
    process.exit(0);
});

client.initialize();
