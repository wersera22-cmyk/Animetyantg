import { Bot } from "grammy";
import dotenv from "dotenv";

dotenv.config();

const bot = new Bot(process.env.BOT_TOKEN);
const ADMIN_ID = Number(process.env.ADMIN_ID);

// Хранилище: message_id -> данные сообщения
const storage = new Map();

// Вспомогательная функция: текущее время в читаемом формате
function now() {
    return new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
}

// Вспомогательная функция: тип контента и file_id
function extractMedia(msg) {
    if (msg.photo) return { type: "photo", fileId: msg.photo[msg.photo.length - 1].file_id };
    if (msg.video) return { type: "video", fileId: msg.video.file_id };
    if (msg.voice) return { type: "voice", fileId: msg.voice.file_id };
    if (msg.video_note) return { type: "video_note", fileId: msg.video_note.file_id };
    if (msg.sticker) return { type: "sticker", fileId: msg.sticker.file_id };
    if (msg.document) return { type: "document", fileId: msg.document.file_id };
    if (msg.animation) return { type: "animation", fileId: msg.animation.file_id };
    if (msg.audio) return { type: "audio", fileId: msg.audio.file_id };
    return { type: "text", fileId: null };
}

// ========== /start ==========
bot.command("start", async (ctx) => {
    const user = ctx.from;
    if (user.id !== ADMIN_ID) {
        await ctx.reply("У вас нет прав.");
        try {
            await bot.api.sendMessage(ADMIN_ID,
                `🚨 <b>Попытка доступа!</b>\n\n` +
                `<b>Имя:</b> ${user.first_name || ""} ${user.last_name || ""}\n` +
                `<b>ID:</b> <code>${user.id}</code>\n` +
                `<b>Юзер:</b> @${user.username || "отсутствует"}`,
                { parse_mode: "HTML" }
            );
        } catch (e) {
            console.error("Не удалось отправить уведомление:", e.message);
        }
    } else {
        await ctx.reply("Привет, хозяйка! Бот работает.");
    }
});

// ========== Новые бизнес-сообщения (сохраняем) ==========
bot.on("business_message", async (ctx) => {
    const msg = ctx.businessMessage;
    const user = msg.from;
    
    // Если сообщение отправил сам владелец бизнес-аккаунта — не сохраняем
    if (user.id === ADMIN_ID) return;

    const media = extractMedia(msg);
    const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim() || "Без имени";

    storage.set(msg.message_id, {
        text: msg.text || msg.caption || "",
        userName: fullName,
        userId: user.id,
        username: user.username ? `@${user.username}` : "нет юзера",
        type: media.type,
        fileId: media.fileId,
        sentAt: now(),
        editedAt: null,
        originalText: null,
    });
});

// ========== Редактирование бизнес-сообщений ==========
bot.on("edited_business_message", async (ctx) => {
    const msg = ctx.editedBusinessMessage;
    const user = msg.from;
    
    if (user.id === ADMIN_ID) return;

    const old = storage.get(msg.message_id);
    const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim() || "Без имени";

    const oldText = old ? (old.text || "(без текста)") : "(исходное сообщение не найдено)";
    const newText = msg.text || msg.caption || "(без текста)";

    if (old) {
        if (!old.originalText) old.originalText = old.text;
        old.text = newText;
        old.editedAt = now();
        storage.set(msg.message_id, old);
    }

    let report =
        `✏️ <b>Сообщение изменено</b>\n\n` +
        `<b>Кто:</b> ${fullName} (${user.username ? "@" + user.username : "нет юзера"})\n` +
        `<b>ID:</b> <code>${user.id}</code>\n` +
        `<b>Время изменения:</b> ${now()}\n\n` +
        `<b>Было:</b>\n${oldText}\n\n` +
        `<b>Стало:</b>\n${newText}`;

    try {
        await bot.api.sendMessage(ADMIN_ID, report, { parse_mode: "HTML" });
    } catch (e) {
        console.error("Ошибка отправки отчёта об редактировании:", e.message);
    }
});

// ========== Удаление бизнес-сообщений ==========
bot.on("deleted_business_messages", async (ctx) => {
    const deleted = ctx.update.deleted_business_messages;
    const deletionTime = now();

    for (const msgId of deleted.message_ids) {
        const data = storage.get(msgId);
        if (!data) continue;

        // Если удалил сам админ — пропускаем (чтобы не спамило своими же удалениями)
        if (data.userId === ADMIN_ID) continue;

        const sentTime = new Date(data.sentAt).getTime();
        const nowTime = new Date(deletionTime).getTime();
        const secondsSinceSent = (nowTime - sentTime) / 1000;
        
        // Если сообщение жило меньше 2 минут и не редактировалось — считаем, что это таймер
        const isLikelyTimer = secondsSinceSent < 120 && !data.editedAt;

        let report =
            `<b>🗑 удалено: ${data.type}</b>\n\n` +
            `<b>От:</b> ${data.userName} (${data.username})\n` +
            `<b>ID:</b> <code>${data.userId}</code>\n` +
            `<b>Время удаления:</b> ${deletionTime}\n` +
            `<b>Текст:</b> ${data.text || "(без текста)"}`;

        if (isLikelyTimer) {
            report += `\n\n⏱ <i>Возможно, удалено таймером (жило ~${Math.round(secondsSinceSent)} сек.)</i>`;
        }

        try {
            await bot.api.sendMessage(ADMIN_ID, report, { parse_mode: "HTML" });

            if (data.fileId) {
                switch (data.type) {
                    case "photo":
                        await bot.api.sendPhoto(ADMIN_ID, data.fileId, { caption: data.text || undefined });
                        break;
                    case "video":
                        await bot.api.sendVideo(ADMIN_ID, data.fileId, { caption: data.text || undefined });
                        break;
                    case "voice":
                        await bot.api.sendVoice(ADMIN_ID, data.fileId);
                        break;
                    case "video_note":
                        await bot.api.sendVideoNote(ADMIN_ID, data.fileId);
                        break;
                    case "sticker":
                        await bot.api.sendSticker(ADMIN_ID, data.fileId);
                        break;
                    case "document":
                        await bot.api.sendDocument(ADMIN_ID, data.fileId, { caption: data.text || undefined });
                        break;
                    case "animation":
                        await bot.api.sendAnimation(ADMIN_ID, data.fileId, { caption: data.text || undefined });
                        break;
                    case "audio":
                        await bot.api.sendAudio(ADMIN_ID, data.fileId);
                        break;
                }
            }
        } catch (e) {
            console.error(`Ошибка при отправке удалённого ${data.type}:`, e.message);
        }

        storage.delete(msgId);
    }
});

// ========== Запуск ==========
bot.start({
    onStart: (info) => console.log(`🙂‍↕️ Бот @${info.username} запущен...`),
});