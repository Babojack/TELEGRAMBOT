////////////////////////////////////////////////////////////
// bot.js – Много-групповая версия с автообновлением раундов
////////////////////////////////////////////////////////////

import 'dotenv/config';
import { Telegraf } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

////////////////////////////////////////////////////////////
// Настройка путей и переменных
////////////////////////////////////////////////////////////

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("Ошибка: BOT_TOKEN не найден в .env файле!");
  process.exit(1);
}

const ADMIN_ID = process.env.ADMIN_ID || null;

const bot = new Telegraf(BOT_TOKEN);

////////////////////////////////////////////////////////////
// Чтение файла со словами (один и тот же для всех групп)
////////////////////////////////////////////////////////////

let words = [];
try {
  const data = fs.readFileSync(path.join(__dirname, 'words.txt'), 'utf8');
  words = data
    .split(/\r?\n/)
    .filter(line => line.trim() !== '')
    .map(line => {
      const [rus, ger] = line.split(':');
      return {
        rus: rus.trim(),
        ger: ger.trim()
      };
    });
} catch (err) {
  console.error("Ошибка при чтении файла words.txt:", err);
  process.exit(1);
}

////////////////////////////////////////////////////////////
// Глобальные баллы для всех пользователей (опционально)
////////////////////////////////////////////////////////////

const pointsFile = path.join(__dirname, 'points.json');
let pointsData = {};
if (fs.existsSync(pointsFile)) {
  try {
    pointsData = JSON.parse(fs.readFileSync(pointsFile, 'utf8'));
  } catch (err) {
    console.error("Ошибка при чтении файла points.json:", err);
  }
}

function updateUserPoints(userId, username, pointsToAdd) {
  if (!pointsData[userId]) {
    pointsData[userId] = { username, points: 0 };
  }
  pointsData[userId].points += pointsToAdd;
  savePoints();
}

function savePoints() {
  fs.writeFileSync(pointsFile, JSON.stringify(pointsData, null, 2));
}

////////////////////////////////////////////////////////////
// Состояние игры для каждой группы (с добавлением авто-таймера)
////////////////////////////////////////////////////////////

const games = {}; // games[chatId] => { roundActive, currentWord, autoInterval, ... }

function ensureGame(chatId) {
  if (!games[chatId]) {
    games[chatId] = {
      roundActive: false,
      currentWord: null,
      currentParsedGer: null,
      firstGuesser: null,
      sentenceSubmissions: {},
      aufgabeClaimed: {},
      wordIndex: 0,
      autoInterval: null // Таймер для автоматического запуска раундов в этой группе
    };
  }
  return games[chatId];
}

// Функция для разбора немецкого слова и его артикля
function parseGermanWord(ger) {
  const lower = ger.toLowerCase();
  if (lower.startsWith('der ') || lower.startsWith('die ') || lower.startsWith('das ')) {
    const [article, ...rest] = ger.split(/\s+/);
    const root = rest.join(' ');
    return { hasArticle: true, article, root };
  } else {
    return { hasArticle: false, article: null, root: ger };
  }
}

////////////////////////////////////////////////////////////
// Функция нормализации строки (удаляет лишние пробелы и приводит к нижнему регистру)
////////////////////////////////////////////////////////////

function normalize(str) {
  return str.trim().replace(/\s+/g, ' ').toLowerCase();
}

////////////////////////////////////////////////////////////
// Функция автостарта нового раунда в конкретной группе
////////////////////////////////////////////////////////////

function autoStartGame(chatId) {
  const game = ensureGame(chatId);

  // Если раунд уже активен, сообщаем об окончании старого слова
  if (game.roundActive) {
    bot.telegram.sendMessage(chatId, "Время для текущего слова истекло. Переходим к следующему слову.");
  }

  if (game.wordIndex >= words.length) {
    game.wordIndex = 0;
  }

  game.currentWord = words[game.wordIndex];
  game.wordIndex++;
  game.currentParsedGer = parseGermanWord(game.currentWord.ger);

  game.roundActive = true;
  game.firstGuesser = null;
  game.sentenceSubmissions = {};
  game.aufgabeClaimed = {};

  // Объявление нового раунда
  bot.telegram.sendMessage(
    chatId,
    "Новое слово!\n\n" +
    "В течение следующих 24 часов вы получите 24 слова для изучения. " +
    "Первый, кто правильно переведёт слово, получит +1 балл, а за составление правильного предложения – +2 балла.\n\n" +
    "Удачи!"
  );

  bot.telegram.sendMessage(
    chatId,
    `⚡️ *Новый раунд!*\n` +
    `📝 Слово на русском: *${game.currentWord.rus}*\n` +
    `\nПожалуйста, переведите это слово на немецкий! 🚀`,
    { parse_mode: 'Markdown' }
  );
}

