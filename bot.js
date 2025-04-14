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
      return { rus: rus.trim(), ger: ger.trim() };
    });
} catch (err) {
  console.error("Ошибка при чтении файла words.txt:", err);
  process.exit(1);
}

////////////////////////////////////////////////////////////
// Глобальные баллы – теперь gruppenspezifisch
// Struktur: { chatId: { userId: { username, points } } }
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

function updateUserPoints(chatId, userId, username, pointsToAdd) {
  if (!pointsData[chatId]) {
    pointsData[chatId] = {};
  }
  if (!pointsData[chatId][userId]) {
    pointsData[chatId][userId] = { username, points: 0 };
  }
  pointsData[chatId][userId].points += pointsToAdd;
  savePoints();
}

function savePoints() {
  fs.writeFileSync(pointsFile, JSON.stringify(pointsData, null, 2));
}

////////////////////////////////////////////////////////////
// Состояние игры для каждой группы (с авто-таймером)
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
      autoInterval: null, // Таймер для автоматического запуска раундов
      rulesShown: false
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
// Функция нормализации строки (убирает лишние пробелы и приводит к нижнему регистру)
////////////////////////////////////////////////////////////

function normalize(str) {
  return str.trim().replace(/\s+/g, ' ').toLowerCase();
}

////////////////////////////////////////////////////////////
// Полный текст правил (будет выводиться один раз при запуске игры)
////////////////////////////////////////////////////////////

const RULES_TEXT = `So ihr Lieben! In den nächsten 24 Stunden bekommt ihr 24 Wörter, die ihr heute lernen werdet. Aber ihr könnt dabei auch Punkte sammeln.

1️⃣ Der Erste, der das Wort richtig übersetzt, bekommt +1 Punkt.
2️⃣ Danach könnt ihr – alle unabhängig voneinander – einen richtigen Satz mit dem Wort bilden und dafür +2 Punkte bekommen.
3️⃣ Wenn ihr 'Aufgabe+' schreibt, bekommt ihr +3 Punkte (dafür müsst ihr das Wort 4x in echten Gesprächen und 4x schriftlich (WhatsApp, Telegram etc. benutzen!).

📌 WICHTIG: Beim Schreiben eurer Sätze bitte auf die Grammatik achten!
Hier sind ein paar goldene Regeln, die euch helfen:

📚 DIE GOLDENEN GRAMMATIK-REGELN:
➤ Immer den richtigen Artikel benutzen! Beispiel:
   ✘ Haus (falsch!)
   ✔️ das Haus (richtig!)

➤ Manche Präpositionen verlangen bestimmte Fälle:
   • mit → Dativ → z. B. „mit dem Auto“, „mit der Sonne“
   • für → Akkusativ → z. B. „für das Kind“, „für die Katze“
   • von → Dativ → „von dem Mann“, „von der Frau“
   • ohne → Akkusativ → „ohne einen Plan“, „ohne die Jacke“

➤ Ein Satz sollte mindestens 5 Wörter haben!
   ✘ 'Ich liebe Haus' (zu kurz & grammatikalisch falsch)
   ✔️ 'Ich liebe das Haus in unserer Straße.'

➤ Großschreibung! Alle Nomen im Deutschen schreibt man groß:
   ✔️ „Ich habe einen Hund.“ (nicht: „einen hund“)

🧠 Denk dran: Dein Ziel ist nicht nur Punkte zu sammeln – sondern am Ende richtiges, echtes Deutsch zu sprechen 💪

Viel Erfolg und viel Spaß beim Deutschlernen! 🇩🇪✨`;

////////////////////////////////////////////////////////////
// Функция автостарта нового раунда в конкретной группе – для последующих раундов
////////////////////////////////////////////////////////////

function autoStartGame(chatId) {
  const game = ensureGame(chatId);
  console.log("autoStartGame для чата:", chatId);
  
  // Если раунд активен – время истекло
  if (game.roundActive) {
    bot.telegram.sendMessage(chatId, "Die Zeit ist leider abgelaufen.");
  }

  // Выбираем случайное слово
  game.currentWord = words[Math.floor(Math.random() * words.length)];
  game.currentParsedGer = parseGermanWord(game.currentWord.ger);

  game.roundActive = true;
  game.firstGuesser = null;
  game.sentenceSubmissions = {};
  game.aufgabeClaimed = {};

  bot.telegram.sendMessage(
    chatId,
    `Hier ist ein neues Wort: *${game.currentWord.rus}*\n\n` +
    `/regeln - um die Regeln zu lesen\n` +
    `/score - um Deinen Score zu sehen`,
    { parse_mode: 'Markdown' }
  );
}

////////////////////////////////////////////////////////////
// Команды бота
////////////////////////////////////////////////////////////

// Команда /startgame – запуск игры с выводом полного текста правил
bot.command('startgame', (ctx) => {
  const chatId = ctx.chat.id;
  const game = ensureGame(chatId);

  // Если авто-таймер уже запущен, сбрасываем его
  if (game.autoInterval) {
    clearInterval(game.autoInterval);
    game.autoInterval = null;
  }

  // Выбираем случайное слово
  game.currentWord = words[Math.floor(Math.random() * words.length)];
  game.currentParsedGer = parseGermanWord(game.currentWord.ger);

  game.roundActive = true;
  game.firstGuesser = null;
  game.sentenceSubmissions = {};
  game.aufgabeClaimed = {};
  game.rulesShown = false;

  // Вывод правил (только один раз в начале игры)
  ctx.reply(RULES_TEXT, { parse_mode: 'Markdown' });
  ctx.reply(
    `⚡️ *Neuer Rund!*\n` +
    `📝 Wort auf Russisch: *${game.currentWord.rus}*\n` +
    `\nBitte übersetze das Wort ins Deutsche! 🚀`,
    { parse_mode: 'Markdown' }
  );
  game.rulesShown = true;

  // Устанавливаем авто-таймер для нового слова
  game.autoInterval = setInterval(() => {
    autoStartGame(chatId);
  }, 30 * 30 * 1000);
});

