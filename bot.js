////////////////////////////////////////////////////////////
// bot.js – Много-групповая версия с auto-Timer + Verzögerung
////////////////////////////////////////////////////////////

import 'dotenv/config';
import { Telegraf } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

////////////////////////////////////////////////////////////
// Pfade und Variablen
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
// words.txt lesen (ein gemeinsamer Wortschatz für alle Gruppen)
////////////////////////////////////////////////////////////

let words = [];
try {
  const data = fs.readFileSync(path.join(__dirname, 'words.txt'), 'utf8');
  words = data
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [rus, ger] = line.split(':');
      return {
        rus: rus.trim(),
        ger: ger.trim(),
      };
    });
} catch (err) {
  console.error('Ошибка при чтении файла words.txt:', err);
  process.exit(1);
}

////////////////////////////////////////////////////////////
// Punkte – gruppenspezifisch speichern
// Struktur: { chatId: { userId: { username, points } } }
////////////////////////////////////////////////////////////

const pointsFile = path.join(__dirname, 'points.json');
let pointsData = {};
if (fs.existsSync(pointsFile)) {
  try {
    pointsData = JSON.parse(fs.readFileSync(pointsFile, 'utf8'));
  } catch (err) {
    console.error('Ошибка при чтении файла points.json:', err);
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
// Spielezustand pro Gruppe (Chat)
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
      autoInterval: null, // Timer für automatische Runden
      rulesShown: false,
    };
  }
  return games[chatId];
}

// Nützlich: parseGermanWord extrahiert Artikel und Hauptwort
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
// String normalisieren
////////////////////////////////////////////////////////////

function normalize(str) {
  return str.trim().replace(/\s+/g, ' ').toLowerCase();
}

////////////////////////////////////////////////////////////
// Voller Regeltext
////////////////////////////////////////////////////////////

const RULES_TEXT = `So ihr Lieben! In den nächsten 24 Stunden ... (usw. – voller Regeltext)`;

/**
 * autoStartGame – startet eine neue Runde in einem Chat.
 * Jetzt mit kleinem Delay, damit "Die Zeit ist abgelaufen" zuerst kommt,
 * und danach (z. B. 2 Sek. später) das neue Wort gesendet wird.
 */
async function autoStartGame(chatId) {
  const game = ensureGame(chatId);
  console.log('autoStartGame für Chat:', chatId);

  // Wenn der alte Durchlauf noch aktiv war, erst "Die Zeit ist abgelaufen" senden:
  if (game.roundActive) {
    await bot.telegram.sendMessage(chatId, 'Die Zeit ist leider abgelaufen.');
    // Nun 2 Sek. warten, bevor das neue Wort kommt:
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Neues Wort zufällig wählen
  game.currentWord = words[Math.floor(Math.random() * words.length)];
  game.currentParsedGer = parseGermanWord(game.currentWord.ger);

  game.roundActive = true;
  game.firstGuesser = null;
  game.sentenceSubmissions = {};
  game.aufgabeClaimed = {};

  await bot.telegram.sendMessage(
    chatId,
    `Hier ist ein neues Wort: *${game.currentWord.rus}*\n\n` +
      `/rules - um die Regeln zu lesen\n` +
      `/score - um Deinen Score zu sehen`,
    { parse_mode: 'Markdown' },
  );
}

////////////////////////////////////////////////////////////
// Bot-Kommandos
////////////////////////////////////////////////////////////

// /startgame
bot.command('startgame', (ctx) => {
  const chatId = ctx.chat.id;
  const game = ensureGame(chatId);

  // Timer zurücksetzen, falls schon läuft
  if (game.autoInterval) {
    clearInterval(game.autoInterval);
    game.autoInterval = null;
  }

  // Erstes Wort zufällig wählen
  game.currentWord = words[Math.floor(Math.random() * words.length)];
  game.currentParsedGer = parseGermanWord(game.currentWord.ger);

  game.roundActive = true;
  game.firstGuesser = null;
  game.sentenceSubmissions = {};
  game.aufgabeClaimed = {};
  game.rulesShown = false;

  // Regeln + erstes Wort
  ctx.reply(RULES_TEXT, { parse_mode: 'Markdown' });
  ctx.reply(
    `⚡️ *Neuer Rund!*\n` +
      `📝 Wort auf Russisch: *${game.currentWord.rus}*\n` +
      `\nBitte übersetze das Wort ins Deutsche! 🚀`,
    { parse_mode: 'Markdown' },
  );
  game.rulesShown = true;

  // Automatischer Timer – alle 5 Minuten z. B.
  game.autoInterval = setInterval(() => {
    autoStartGame(chatId);
  }, 5 * 60 * 1000);
});

// /endgame
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

  ctx.reply('Игра остановлена.');
});

// /score (eigener Punktestand)
bot.command('score', (ctx) => {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const groupScores = pointsData[chatId] || {};
  const userData = groupScores[userId];
  const score = userData ? userData.points : 0;
  ctx.reply(`${ctx.from.first_name}, твой счёт: ${score}`);
});

// /scoreall (alle Punktestände im Chat)
bot.command('scoreall', (ctx) => {
  const chatId = ctx.chat.id;
  const groupScores = pointsData[chatId] || {};
  if (Object.keys(groupScores).length === 0) {
    ctx.reply('Пока баллов нет.');
    return;
  }

  let result = '📊 *Счёт всех участников:*\n\n';
  const sorted = Object.entries(groupScores).sort((a, b) => b[1].points - a[1].points);
  sorted.forEach(([id, data], idx) => {
    result += `${idx + 1}. ${data.username}: ${data.points} баллов\n`;
  });

  ctx.reply(result, { parse_mode: 'Markdown' });
});