////////////////////////////////////////////////////////////
// Команды бота
////////////////////////////////////////////////////////////

// Запуск игры. После вызова /startgame в группе, будет запущен новый раунд
// и настроен таймер, который раз в час будет автоматически отправлять новое слово.
bot.command('startgame', (ctx) => {
  const chatId = ctx.chat.id;
  const game = ensureGame(chatId);

  // Опционально: ограничение команды для админа
  if (ADMIN_ID && ctx.from.id.toString() !== ADMIN_ID.toString()) {
    ctx.reply("Только админ может запускать игру.");
    return;
  }

  // Если уже был запущен авто-таймер для этой группы, сбрасываем его
  if (game.autoInterval) {
    clearInterval(game.autoInterval);
    game.autoInterval = null;
  }

  // Запуск нового раунда
  if (game.wordIndex >= words.length) {
    game.wordIndex = 0;
  }
  game.currentWord = words[game.wordIndex];
  game.wordIndex++;
  game.currentParsedGer = parseGermanWord(game.currentWord.ger);

  game.roundActive = true;
  game.firstGuesser = null;
  game.sentenceSubmissions = {};
  game.aufgabeClaimed = {};

  ctx.reply(
    "В течение следующих 24 часов вы будете получать 24 слова для изучения языка. " +
    "Правильный перевод слова даёт +1 балл, а составление корректного предложения – +2 балла. " +
    "При вводе 'Aufgabe+' вы получаете +3 балла.\n\n" +
    "Удачи!"
  );

  ctx.reply(
    `⚡️ *Новый раунд!*\n` +
    `📝 Слово на русском: *${game.currentWord.rus}*\n` +
    `\nПожалуйста, переведите это слово на немецкий! 🚀`,
    { parse_mode: 'Markdown' }
  );

  // Устанавливаем авто-таймер для запуска нового слова каждые 60 минут
  game.autoInterval = setInterval(() => {
    autoStartGame(chatId);
  }, 60 * 60 * 1000);
});

// Завершение игры в текущей группе (останавливаем раунд и сбрасываем авто-таймер)
bot.command('endgame', (ctx) => {
  const chatId = ctx.chat.id;
  const game = ensureGame(chatId);

  if (ADMIN_ID && ctx.from.id.toString() !== ADMIN_ID.toString()) {
    ctx.reply("Только админ может останавливать игру.");
    return;
  }

  if (game.autoInterval) {
    clearInterval(game.autoInterval);
    game.autoInterval = null;
  }

  game.roundActive = false;
  game.currentWord = null;
  game.currentParsedGer = null;
  game.firstGuesser = null;
  game.sentenceSubmissions = {};
  game.aufgabeClaimed = {};

  ctx.reply("Игра остановлена.");
});

// Команда для просмотра личного счёта
bot.command('score', (ctx) => {
  const userId = ctx.from.id;
  const userData = pointsData[userId];
  const score = userData ? userData.points : 0;
  ctx.reply(`${ctx.from.first_name}, твой счёт: ${score}`);
});

// Вывод общего списка баллов
bot.command('scoreall', (ctx) => {
  if (Object.keys(pointsData).length === 0) {
    ctx.reply("Пока баллов нет.");
    return;
  }
  let result = "📊 *Счёт всех участников:*\n\n";
  const sorted = Object.entries(pointsData).sort((a, b) => b[1].points - a[1].points);
  sorted.forEach(([id, data], idx) => {
    result += `${idx + 1}. ${data.username}: ${data.points} баллов\n`;
  });
  ctx.reply(result, { parse_mode: 'Markdown' });
});

bot.command('leaderboard', (ctx) => {
  if (Object.keys(pointsData).length === 0) {
    ctx.reply("Пока баллов нет.");
    return;
  }
  let leaderboard = "🏆 *Лидерборд:*\n\n";
  const sorted = Object.entries(pointsData).sort((a, b) => b[1].points - a[1].points);
  sorted.forEach(([id, data], idx) => {
    leaderboard += `${idx + 1}. ${data.username}: ${data.points} баллов\n`;
  });
  ctx.reply(leaderboard, { parse_mode: 'Markdown' });
});

