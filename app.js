// Конфигурация

const { Telegraf, Markup } = require("telegraf");

const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const MODERS_LIST = [
    +process.env.CONTARO,
    +process.env.BRAKOVAN,
    +process.env.ASKH,
    +process.env.SIGMA,
    +process.env.WIROTENSHI,
    +process.env.GURMAN
];

const db = new sqlite3.Database('./data/database.db', sqlite3.OPEN_READWRITE, (err) => {
    if (err) console.error(err.message);
}); 

db.run(`CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    file_id TEXT,
    description TEXT,
    lat REAL,
    lng REAL,
    status TEXT,
    username TEXT
)`);

class ModerationQueue {
    constructor() {
        this.queue = [];
    }

    async loadQueue() { this.queue = await selectQuery("SELECT id, user_id, file_id, description, lat, lng FROM photos WHERE status = 'new' OR status = 'delayed'")}
    hasNext() { return this.queue.length > 0; }
    getNext() { return this.queue.shift(); }
}

const moderationQueue = new ModerationQueue();
const userStates = new Map();

// Функция для выполнения запроса и получения результатов
function selectQuery(query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) {
                console.error("Ошибка запроса:", query);
                console.error("Параметры запроса:", params);
                console.error("Ошибка SQLite:", err);
                reject(err);
            } else {
                console.log("Результат запроса:", rows);
                resolve(rows);
            }
        });
    });
}