// /leaderboard
bot.command('leaderboard', (ctx) => {
  const chatId = ctx.chat.id;
  const groupScores = pointsData[chatId] || {};
  if (Object.keys(groupScores).length === 0) {
    ctx.reply('Пока баллов нет.');
    return;
  }

  let leaderboard = '🏆 *Лидерборд:*\n\n';
  const sorted = Object.entries(groupScores).sort((a, b) => b[1].points - a[1].points);
  sorted.forEach(([id, data], idx) => {
    leaderboard += `${idx + 1}. ${data.username}: ${data.points} баллов\n`;
  });

  ctx.reply(leaderboard, { parse_mode: 'Markdown' });
});

// /regeln
bot.command('rules', (ctx) => {
  ctx.reply(RULES_TEXT, { parse_mode: 'Markdown' });
});

// /resetscoreall (alle Punkte in der aktuellen Gruppe auf 0)
bot.command('resetscoreall', (ctx) => {
  const chatId = ctx.chat.id;
  pointsData[chatId] = {};
  savePoints();
  ctx.reply('Alle Punkte in dieser Gruppe wurden zurückgesetzt.');
});

// /restartgame (Spiel neu starten, Punkte bleiben)
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

  ctx.reply('Игра перезапущена (баллы сохраняются). Запустите новую игру командой /startgame.');
});

////////////////////////////////////////////////////////////
// Nachrichten-Handler (Spiel-Logik)
////////////////////////////////////////////////////////////

bot.on('text', (ctx) => {
  const text = ctx.message.text;
  // Nachrichten ignorieren, die Russisch oder nur aus Emojis bestehen
  const cyrillicRegex = /[а-яё]/i;
  const emojiRegex = /^[\p{Emoji}\s]+$/u;
  if (cyrillicRegex.test(text) || emojiRegex.test(text)) {
    return;
  }

  const chatId = ctx.chat.id;
  const game = ensureGame(chatId);

  // Keine aktive Runde => keine Reaktion
  if (!game.roundActive) return;

  const userId = ctx.from.id;
  const username = ctx.from.first_name || 'Неизвестный';

  // 1) "Aufgabe+"
  if (text.trim() === 'Aufgabe+') {
    if (!game.aufgabeClaimed[userId]) {
      updateUserPoints(chatId, userId, username, 3);
      game.aufgabeClaimed[userId] = true;
      ctx.reply(`Отлично, ${username}! Ты получаешь +3 балла за Aufgabe+. 🔥`);
    }
    return;
  }

  // 2) Erstes korrektes Übersetzen (1 Punkt)
  if (!game.firstGuesser) {
    const userGuess = normalize(text);

    if (game.currentParsedGer?.hasArticle) {
      const expected = normalize(`${game.currentParsedGer.article} ${game.currentParsedGer.root}`);
      if (userGuess === expected) {
        game.firstGuesser = { userId, username };
        updateUserPoints(chatId, userId, username, 1);
        ctx.reply(`Отлично, ${username}! Ты первый und bekommst +1 балл.`);
        return;
      } else {
        ctx.reply('Почти! Prüfe den richtigen Artikel (der, die, das).');
        return;
      }
    } else {
      const expected = normalize(game.currentParsedGer.root);
      if (userGuess === expected) {
        game.firstGuesser = { userId, username };
        updateUserPoints(chatId, userId, username, 1);
        ctx.reply(`Отлично, ${username}! Ты первый und bekommst +1 балл.`);
        return;
      } else {
        ctx.reply('Почти! Hast du das Wort richtig geschrieben?');
        return;
      }
    }
  } else {
    // Jemand anders hat schon übersetzt -> check, ob man es nochmal richtig tippt
    const userGuess = normalize(text);
    let expected;
    if (game.currentParsedGer?.hasArticle) {
      expected = normalize(`${game.currentParsedGer.article} ${game.currentParsedGer.root}`);
    } else {
      expected = normalize(game.currentParsedGer.root || '');
    }
    if (userGuess === expected) {
      ctx.reply(`Zu spät, ${username}! ${game.firstGuesser.username} war schon schneller 😉`);
      return;
    }
  }

  // 3) Satz mit min. 5 Wörtern + enthaltenem Wort => +2 Punkte
  if (game.sentenceSubmissions[userId]) return;

  const wordsInMessage = text.split(/\s+/).filter((w) => w.length > 0);
  if (wordsInMessage.length < 5) {
    ctx.reply('Dein Satz ist zu kurz. Benutze mindestens 5 Wörter!');
    return;
  }

  const userSentenceLower = text.toLowerCase();
  const rootLower = (game.currentParsedGer?.root || '').toLowerCase();
  if (!userSentenceLower.includes(rootLower)) {
    ctx.reply('Puh, das Wort scheint im Satz zu fehlen oder ist falsch geschrieben!');
    return;
  }

  game.sentenceSubmissions[userId] = true;
  updateUserPoints(chatId, userId, username, 2);
  ctx.reply(`Super, ${username}! Dein Satz war gültig, du bekommst +2 Punkte.`);
});

////////////////////////////////////////////////////////////
// Bot starten (Polling-Modus, z. B. auf Render Background Worker)
////////////////////////////////////////////////////////////

(async () => {
  // Vor dem Start Webhook löschen, um Konflikte (Fehler 409) zu verhindern
  await bot.telegram.deleteWebhook();
  await bot.launch();
  console.log('Bot läuft nun im Polling-Modus...');
})();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
