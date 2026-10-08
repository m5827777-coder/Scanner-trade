# 🤖 Autonomous Paper Trading Bot

Работает через **GitHub Actions** — без компьютера, 24/7, каждые 30 минут.

---

## ⚡ Быстрый старт (5 шагов)

### 1. Создать репозиторий на GitHub
Новый репо → загрузить все файлы из этого архива.

### 2. Добавить секреты для email (Settings → Secrets → Actions)

| Secret | Значение |
|--------|----------|
| `GMAIL_USER` | ваш gmail аккаунт для отправки (напр. yourbot@gmail.com) |
| `GMAIL_APP_PASS` | App Password (не обычный пароль!) |

> **Как создать App Password:**
> Google Account → Security → 2-Step Verification → App passwords → Create → "Mail" + "Other device" → Copy 16-значный код

### 3. Включить GitHub Actions
Actions → "I understand my workflows, enable them"

### 4. Включить GitHub Pages (для дашборда)
Settings → Pages → Source: Branch `main` → Folder `/dashboard` → Save

### 5. Первый запуск
Actions → "🤖 Trading Bot" → "Run workflow" → action: `scan`

---

## Секреты (Settings → Secrets → Actions)

| Secret | Значение |
|--------|----------|
| `TG_TOKEN` | токен Telegram-бота от @BotFather |
| `TG_CHAT_ID` | chat ID, куда слать сигналы |
| `EMAIL_TO` | адрес для 6-часового отчёта |
| `GMAIL_USER`, `GMAIL_APP_PASS` | отправитель отчёта |

Токены и ID храните только в секретах, не в файлах репозитория.

- **Размер позиции:** $100/сделка (paper trading)
- **Cooldown:** 120 минут per токен+стратегия, 24 часа после стоп-лосса

---

## Расписание

| Когда | Что делает |
|-------|-----------|
| Каждые 30 мин | Сканирует топ-100 CoinGecko, входит/выходит |
| Раз в 6 часов | Отправляет email отчёт (из обычного скана) |

GitHub может запускать cron реже, чем указано. SL/TP проверяются по high/low дневной свечи с прошлого скана, поэтому редкие запуски не дают проскальзывания стопов.

---

## Ручные действия (Actions → Run workflow)

| Действие | Что делает |
|----------|-----------|
| `scan` | Принудительный скан + торговля |
| `report` | Отправить email отчёт прямо сейчас |
| `close_all` | Закрыть все открытые позиции |
| `reset_state` | Сбросить всю статистику |

---

## Стратегии (v8)

Активные стратегии задаются в `bot/params.json` → `global.strategies`.

| ID | Стратегия | TP | SL | Фильтры |
|----|-----------|----|----|---------|
| sE | EMA Cross 9/21 | +15% | -6% | BTC в BULL / BULL_TREND, RSI 55–75 |
| sM | Momentum Breakout (пробой 20d max) | +25% | -7% | топ-20 по капитализации, трейлинг 6% от пика |
| sR | Altcoin Rotation (выключена) | +12% | -5% | BTC Dom ≤ 59% |

Общие выходы для всех позиций:
- безубыток: после пика +8% выходим, если цена откатила до +0.5%;
- тайм-стоп: через 14 дней, если позиция не дала +5%.

---

*Not Financial Advice. Paper Trading only.*