// Команда /endgame – остановка игры
bot.command('endgame', (ctx) => {
  const chatId = ctx.chat.id;
  const game = ensureGame(chatId);

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

// Команда /score – вывод личного счёта в текущей группе
bot.command('score', (ctx) => {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const groupScores = pointsData[chatId] || {};
  const userData = groupScores[userId];
  const score = userData ? userData.points : 0;
  ctx.reply(`${ctx.from.first_name}, твой счёт: ${score}`);
});

// Команда /scoreall – вывод общего списка баллов в текущей группе
bot.command('scoreall', (ctx) => {
  const chatId = ctx.chat.id;
  const groupScores = pointsData[chatId] || {};
  if (Object.keys(groupScores).length === 0) {
    ctx.reply("Пока баллов нет.");
    return;
  }
  let result = "📊 *Счёт всех участников:*\n\n";
  const sorted = Object.entries(groupScores).sort((a, b) => b[1].points - a[1].points);
  sorted.forEach(([id, data], idx) => {
    result += `${idx + 1}. ${data.username}: ${data.points} баллов\n`;
  });
  ctx.reply(result, { parse_mode: 'Markdown' });
});

// Команда /leaderboard – вывод лидерборда
bot.command('leaderboard', (ctx) => {
  const chatId = ctx.chat.id;
  const groupScores = pointsData[chatId] || {};
  if (Object.keys(groupScores).length === 0) {
    ctx.reply("Пока баллов нет.");
    return;
  }
  let leaderboard = "🏆 *Лидерборд:*\n\n";
  const sorted = Object.entries(groupScores).sort((a, b) => b[1].points - a[1].points);
  sorted.forEach(([id, data], idx) => {
    leaderboard += `${idx + 1}. ${data.username}: ${data.points} баллов\n`;
  });
  ctx.reply(leaderboard, { parse_mode: 'Markdown' });
});

// Команда /regeln – вывод полных правил игры
bot.command('regeln', (ctx) => {
  ctx.reply(RULES_TEXT, { parse_mode: 'Markdown' });
});

// Команда /resetscoreall – сброс всех баллов только в текущей группе
bot.command('resetscoreall', (ctx) => {
  const chatId = ctx.chat.id;
  pointsData[chatId] = {};
  savePoints();
  ctx.reply("Alle Punkte in dieser Gruppe wurden zurückgesetzt.");
});

// Команда /restartgame – перезапуск игры (баллы сохраняются)
bot.command('restartgame', (ctx) => {
  const chatId = ctx.chat.id;
  const game = ensureGame(chatId);

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
// Обработка текстовых сообщений – логика игры
////////////////////////////////////////////////////////////

bot.on('text', (ctx) => {
  const text = ctx.message.text;
  // Если сообщение содержит русские буквы, бот не отвечает
  if (/[а-яё]/i.test(text)) {
    return;
  }
  
  const chatId = ctx.chat.id;
  const game = ensureGame(chatId);

  // Если в группе нет активного раунда, сообщения не обрабатываются
  if (!game.roundActive) return;

  const userId = ctx.from.id;
  const username = ctx.from.first_name || "Неизвестный";

  // 1) Обработка команды "Aufgabe+"
  if (text.trim() === "Aufgabe+") {
    if (!game.aufgabeClaimed[userId]) {
      updateUserPoints(chatId, userId, username, 3);
      game.aufgabeClaimed[userId] = true;
      ctx.reply(`Отлично, ${username}! Ты получаешь +3 балла за Aufgabe+. 🔥`);
    }
    return;
  }

  // 2) Проверка перевода слова
  if (!game.firstGuesser) {
    let userGuess = normalize(text);
    if (game.currentParsedGer?.hasArticle) {
      const expected = normalize(`${game.currentParsedGer.article} ${game.currentParsedGer.root}`);
      if (userGuess === expected) {
        game.firstGuesser = { userId, username };
        updateUserPoints(chatId, userId, username, 1);
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
        updateUserPoints(chatId, userId, username, 1);
        ctx.reply(`Отлично, ${username}! Ты первый и получаешь +1 балл.`);
        return;
      } else {
        ctx.reply("Почти! Правильно ли написано слово?");
        return;
      }
    }
  } else {
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
  if (game.sentenceSubmissions[userId]) return;

  const wordsInMessage = text.split(/\s+/).filter(w => w.length > 0);
  if (wordsInMessage.length < 5) {
    ctx.reply("Твоё предложение слишком короткое. Используй минимум 5 слов!");
    return;
  }

  const userSentenceLower = text.toLowerCase();
  const rootLower = (game.currentParsedGer?.root || "").toLowerCase();
  if (!userSentenceLower.includes(rootLower)) {
    ctx.reply("Почти! Правильно ли написано слово?");
    return;
  }

  game.sentenceSubmissions[userId] = true;
  updateUserPoints(chatId, userId, username, 2);
  ctx.reply(`Отлично, ${username}! Ты получаешь +2 балла за предложение.`);
});

////////////////////////////////////////////////////////////
// Запуск бота
////////////////////////////////////////////////////////////

bot.launch();
console.log("Бот запущен...");

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
