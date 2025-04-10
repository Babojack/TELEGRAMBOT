import asyncio
import random
import re
from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
from dotenv import load_dotenv
import os

load_dotenv()
API_TOKEN = os.getenv("BOT_TOKEN")


GROUP_ID = -1002322472598

bot = Bot(token=API_TOKEN)
dp = Dispatcher()

# Список слов (пример)
words = [
   {
        "ru": "дом",
        "de": "das Haus",
        "desc": (
            "Ein Gebäude, in dem Menschen wohnen. "
            "Es hat Fenster, Türen und oft einen Garten. "
            "Man schläft, isst und lebt dort. "
            "Es schützt vor Regen und Kälte. "
            "Kinder spielen im Hof oder im Zimmer."
        )
    },
    {
        "ru": "книга",
        "de": "das Buch",
        "desc": (
            "Etwas zum Lesen, oft mit vielen Seiten. "
            "Man kann Geschichten, Informationen oder Märchen finden. "
            "Sie ist aus Papier und hat einen Titel. "
            "Man liest sie in der Schule oder zu Hause. "
            "Sie hilft beim Lernen oder zur Unterhaltung."
        )
    },
    {
        "ru": "собака",
        "de": "der Hund",
        "desc": (
            "Ein Tier, das oft ein Haustier ist. "
            "Es bellt und wedelt mit dem Schwanz. "
            "Viele Menschen gehen mit ihm spazieren. "
            "Er kann freundlich und verspielt sein. "
            "Ein guter Freund des Menschen."
        )
    },
    {
        "ru": "молоко",
        "de": "die Milch",
        "desc": (
            "Ein weißes Getränk, kommt von der Kuh. "
            "Man trinkt es zum Frühstück oder mit Kaffee. "
            "Es ist gesund und hat Kalzium. "
            "Kinder trinken es oft. "
            "Man kann Käse und Joghurt daraus machen."
        )
    },
    {
        "ru": "река",
        "de": "der Fluss",
        "desc": (
            "Ein langes Wasser, das durch Städte und Natur fließt. "
            "Schiffe fahren darauf. "
            "Man sieht oft Fische oder Enten darin. "
            "Er kann langsam oder schnell sein. "
            "Berühmte Beispiele sind Rhein oder Donau."
        )
    },
    {
        "ru": "школа",
        "de": "die Schule",
        "desc": (
            "Ein Ort, wo Kinder und Jugendliche lernen. "
            "Es gibt Lehrer und Klassenzimmer. "
            "Man lernt Mathematik, Sprachen und andere Fächer. "
            "Man hat Pausen und Hausaufgaben. "
            "Freunde trifft man dort auch."
        )
    },
    {
        "ru": "чай",
        "de": "der Tee",
        "desc": (
            "Ein heißes Getränk aus Kräutern oder Blättern. "
            "Man trinkt es bei Krankheit oder zur Entspannung. "
            "Es gibt ihn mit Zitrone, Zucker oder Milch. "
            "Grün, schwarz oder Kräuter – viele Sorten. "
            "In vielen Ländern ist es ein beliebtes Getränk."
        )
    },
    {
        "ru": "компьютер",
        "de": "der Computer",
        "desc": (
            "Ein Gerät zum Arbeiten, Spielen oder Surfen im Internet. "
            "Man benutzt Tastatur und Maus. "
            "Er steht oft auf dem Tisch. "
            "Man schreibt E-Mails oder sieht Filme damit. "
            "Wichtig im Büro und zu Hause."
        )
    },
    {
        "ru": "город",
        "de": "die Stadt",
        "desc": (
            "Ein großer Ort mit vielen Häusern und Menschen. "
            "Es gibt Straßen, Geschäfte und Busse. "
            "Man kann einkaufen, arbeiten oder ins Kino gehen. "
            "Beispiele: Berlin, Hamburg, München. "
            "In der Stadt ist oft viel los."
        )
    },
    {
        "ru": "работа",
        "de": "die Arbeit",
        "desc": (
            "Etwas, was Erwachsene jeden Tag machen. "
            "Man verdient Geld damit. "
            "Man geht ins Büro, in die Fabrik oder ins Geschäft. "
            "Manche Menschen arbeiten zu Hause. "
            "Man hat Aufgaben, Kollegen und Pausen."
        )
    }
]

