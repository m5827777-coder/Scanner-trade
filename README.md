# 🤖 Autonomous Paper Trading Bot

Работает через **GitHub Actions** — без компьютера, 24/7, каждые 15 минут.

---

## ⚡ Быстрый старт (5 шагов)

### 1. Создать репозиторий на GitHub
Новый репо → загрузить все файлы из этого архива.

### 2. Добавить один Secret для email (Settings → Secrets → Actions)

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

## Что уже настроено (не нужно менять)

- **Telegram Token:** `8656633074:AAF_wY9b4iENW6HJ0HvZE2Ir-YHmmdCl16Y`
- **Telegram Chat ID:** `73400175`
- **Email:** `m5827777@gmail.com`
- **Размер позиции:** $100/сделка (paper trading)
- **Мин. удержание:** 0 (торгует мгновенно)
- **Cooldown:** 60 минут per токен+стратегия

---

## Расписание

| Когда | Что делает |
|-------|-----------|
| Каждые 15 мин | Сканирует 40 токенов, входит/выходит |
| Каждые 6 часов | Отправляет email отчёт на m5827777@gmail.com |

---

## Ручные действия (Actions → Run workflow)

| Действие | Что делает |
|----------|-----------|
| `scan` | Принудительный скан + торговля |
| `report` | Отправить email отчёт прямо сейчас |
| `close_all` | Закрыть все открытые позиции |
| `reset_state` | Сбросить всю статистику |

---

## 7 Стратегий

| # | Стратегия | TP | SL | Лучший режим |
|---|-----------|----|----|-------------|
| S1 | RSI Bounce | +20% | -8% | BULL_TREND, RANGE |
| S3 | Buyback Dip | +18% | -10% | BULL_TREND, BULL |
| S5 | Volume Spike | +15% | -8% | BULL_TREND, BULL |
| S6 | Funding Contrarian | +25% | -6% | BULL, BULL_TREND |
| S7 | EMA Cross 9/21 | +30% | -8% | BULL_TREND, BULL |
| S8 | MACD Divergence | +35% | -9% | BULL, RANGE |
| S9 | BB Squeeze | +22% | -7% | RANGE, BULL |

---

*Not Financial Advice. Paper Trading only.*