// Функция для выполнения запроса на изменение
function runQuery(query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

// Старт. Админам добавляются кнопки

bot.start((ctx) => {
    const user_id = ctx.from.id;
    if (MODERS_LIST.includes(user_id)) {
        const keyboard = Markup.keyboard([
            ['🛡️ Модерация', '🗑️ Очистить фотографии'],
            ['📝 Информация о БД'] 
        ]).resize();
        ctx.reply(`Привет, администратор ${ctx.from.first_name}!`, keyboard);
    } else {
        ctx.reply(`Привет, ${ctx.from.first_name}! Если вы хотите поделиться фотографией уличного животного, то я жду!`);
    }
});

bot.command('moderate', async (ctx) => start_moderation(ctx))
bot.hears('🛡️ Модерация', async (ctx) => start_moderation(ctx));

bot.command('cleanup', async (ctx) => cleanup(ctx));
bot.hears('🗑️ Очистить фотографии', async (ctx) => cleanup(ctx));

bot.command('info', async (ctx) => get_info(ctx));
bot.hears('📝 Информация о БД', async (ctx) => get_info(ctx));

bot.on('photo', async (ctx) => {
    const user_id = ctx.from.id;
    const userState = userStates.get(user_id) || {state: 'await_photo', file_id: null };

    if (userState.state === 'await_photo') {
        userState.file_id = ctx.message.photo[0].file_id;
        userState.state = 'await_location';
        userStates.set(user_id, userState);
        ctx.reply('Теперь отправьте местоположение уличного животного');
    } else {
        const keyboard = Markup.inlineKeyboard([
            Markup.button.callback('❌ Отменить', 'cancell'),
            Markup.button.callback('➡️ Дополнить', 'complete')
        ]);
        ctx.replyWithPhoto(userState.file_id);
        ctx.reply('У вас имеется незавершенная публикация. Желаете ее дополнить или отменить?', { reply_markup: keyboard });
    }
});

bot.on('location', async (ctx) => {
    const user_id = ctx.from.id;
    const userState = userStates.get(user_id);

    if (userState && userState.state === 'await_location') {
        try {
            const { latitude: lat, longitude: lng } = ctx.message.location;
            await runQuery("INSERT INTO photos (user_id, file_id, status, username, description, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [user_id, userState.file_id, "edit", "", "", lat, lng]);
            userState.state = 'await_description';
            userStates.set(user_id, userState);

            addDescription(ctx);
        } catch (e) { console.error(e); }
    } else {
        sendStateMessage(ctx);
    }
});

// Добавление описания
bot.on('text', (ctx) => {
    const user_id = ctx.from.id;
    const userState = userStates.get(user_id);

    if (userState && userState.state === 'await_description') {
        userStates.delete(user_id);
        ctx.reply('Ваша публикация сохранена и отправлена на модерацию');
    } else {
        sendStateMessage(ctx);
    }
});

bot.on('sticker', (ctx) => sendStateMessage(ctx));

// Обработка коллбека для отмены публикации
bot.action('cancell', async (ctx) => {
    const user_id = ctx.from.id;
    const userState = userStates.get(user_id)
    if (userState && ['await_description', 'await_username', 'await_urgency'].includes(userState.state))
        runQuery('DELETE FROM photos WHERE file_id = ?', [userState.id]);
    if (userState) userStates.delete(user_id);
    ctx.reply('Публикация успешно отозвана. Для совершения новой публикации просто поделитель фотографией!');
});

// Обработка коллбека для продолжения работы с публикацией
bot.action('complete', (ctx) => {
    const user_id = ctx.from.id;
    const userState = userStates.get(user_id)
    if (userState) {
        if (userState.state === 'await_location')
            ctx.reply('Отправьте местоположение уличного животного');
        else if (userState.state === 'await_description')
            addDescription(ctx, 'Добавьте описание к фотографии(опционально)');
        else if (userState.state === 'await_username')
            addUsername(ctx);
        else if (userState.state === 'await_urgency')
            addUrgency(ctx);
    } 
});

// Обработка коллбеков для принятия
bot.action(/accept_(.+)/, async (ctx) => {
    runQuery('UPDATE photos SET status = ? WHERE id = ?', ['accepted', ctx.match[1]]);
    try {
        const photoInfo = await selectQuery("SELECT file_id, description, lat, lng, username FROM photos WHERE id = ?", [ctx.match[1]]);
        if (photoInfo.length > 0) {
            const { file_id, description, lat, lng, username } = photoInfo[0];
            let caption = "";
            if (username && username.length > 0) {
                caption += `Автор: ${username}\n`;
            }
            if (description && description.length > 0) {
                caption += `Комментарий автора: ${description}\n`;
            }

            const googleMapsUrl = `https://www.google.com/maps/place/${lat},${lng}`;
            caption += `[Местоположение](${googleMapsUrl})`;
            
            ctx.replyWithPhoto(file_id, { caption, parse_mode: 'Markdown' });
        }
    } catch (err) {
        ctx.reply('Произошла ошибка при обработке запроса.');
    }
    ctx.reply(`Заявка с ID ${ctx.match[1]} отложена`);
});

// Обработка коллбеков для отклонения
bot.action(/reject_(.+)/, async (ctx) => {
    runQuery('UPDATE photos SET status = ? WHERE id = ?', ['rejected', ctx.match[1]]);
    ctx.reply(`Заявка с ID ${ctx.match[1]} отклонена`);
});

// Обработка коллбеков для отложения
bot.action(/delay_(.+)/, async (ctx) => {
    runQuery('UPDATE photos SET status = ? WHERE id = ?', ['delayed', ctx.match[1]]);
    ctx.reply(`Заявка с ID ${ctx.match[1]} отложена`);
});

bot.action('finish', (ctx) => finishPublication(ctx));
bot.action('descriptionNone', (ctx) => addUsername(ctx));
bot.action('usernameNone', (ctx) => addUrgency(ctx));

bot.action('usernameName', async (ctx) => {
    const file_id = userStates.get(ctx.from.id);
    await runQuery('UPDATE photos SET username = ? WHERE file_id = ?', [ctx.from.first_name, file_id]);
    addUrgency(ctx);
});

bot.action('usernameLink', async (ctx) => {
    const file_id = userStates.get(ctx.from.id);
    const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    await runQuery('UPDATE photos SET username = ? WHERE file_id = ?', [username, file_id]);
    addUrgency(ctx);
});

bot.action('urgent', async (ctx) => {
    finishPublication(ctx);

})

// Функция начала модерации
function start_moderation(ctx) {
    moderate(ctx);
}

// Функия модерации отдельных постов по очереди в очереди
async function moderate(ctx) {
    const admin_id = ctx.from.id;
    if (MODERS_LIST.includes(admin_id)) {
        try {
            if (!moderationQueue.hasNext()) await moderationQueue.loadQueue();

            if (moderationQueue.hasNext()) {
                const request = moderationQueue.getNext();
                const request_id = request.id;
                const user_id = request.user_id;
                const file_id = request.file_id;
                const description = request.description;
                const lat = request.lat;
                const lng = request.lng;
                const google_maps_url = `https://www.google.com/maps/place/${lat}\,${lng}`;
                const caption = `Автор: ${await getUsername(user_id)}\nОписание: ${description}\n[Местоположение](${google_maps_url})`;
               
                ctx.replyWithPhoto(file_id, {
                    caption, parse_mode: 'Markdown', reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ Принять", callback_data: `accept_${request_id}` },
                             { text: "❌ Отклонить", callback_data: `reject_${request_id}` }],
                             [{ text: "⏰ Отложить", callback_data: `delay_${request_id}` }]
                        ]
                    }
                });
            } else {
                ctx.reply("Нет постов, ожидающих модерации.");
            }
        } catch (err) {
            console.error(err);
            ctx.reply('Произошла ошибка при обработке запроса.');
        }
    } else {
        ctx.reply("У вас нет прав для выполнения этой команды.");
    }
}