# ======= Глобальные переменные =======
current_round = None
translation_done = False
translation_winner = None
explanation_users = set()
scores = {}         # <-- храним накопленные баллы
user_names = {}

auto_mode = False
auto_task = None

# ======= Вспомогательные функции =======
def check_description(user_msg: str, correct_desc: str) -> bool:
    user_words = set(re.findall(r'\w+', user_msg.lower()))
    correct_words = set(re.findall(r'\w+', correct_desc.lower()))
    common = user_words.intersection(correct_words)
    return len(common) >= 3

async def is_user_admin(chat_id: int, user_id: int) -> bool:
    """
    Проверяем, является ли пользователь админом или создателем чата.
    """
    member = await bot.get_chat_member(chat_id, user_id)
    return (member.status in ("administrator", "creator"))

async def send_new_round(auto: bool = False):
    """
    Запускаем новый раунд. Баллы НЕ сбрасываем!
    """
    global current_round, translation_done, translation_winner, explanation_users
    current_round = random.choice(words)
    translation_done = False
    translation_winner = None
    explanation_users.clear()

    prefix = "🔄 *Автоматический раунд!* \n" if auto else ""
    text = (
        f"{prefix}🔥 *НОВОЕ СЛОВО:* **{current_round['ru']}**\n\n"
        "Попробуй угадать перевод, объяснить слово или составить предложение!\n\n"
        "🏅 *Как заработать баллы?*\n"
        "1. Первый, кто правильно переведёт слово на немецкий, получает **+1** балл.\n"
        "2. Сообщение, начинающееся с `Erklärung:` (≥3 совпадений из описания) – **+1** балл.\n"
        "3. Сообщение, начинающееся с `Satz:` и содержащее немецкое слово, – **+2** балла.\n"
        "4. Сообщение, начинающееся с `Aufgabe+` если использовал слово 4 раза устно и 4 раза письменно – **+4** балла.\n\n"
        "🔧 *КОМАНДЫ, КОТОРЫЕ МОЖНО ИСПОЛЬЗОВАТЬ:*\n"
        "`/rules` – показать это сообщение с правилами\n"
        "`/score` – показать топ игроков\n\n"
        "Удачи! 💪"
    )
    await bot.send_message(GROUP_ID, text, parse_mode="Markdown")

async def auto_round_loop():
    while auto_mode:
        await send_new_round(auto=True)
        try:
            await asyncio.sleep(7200)  # Каждые 2 часа
        except asyncio.CancelledError:
            break

# ======= Команды =======
@dp.message(Command("play"))
async def cmd_play(message: types.Message):
    if message.chat.id != GROUP_ID:
        return
    if auto_mode:
        await message.reply("🔔 Авто-режим включён. Сначала отключите его /stop, чтобы вручную запустить раунд.")
        return
    await send_new_round(auto=False)

@dp.message(Command("auto"))
async def cmd_auto(message: types.Message):
    """
    Включить авто-режим (только для админа/создателя чата)
    """
    if message.chat.id != GROUP_ID:
        return

    # Проверяем, является ли пользователь админом
    if not await is_user_admin(message.chat.id, message.from_user.id):
        await message.reply("У вас нет прав администратора, чтобы включать авто-режим!")
        return

    global auto_mode, auto_task
    if auto_mode:
        await message.reply("🔔 Авто-режим уже включён.")
        return

    auto_mode = True
    auto_task = asyncio.create_task(auto_round_loop())
    await message.reply("🔄 Авто-режим включён! Теперь каждые 2 часа будет появляться новое слово.")

@dp.message(Command("stop"))
async def cmd_stop(message: types.Message):
    """
    Отключить авто-режим (только для админа/создателя чата)
    """
    if message.chat.id != GROUP_ID:
        return

    # Проверяем админские права
    if not await is_user_admin(message.chat.id, message.from_user.id):
        await message.reply("У вас нет прав администратора, чтобы отключать авто-режим!")
        return

    global auto_mode, auto_task
    if not auto_mode:
        await message.reply("Авто-режим не включён.")
        return

    auto_mode = False
    if auto_task:
        auto_task.cancel()
        auto_task = None

    await message.reply("✅ Авто-режим остановлен.")

@dp.message(Command("stopround"))
async def cmd_stopround(message: types.Message):
    if message.chat.id != GROUP_ID:
        return

    global current_round, translation_done, translation_winner, explanation_users
    if current_round is None:
        await message.reply("Сейчас нет активного раунда.")
        return

    ru_word = current_round["ru"]
    current_round = None
    translation_done = False
    translation_winner = None
    explanation_users.clear()
    await message.reply(f"🚫 Раунд со словом «{ru_word}» остановлен.")

