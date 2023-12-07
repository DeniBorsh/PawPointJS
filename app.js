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
    +process.env.WIROTENSHI
]

const db = new sqlite3.Database('./data/database.db', sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
        console.error(err.message);
    }
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

bot.hears('🛡️ Модерация', async (ctx) => start_moderating(ctx));
bot.hears('🗑️ Очистить фотографии', async (ctx) => cleanup(ctx));
bot.hears('📝 Информация о БД', async (ctx) => get_info(ctx));

function start_moderation(ctx) {
    moderate(ctx.from.id);
}

function get_info(ctx) {
    const user_id = ctx.from.id;
    if (MODERS_LIST.includes(user_id)) {
        db.run()
    }
}
function cleanup(ctx) {
    const user_id = ctx.from.id;
    if (MODERS_LIST.includes(user_id)) {
        db.run("UPDATE photos SET status = 'deleted' WHERE status = 'edit'");
        ctx.reply('Очистка успешно завершена');
    } else {
        ctx.reply('У вас нет прав для выполнения этой команды.');
    }
}

// Функция для выполнения запроса и получения результатов
function getDatabaseInfo(query) {
    return new Promise((resolve, reject) => {
        db.all(query, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

async function get_info() {
    try {
        const newPosts = await getDatabaseInfo("SELECT COUNT(id) as count FROM photos WHERE status = 'new'");
        const acceptedPosts = await getDatabaseInfo("SELECT COUNT(id) as count FROM photos WHERE status = 'accepted'");
        const rejectedPosts = await getDatabaseInfo("SELECT COUNT(id) as count FROM photos WHERE status = 'rejected'");
        const delayedPosts = await getDatabaseInfo("SELECT COUNT(id) as count FROM photos WHERE status = 'delayed'");
        const editingPosts = await getDatabaseInfo("SELECT COUNT(id) as count FROM photos WHERE status = 'edit'");

        return `Новые публикации: ${newPosts[0].count}\nПринятые: ${acceptedPosts[0].count}\nОтклоненные: ${rejectedPosts[0].count}\nОтложенные: ${delayedPosts[0].count}\nЕще не готовые: ${editingPosts[0].count}`;
    } catch (err) {
        console.error(err);
        throw new Error('Произошла ошибка при получении информации из базы данных.');
    }
}

bot.command('info', async (ctx) => {
    const user_id = ctx.from.id;
    if (MODERS_LIST.includes(user_id)) {
        try {
            const response = await get_info();
            ctx.reply(response);
        } catch (error) {
            ctx.reply(error.message);
        }
    } else {
        ctx.reply('У вас нет прав для выполнения этой команды.');
    }
});



bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));