// Перезапуск игры: сбрасывает состояние для группы и останавливает авто-таймер
bot.command('restartgame', (ctx) => {
  const chatId = ctx.chat.id;
  const game = ensureGame(chatId);

  if (ADMIN_ID && ctx.from.id.toString() !== ADMIN_ID.toString()) {
    ctx.reply("Только админ может перезапускать игру.");
    return;
  }

  if (game.autoInterval) {
    clearInterval(game.autoInterval);
    game.autoInterval = null;
  }

  game.roundActive = false;
  game.currentWord = null;
  game.currentParsedGer = null;
  game.firstGuesser = null;
  game.sentenceSubmissions = {};
  game.aufgabeClaimed = {};
  game.wordIndex = 0;

  ctx.reply("Игра перезапущена (баллы сохраняются). Запустите новую игру командой /startgame.");
});

////////////////////////////////////////////////////////////
// Обработка текстовых сообщений – основная логика игры
////////////////////////////////////////////////////////////

bot.on('text', (ctx) => {
  const chatId = ctx.chat.id;
  const game = ensureGame(chatId);

  // Если нет активного раунда в этой группе, сообщения не обрабатываются
  if (!game.roundActive) return;

  const text = ctx.message.text;
  const userId = ctx.from.id;
  const username = ctx.from.first_name || "Неизвестный";

  // 1) Команда "Aufgabe+"
  if (text.trim() === "Aufgabe+") {
    if (!game.aufgabeClaimed[userId]) {
      updateUserPoints(userId, username, 3);
      game.aufgabeClaimed[userId] = true;
      ctx.reply(`Отлично, ${username}! Ты получаешь +3 балла за Aufgabe+. 🔥`);
    }
    return;
  }

  // 2) Проверка перевода слова
  if (!game.firstGuesser) {
    // Используем normalize() для приведения ответа к стандартному виду
    let userGuess = normalize(text);
    if (game.currentParsedGer?.hasArticle) {
      // Ожидаемый ответ формируется и нормализуется
      const expected = normalize(`${game.currentParsedGer.article} ${game.currentParsedGer.root}`);
      if (userGuess === expected) {
        game.firstGuesser = { userId, username };
        updateUserPoints(userId, username, 1);
        ctx.reply(`Отлично, ${username}! Ты первый и получаешь +1 балл.`);
        return;
      } else {
        ctx.reply("Почти! Проверь, правильно ли указан артикль (der, die, das).");
        return;
      }
    } else {
      const expected = normalize(game.currentParsedGer.root);
      if (userGuess === expected) {
        game.firstGuesser = { userId, username };
        updateUserPoints(userId, username, 1);
        ctx.reply(`Отлично, ${username}! Ты первый и получаешь +1 балл.`);
        return;
      } else {
        ctx.reply("Почти! Правильно ли написано слово?");
        return;
      }
    }
  } else {
    // Если слово уже угадано, повторные попытки
    let userGuess = normalize(text);
    let expected;
    if (game.currentParsedGer?.hasArticle) {
      expected = normalize(`${game.currentParsedGer.article} ${game.currentParsedGer.root}`);
    } else {
      expected = normalize(game.currentParsedGer.root || "");
    }
    if (userGuess === expected) {
      ctx.reply(`Увы, ${game.firstGuesser.username} уже угадал первым! 😉`);
      return;
    }
  }

  // 3) Проверка предложения (минимум 5 слов и наличие ключевого слова)
  if (game.sentenceSubmissions[userId]) {
    // Пользователь уже отправлял предложение
    return;
  }

  const wordsInMessage = text.split(/\s+/).filter(w => w.length > 0);
  if (wordsInMessage.length < 5) {
    ctx.reply("Твоё предложение слишком короткое. Используй минимум 5 слов!");
    return;
  }

  const userSentenceLower = text.toLowerCase(); // здесь можно оставить простой toLowerCase(), так как мы ищем вхождение
  const rootLower = game.currentParsedGer?.root.toLowerCase() || "";
  if (!userSentenceLower.includes(rootLower)) {
    ctx.reply("Почти! Правильно ли написано слово?");
    return;
  }

  // Если предложение корректно, начисляем +2 балла
  game.sentenceSubmissions[userId] = true;
  updateUserPoints(userId, username, 2);
  ctx.reply(`Отлично, ${username}! Ты получаешь +2 балла за предложение.`);
});

////////////////////////////////////////////////////////////
// Запуск бота
////////////////////////////////////////////////////////////

bot.launch();
console.log("Бот запущен...");

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