@dp.message(Command("score"))
async def cmd_score(message: types.Message):
    if message.chat.id != GROUP_ID:
        return

    # Формируем таблицу лидеров
    if not scores:
        await message.reply("Пока никто не набрал очков.")
        return

    sorted_scores = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    text = "🏆 *Таблица лидеров:* 🏆\n\n"
    for user_id, pts in sorted_scores:
        name = user_names.get(user_id, "Unknown")
        text += f"• {name}: {pts} баллов\n"

    await message.reply(text, parse_mode="Markdown")

@dp.message(Command("rules"))
async def cmd_rules(message: types.Message):
    if message.chat.id != GROUP_ID:
        return

    text = (
      "📚 *ПРАВИЛА ИГРЫ — SPIELREGELN*\n\n"
      "Эта игра помогает учить немецкий! В каждом раунде тебе дают *одно слово на русском*.\n"
      "Твоя задача — сделать что-то с этим словом на немецком, чтобы заработать баллы.\n\n"

      "🔥 *ЧТО МОЖНО ДЕЛАТЬ?*\n"
      "1. Переведи слово на немецкий — кто первый, тот и получает +1 балл.\n"
      "2. Объясни это слово на немецком, начиная с `Erklärung:` (если ≥3 слов совпадают) → +1 балл.\n"
      "3. Составь предложение на немецком с этим словом (начинай сообщение с `Satz:`) → +2 балла.\n"
      "4. Используй слово 4 раза устно и 4 раза письменно, потом напиши `Aufgabe+` → +4 балла.\n\n"

      "Viel Erfolg!\n\n"
    )
    await message.reply(text, parse_mode="Markdown")

# ======= Ловим все остальные сообщения (логика начисления очков) =======
@dp.message()
async def handle_message(message: types.Message):
    global current_round, translation_done, translation_winner, explanation_users
    global scores, user_names

    if message.chat.id != GROUP_ID:
        return

    user_id = message.from_user.id
    user_names[user_id] = message.from_user.full_name

    text = message.text.strip()
    text_lower = text.lower()

    # Если нет активного раунда, ничего не делаем
    if current_round is None:
        return

    correct_de = current_round["de"].lower()

    # 1) Первый правильный перевод => +1
    if not translation_done and correct_de in text_lower:
        translation_done = True
        translation_winner = user_id
        scores[user_id] = scores.get(user_id, 0) + 1
        await message.reply(
            f"🎉 {user_names[user_id]} первым правильно перевёл слово «{current_round['ru']}» на «{current_round['de']}»! +1 балл!",
            parse_mode="Markdown"
        )
        return
    elif translation_done and correct_de in text_lower and user_id != translation_winner:
        # Кто-то перевёл, когда уже отгадано
        await message.reply(f"Zu Spät! {user_names[translation_winner]} уже отгадал перевод.")
        return

    # 2) Erklärung:
    if text_lower.startswith("erklärung:"):
        if user_id not in explanation_users:
            # Берём текст объяснения
            explanation_part = text_lower.split("erklärung:", 1)[1].strip()
            if check_description(explanation_part, current_round["desc"]):
                explanation_users.add(user_id)
                scores[user_id] = scores.get(user_id, 0) + 1
                await message.reply(
                    f"💡 {user_names[user_id]} дал(а) толковое объяснение! +1 балл!",
                    parse_mode="Markdown"
                )
        return

    # 3) Satz: => +2
    if text_lower.startswith("satz:"):
        if correct_de in text_lower:
            scores[user_id] = scores.get(user_id, 0) + 2
            await message.reply(
                f"✏️ {user_names[user_id]} составил(а) предложение (Satz) с «{current_round['de']}»! +2 балла!",
                parse_mode="Markdown"
            )
        return

    # 4) Aufgabe+ => +4
    if text_lower.startswith("aufgabe+"):
        if correct_de in text_lower:
            scores[user_id] = scores.get(user_id, 0) + 4
            await message.reply(
                f"🚀 {user_names[user_id]} выполнил(а) Aufgabe+! +4 балла!",
                parse_mode="Markdown"
            )
        return

    # Остальные сообщения не дают очков

# ======= Запуск бота =======
async def main():
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
