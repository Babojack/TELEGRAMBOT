////////////////////////////////////////////////////////////
// bot.js – Multi-Gruppen-Version
////////////////////////////////////////////////////////////

import 'dotenv/config';
import { Telegraf } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

////////////////////////////////////////////////////////////
// Pfad/Variablen-Setup
////////////////////////////////////////////////////////////

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("Fehler: BOT_TOKEN wurde nicht in der .env-Datei gefunden!");
  process.exit(1);
}

const ADMIN_ID = process.env.ADMIN_ID || null;

// KEINE feste GROUP_ID mehr, weil wir ja in vielen Gruppen aktiv sein wollen
// Wenn du trotzdem bestimmte Gruppen beschränken willst, musst du das manuell regeln.

const bot = new Telegraf(BOT_TOKEN);

////////////////////////////////////////////////////////////
// Wörter einlesen (gleich für alle Gruppen)
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
  console.error("Fehler beim Lesen der words.txt:", err);
  process.exit(1);
}

////////////////////////////////////////////////////////////
// Punkte – global für alle User (optional)
////////////////////////////////////////////////////////////

const pointsFile = path.join(__dirname, 'points.json');
let pointsData = {};
if (fs.existsSync(pointsFile)) {
  try {
    pointsData = JSON.parse(fs.readFileSync(pointsFile, 'utf8'));
  } catch (err) {
    console.error("Fehler beim Lesen der points.json:", err);
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
// SPIELZUSTAND pro Gruppe in einem games-Objekt
////////////////////////////////////////////////////////////

const games = {}; // games[chatId] => { roundActive, currentWord, ... }

function ensureGame(chatId) {
  // Falls kein Eintrag existiert, anlegen
  if (!games[chatId]) {
    games[chatId] = {
      roundActive: false,
      currentWord: null,
      currentParsedGer: null,
      firstGuesser: null,
      sentenceSubmissions: {}, // wer hat schon Sätze geschrieben
      aufgabeClaimed: {},      // wer hat schon Aufgabe+ benutzt
      wordIndex: 0
    };
  }
  return games[chatId];
}

// Artikel-Parser:
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
// Automodus (global)
////////////////////////////////////////////////////////////

let autoMode = false;
let autoInterval = null;

function startAutoMode() {
  if (autoInterval) clearInterval(autoInterval);
  autoMode = true;
  autoInterval = setInterval(() => {
    // Alle Gruppen durchgehen, in denen NICHT gerade eine Runde läuft
    for (const chatId of Object.keys(games)) {
      const game = games[chatId];
      if (!game.roundActive && autoMode) {
        console.log(`Auto-Modus: Starte automatisch eine neue Runde in Chat ${chatId}...`);
        autoStartGame(chatId);
      }
    }
  }, 60 * 60 * 1000);
}

function stopAutoMode() {
  autoMode = false;
  if (autoInterval) {
    clearInterval(autoInterval);
    autoInterval = null;
  }
}

// Startet das Spiel in einem bestimmten chatId
function autoStartGame(chatId) {
  const game = ensureGame(chatId);

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

  bot.telegram.sendMessage(
    chatId,
    "So ihr Lieben! In den nächsten 24 Stunden bekommt ihr 24 Wörter, die ihr heute lernen werdet. " +
    "Aber ihr könnt dabei auch Punkte sammeln.\n\n" +
    "1️⃣ Der erste, der das Wort errät, bekommt +1 Punkt.\n" +
    "2️⃣ Ihr könnt danach – unabhängig davon, wer der Erste war – einen Satz mit dem Wort bilden und dafür +2 Punkte kriegen.\n" +
    "3️⃣ Tagesaufgabe: Falls ihr 'Aufgabe+' schreibt, bekommt ihr +3 Punkte.\n\n" +
    "Viel Erfolg und viel Spaß!"
  );

  bot.telegram.sendMessage(
    chatId,
    `⚡️ *Neue Runde!*\n` +
    `📝 Das Wort auf Russisch: *${game.currentWord.rus}*\n` +
    `\nBitte übersetzt dieses Wort ins Deutsche! 🚀`,
    { parse_mode: 'Markdown' }
  );
}

////////////////////////////////////////////////////////////
// Befehle /startgame etc.
////////////////////////////////////////////////////////////

bot.command('startgame', (ctx) => {
  const chatId = ctx.chat.id;
  const game = ensureGame(chatId);

  // Optional: nur Admin darf starten
  if (ADMIN_ID && ctx.from.id.toString() !== ADMIN_ID.toString()) {
    ctx.reply("Nur der Admin darf das Spiel starten.");
    return;
  }

  if (game.roundActive) {
    ctx.reply("Es läuft bereits eine Runde!");
    return;
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

  ctx.reply(
    "So ihr Lieben! In den nächsten 24 Stunden bekommt ihr 24 Wörter, die ihr heute lernen werdet. " +
"Aber ihr könnt dabei auch Punkte sammeln.\n\n" +
"1️⃣ Der Erste, der das Wort richtig übersetzt, bekommt +1 Punkt.\n" +
"2️⃣ Danach könnt ihr – alle unabhängig voneinander – einen richtigen Satz mit dem Wort bilden und dafür +2 Punkte bekommen.\n" +
"3️⃣ Wenn ihr 'Aufgabe+' schreibt, bekommt ihr +3 Punkte (dafür müsst ihr das Wort 4x in echten Gesprächen und 4x schriftlich benutzen!).\n\n" +
"📌 WICHTIG: Beim Schreiben eurer Sätze bitte auf die Grammatik achten!\n" +
"Hier sind ein paar goldene Regeln, die euch helfen:\n\n" +

"📚 DIE GOLDENEN GRAMMATIK-REGELN:\n" +
"➤ Immer den richtigen Artikel benutzen! Beispiel:\n" +
"   ✘ Haus (falsch!)\n" +
"   ✔ das Haus (richtig!)\n\n" +

"➤ Manche Präpositionen verlangen bestimmte Fälle:\n" +
"   • mit → Dativ → z. B. „mit dem Auto“, „mit der Sonne“\n" +
"   • für → Akkusativ → z. B. „für das Kind“, „für die Katze“\n" +
"   • von → Dativ → „von dem Mann“, „von der Frau“\n" +
"   • ohne → Akkusativ → „ohne einen Plan“, „ohne die Jacke“\n\n" +

"➤ Ein Satz sollte mindestens 5 Wörter haben!\n" +
"   ✘ 'Ich liebe Haus' (zu kurz & grammatikalisch falsch)\n" +
"   ✔ 'Ich liebe das Haus in unserer Straße.'\n\n" +

"➤ Großschreibung! Alle Nomen im Deutschen schreibt man groß:\n" +
"   ✔ „Ich habe einen Hund.“ (nicht: „einen hund“)\n\n" +

"🧠 Denk dran: Dein Ziel ist nicht nur Punkte zu sammeln – sondern am Ende richtiges, echtes Deutsch zu sprechen 💪\n\n" +
"Viel Erfolg und viel Spaß beim Deutschlernen! 🇩🇪✨"
  );

  ctx.reply(
    `⚡️ *Neue Runde!*\n` +
    `📝 Das Wort auf Russisch: *${game.currentWord.rus}*\n` +
    `\nBitte übersetzt dieses Wort ins Deutsche! 🚀`,
    { parse_mode: 'Markdown' }
  );
});


bot.command('endgame', (ctx) => {
  const chatId = ctx.chat.id;
  const game = ensureGame(chatId);

  if (ADMIN_ID && ctx.from.id.toString() !== ADMIN_ID.toString()) {
    ctx.reply("Nur der Admin darf das Spiel beenden.");
    return;
  }

  if (!game.roundActive) {
    ctx.reply("Es läuft aktuell keine Runde.");
    return;
  }

  game.roundActive = false;
  game.currentWord = null;
  game.currentParsedGer = null;
  game.firstGuesser = null;
  game.sentenceSubmissions = {};
  game.aufgabeClaimed = {};

  ctx.reply("Die Runde wurde beendet.");
});


bot.command('score', (ctx) => {
  const userId = ctx.from.id;
  const userData = pointsData[userId];
  const score = userData ? userData.points : 0;
  ctx.reply(`${ctx.from.first_name}, dein Punktestand: ${score}`);
});

// Zeigt alle Punkte (global)
bot.command('scoreall', (ctx) => {
  if (Object.keys(pointsData).length === 0) {
    ctx.reply("Noch keine Punkte vorhanden.");
    return;
  }
  let result = "📊 *Punktestand aller Teilnehmer:*\n\n";
  const sorted = Object.entries(pointsData).sort((a, b) => b[1].points - a[1].points);
  sorted.forEach(([id, data], idx) => {
    result += `${idx + 1}. ${data.username}: ${data.points} Punkte\n`;
  });
  ctx.reply(result, { parse_mode: 'Markdown' });
});

bot.command('leaderboard', (ctx) => {
  if (Object.keys(pointsData).length === 0) {
    ctx.reply("Noch keine Punkte vorhanden.");
    return;
  }
  let leaderboard = "🏆 *Tabelle der Besten:*\n\n";
  const sorted = Object.entries(pointsData).sort((a, b) => b[1].points - a[1].points);
  sorted.forEach(([id, data], idx) => {
    leaderboard += `${idx + 1}. ${data.username}: ${data.points} Punkte\n`;
  });
  ctx.reply(leaderboard, { parse_mode: 'Markdown' });
});

bot.command('restartgame', (ctx) => {
  const chatId = ctx.chat.id;
  const game = ensureGame(chatId);

  if (ADMIN_ID && ctx.from.id.toString() !== ADMIN_ID.toString()) {
    ctx.reply("Nur der Admin darf das Spiel neu starten.");
    return;
  }

  game.roundActive = false;
  game.currentWord = null;
  game.currentParsedGer = null;
  game.firstGuesser = null;
  game.sentenceSubmissions = {};
  game.aufgabeClaimed = {};
  game.wordIndex = 0;

  ctx.reply(
    "Das Spiel wurde komplett neu gestartet! Die Punkte bleiben jedoch bestehen.\n" +
    "Starte eine neue Runde mit /startgame."
  );
});

// Auto-Modus für ALLE Gruppen
bot.command('auto_on', (ctx) => {
  if (ADMIN_ID && ctx.from.id.toString() !== ADMIN_ID.toString()) {
    ctx.reply("Nur der Admin darf den automatischen Modus einschalten.");
    return;
  }

  if (autoMode) {
    ctx.reply("Der automatische Modus ist bereits aktiviert!");
    return;
  }

  startAutoMode();
  ctx.reply("Okay, ich starte jetzt alle 60 Minuten automatisch eine neue Runde in allen Gruppen (wenn keine läuft).");
});

bot.command('auto_off', (ctx) => {
  if (ADMIN_ID && ctx.from.id.toString() !== ADMIN_ID.toString()) {
    ctx.reply("Nur der Admin darf den automatischen Modus ausschalten.");
    return;
  }

  if (!autoMode) {
    ctx.reply("Der automatische Modus ist momentan nicht aktiv.");
    return;
  }

  stopAutoMode();
  ctx.reply("Alles klar, kein automatisches Starten mehr!");
});

////////////////////////////////////////////////////////////
// on('text') – Kernlogik pro Gruppe
////////////////////////////////////////////////////////////

bot.on('text', (ctx) => {
  const chatId = ctx.chat.id;
  const game = ensureGame(chatId);
  
  if (!game.roundActive) return; // Kein aktives Spiel in dieser Gruppe

  const text = ctx.message.text.trim();
  const userId = ctx.from.id;
  const username = ctx.from.first_name || "Unbekannt";

  // 1) /Aufgabe+
  if (text === "Aufgabe+") {
    if (!game.aufgabeClaimed[userId]) {
      updateUserPoints(userId, username, 3);
      game.aufgabeClaimed[userId] = true;
      ctx.reply(`Perfekt, ${username}! Du bekommst +3 Punkte für Aufgabe+. 🔥`);
    }
    return;
  }

  // 2) Wort erraten?
  if (!game.firstGuesser) {
    // Noch keiner hat es erraten
    let userGuess = text.toLowerCase();

    if (game.currentParsedGer?.hasArticle) {
      const expected = (game.currentParsedGer.article + " " + game.currentParsedGer.root).toLowerCase();
      if (userGuess === expected) {
        // Richtig erraten
        game.firstGuesser = { userId, username };
        updateUserPoints(userId, username, 1);
        ctx.reply(`Sehr gut, ${username}! Du warst der Erste und bekommst +1 Punkt.`);
        return;
      } else {
        ctx.reply("Fast! Bist du sicher, dass du den Artikel richtig hast (der, die, das)?");
        return;
      }
    } else {
      // Kein Artikel
      const rootLower = (game.currentParsedGer?.root || "").toLowerCase();
      if (userGuess === rootLower) {
        game.firstGuesser = { userId, username };
        updateUserPoints(userId, username, 1);
        ctx.reply(`Sehr gut, ${username}! Du warst der Erste und bekommst +1 Punkt.`);
        return;
      } else {
        ctx.reply("Fast! Hast du das Wort richtig geschrieben?");
        return;
      }
    }
  } else {
    // firstGuesser != null => Wort schon erraten
    let userGuess = text.toLowerCase();
    let expected;
    if (game.currentParsedGer?.hasArticle) {
      expected = (game.currentParsedGer.article + " " + game.currentParsedGer.root).toLowerCase();
    } else {
      expected = (game.currentParsedGer?.root || "").toLowerCase();
    }
    if (userGuess === expected) {
      // Jemand versucht das Wort nochmal exakt zu erraten -> zu spät
      ctx.reply(`Leider zu spät, ${game.firstGuesser.username} war schneller! 😉`);
      return;
    }
  }

  // 3) Vorschlag eines Satzes (mind. 5 Wörter, enthält root)
  if (game.sentenceSubmissions[userId]) {
    // User hat schon ein Satz gegeben
    return;
  }

  const wordsInMessage = text.split(/\s+/).filter(w => w.length > 0);
  if (wordsInMessage.length < 5) {
    ctx.reply("Dein Satz ist leider zu kurz... Bitte mindestens 5 Wörter verwenden!");
    return;
  }

  const userSentenceLower = text.toLowerCase();
  const rootLower = (game.currentParsedGer?.root || "").toLowerCase();
  if (!userSentenceLower.includes(rootLower)) {
    ctx.reply("Fast! Hast du das Wort richtig geschrieben?");
    return;
  }

  // Satz passt -> +2
  game.sentenceSubmissions[userId] = true;
  updateUserPoints(userId, username, 2);
  ctx.reply(`Sehr gut, ${username}! Du erhältst +2 Punkte.`);
});

////////////////////////////////////////////////////////////
// Bot starten
////////////////////////////////////////////////////////////

bot.launch();
console.log("Bot gestartet...");

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
