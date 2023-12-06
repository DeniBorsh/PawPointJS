const { Telegraf, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
requere('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// ����������� � ���� ������ SQLite
const db = new sqlite3.Database('./data/database.db', sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the database.');
});

// �������� �������, ���� ��� �� ����������
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

// ����� ���� � ������� ������
bot.start((ctx) => {
    const user_id = ctx.from.id;
    if (MODERS_LIST.includes(user_id)) {
        const keyboard = Markup.keyboard([
            ['??? ���������', '??? �������� ����������'],
            ['?? ���������� � ��']
        ]).resize();
        ctx.reply(`������, ������������� ${ctx.from.first_name}!`, keyboard);
    } else {
        ctx.reply(`������, ${ctx.from.first_name}! ���� �� ������ ���������� ����������� �������� ���������, �� � ���!`);
    }
});

// �������������� ����������� ������� (commands, hears, on, action � �.�.)

// ������� ��� ������ � ����� ������

// ������ �������� ��� ����
bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));