// Функция очистки базы данных от лишней информации
async function cleanup(ctx) {
    const user_id = ctx.from.id;
    if (MODERS_LIST.includes(user_id)) {
        await runQuery("UPDATE photos SET status = 'deleted' WHERE status = 'edit'");
        ctx.reply('Очистка успешно завершена');
    } else {
        ctx.reply('У вас нет прав для выполнения этой команды.');
    }
}

// Функция получения информации о базе данных
async function get_info(ctx) {
    const user_id = ctx.from.id;
    if (MODERS_LIST.includes(user_id)) {
        try {
            const newPosts = await selectQuery("SELECT COUNT(id) as count FROM photos WHERE status = 'new'");
            const acceptedPosts = await selectQuery("SELECT COUNT(id) as count FROM photos WHERE status = 'accepted'");
            const rejectedPosts = await selectQuery("SELECT COUNT(id) as count FROM photos WHERE status = 'rejected'");
            const delayedPosts = await selectQuery("SELECT COUNT(id) as count FROM photos WHERE status = 'delayed'");
            const editingPosts = await selectQuery("SELECT COUNT(id) as count FROM photos WHERE status = 'edit'");

            ctx.reply(`Новые публикации: ${newPosts[0].count}\nПринятые: ${acceptedPosts[0].count}\nОтклоненные: ${rejectedPosts[0].count}\nОтложенные: ${delayedPosts[0].count}\nЕще не готовые: ${editingPosts[0].count}`);
        } catch (err) {
            ctx.reply('Произошла ошибка');
        }
    } else {
        ctx.reply('У вас нет прав для выполнения этой команды.');
    }
}

// Отправка сообщение о неверно выполненном шаге
function sendStateMessage(ctx) {
    const user_id = ctx.from.id;
    const userState = userStates.get(user_id);

    if (!userState || userState.state === 'await_photo') ctx.reply('Пожалуйста, отправьте фотографию уличного животного');
    else if (userState.state === 'await_location') ctx.reply('Пожалуйста, пришлите местоположение в виде геоданных');
    else if (userState.state === 'await_description') addDescription('Пожалуйста, напишите текстовое описание'); 
    else if (userState.state === 'await_username') ctx.reply('Пожалуйста, выберите настройку отображение имени');
    else if (userState.state === 'await_urgency') ctx.reply('Пожалуйста, выберите параметр срочности публикации');
}

// Отправляются сообщения с колбек-кнопками
function addDescription(ctx, message = 'Теперь добавьте описание к фотографии (опционально)') {
    bot.telegram.sendMessage(ctx.from.id, message, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '👀 Пропустить', callback_data: 'descriptionNone' }],
            ]
        }
    });
}

function addUsername(ctx, message = 'Хотите ли вы, чтобы в посте отображалось ваше имя либо ссылка на ваш профиль?') {
    bot.telegram.sendMessage(ctx.from.id, message, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '❌ Нет', callback_data: 'usernameNone' },
                 { text: '🗿 Имя', callback_data: 'usernameName' },
                 { text: '🔗 Ссылка', callback_data: 'usernameLink' }],
            ]
        }
    });
}

function addUrgency(ctx, message = 'Если животное требует срочного внимания, нажмите на соответствующую кнопку') {
    bot.telegram.sendMessage(ctx.from.id, message, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ Завершить', callback_data: 'finish' },
                 { text: '❗️ Срочно', callback_data: 'urgent' }]
            ]
        }
    });
}

// Завершить обновление базы данных
async function finishPublication(ctx) {
    const user_id = ctx.from.id;
    const userState = userStates.get(user_id);
    if (userState) {
        await runQuery('UPDATE photos SET status = ? WHERE file_id = ?', ['new', userState.file_id]);
        ctx.reply('Публикация успешно сохранена!');
    }
    else ctx.reply('Не удалось отправить публикацию. Попробуйте снова');
}

// Функция получения username из id
async function getUsername(userId) {
    try {
        const chat = await bot.telegram.getChat(userId);
        return chat.username ? `@${chat.username}` : ""; chat.first_name;
    } catch (err) {
        return ""; 
    }
}


// Запуск бота
bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));