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
    constructor(db) {
        this.db = db;
        this.queue = [];
    }

    async loadQueue() { this.queue = await selectQuery("SELECT id, user_id, file_id, description, lat, lng FROM photos WHERE status = 'new' OR status = 'delayed'", this.db); }
    hasNext() { return this.queue.length > 0; }
    getNext() { return this.queue.shift(); }
}

const moderationQueue = new ModerationQueue(db);
const userStates = new Map();

// Функция для выполнения запроса и получения результатов
function selectQuery(query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
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
    const userState = userStates.get(user_id) || { state: 'await_photo', file_id: null };

    if (userState.state === "await_photo") {
        userState.file_id = ctx.message.photo[0].file_id;
        userState.state = 'await_location';
        userStates.set(user_id, userState);
        ctx.reply('Теперь отправьте местоположение уличного животного');
    } else {
        const keyboard = Markup.inlineKeyboard([
            Markup.button.callback('❌ Отменить', 'cancell'),
            Markup.button.callback('➡️ Дополнить', 'finish')
        ]);
        ctx.reply("У вас имеется незавершенная публикация. Желаете ее дополнить или отменить?", { reply_markup: keyboard });
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

// Функция начала модерации
function start_moderation(ctx) {
    moderate(ctx);
}

// Функия модерации отдельных постов по очереди в очереди
async function moderate(ctx) {
    const user_id = ctx.from.id;
    if (MODERS_LIST.includes(user_id)) {
        // Получаем список постов для модерации из базы данных
        try {
            if (!moderationQueue.hasNext()) await moderationQueue.loadQueue();
            

            if (moderationQueue.hasNext()) {
                // Обрабатываем первый пост в очереди
                const request = moderationQueue.getNext();
                const request_id = request.id;
                const uid = request.user_id;
                const file_id = request.file_id;
                const description = request.description;
                const lat = request.lat;
                const lng = request.lng;

                // Создаем клавиатуру для модерации
                const markup = Markup.inlineKeyboard([
                    [
                        Markup.button.callback('✅ Принять', `accept_${request_id}`),
                        Markup.button.callback('❌ Отклонить', `reject_${request_id}`),
                        Markup.button.callback('⏰ Отложить', `delay_${request_id}`)
                    ],
                ]);

                // Формируем и отправляем сообщение с фото и кнопками
                const google_maps_url = `https://www.google.com/maps/place/${lat}\,${lng}`;
                const caption = `Автор: ${await get_username(uid)}\nОписание: ${description}\n[Местоположение](${google_maps_url})`;
                ctx.replyWithPhoto(file_id, {
                    caption, parse_mode: 'Markdown', reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ Принять", callback_data: `accept_${request_id}` },
                             { text: "❌ Отклонить", callback_data: `reject_${request_id}` },
                             { text: "⏰ Отложить", callback_data: `delay_${request_id}` }]
                        ]
                    }
                });
            } else {
                ctx.reply("Нет постов, ожидающих модерации.");
            }
        } catch (err) {
            ctx.reply('Произошла ошибка при обработке запроса.');
        }
    } else {
        ctx.reply("У вас нет прав для выполнения этой команды.");
    }
}

// Функция очистки базы данных от лишней информации
function cleanup(ctx) {
    const user_id = ctx.from.id;
    if (MODERS_LIST.includes(user_id)) {
        db.run("UPDATE photos SET status = 'deleted' WHERE status = 'edit'");
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
            ctx.reply(err);
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
    else if (userState.state === 'await_description') ctx.reply('Пожалуйста, напишите описание'); 
    else if (userState.state === 'await_username') ctx.reply('Пожалуйста, выберите настройку отображение имени');
    else if (userState.state === 'await_urgency') ctx.reply('Пожалуйста, выберите параметр срочности публикации');
}

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
function addDescription(ctx) {
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('👀 Пропустить', 'noDescription')],
    ]);

    bot.telegram.sendMessage(ctx.from.id, "Теперь добавьте описание к фотографии (опционально)", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "👀 Пропустить", callback_data: "noDescription" }],
            ]
        }
    });
}


// Запуск бота
bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));