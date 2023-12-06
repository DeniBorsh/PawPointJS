const { Telegraf, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
requere('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// Подключение к базе данных SQLite
const db = new sqlite3.Database('./data/database.db', sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the database.');
});

// Создание таблицы, если она не существует
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

// Старт бота и базовая логика
bot.start((ctx) => {
    const user_id = ctx.from.id;
    if (MODERS_LIST.includes(user_id)) {
        const keyboard = Markup.keyboard([
            ['??? Модерация', '??? Очистить фотографии'],
            ['?? Информация о БД']
        ]).resize();
        ctx.reply(`Привет, администратор ${ctx.from.first_name}!`, keyboard);
    } else {
        ctx.reply(`Привет, ${ctx.from.first_name}! Если вы хотите поделиться фотографией уличного животного, то я жду!`);
    }
});

// Дополнительные обработчики событий (commands, hears, on, action и т.д.)

// Функции для работы с базой данных

// Запуск поллинга для бота
bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));