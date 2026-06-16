# code-review-agent

AI code review agent dla **[project-backend]** (PHP 8.1 / Symfony 6.3): czyta `git diff` ze stdin i zwraca ustrukturyzowaną recenzję (5 ocen 1–10, werdykt pass/fail, podsumowanie w Markdownie).

Zbudowany na **Vercel AI SDK 6** (`ToolLoopAgent` + `Output.object`), domyślnie **Claude Sonnet 4.6** przez **OpenRouter**.

## Quickstart

```bash
# 1. Sklonuj i zainstaluj zależności
git clone <repo> && cd code-review-agent && npm install

# 2. Skonfiguruj klucz OpenRouter
cp .env.example .env   # następnie wpisz OPENROUTER_API_KEY

# 3. Uruchom na realnym diffie
git diff | npx tsx review.ts
```

Recenzja (logi + tabela) idzie na **stderr**, a czysty **JSON na stdout** — można pipe'ować dalej:

```bash
git diff | npx tsx review.ts > review.json
git diff origin/main...HEAD | npx tsx review.ts   # diff całej gałęzi
npx tsx review.ts < samples/sample-diff.patch     # przykładowy diff
```

Kod wyjścia: `0` = pass, `1` = fail, `2` = błąd agenta (przyda się w CI).

## Konfiguracja modeli

Domyślnie `anthropic/claude-sonnet-4.6`. Flaga `--model` przełącza dowolny model dostępny w OpenRouter:

```bash
git diff | npx tsx review.ts --model openai/gpt-5-mini
git diff | npx tsx review.ts --model google/gemini-2.5-pro
git diff | npx tsx review.ts --model anthropic/claude-opus-4.1
```

## Koszty (telemetria)

Agent loguje na stderr zużycie tokenów i koszt:

```
krok 1: 1820 tokens in / 64 tokens out · finishReason=tool-calls
krok 2: 1910 tokens in / 412 tokens out · finishReason=stop
telemetria · tokens: 3730 in / 476 out / 4206 total
telemetria · koszt OpenRouter: $0.0123
```

- **krok N** — `onStepFinish` per krok agenta (wejście/wyjście + finishReason).
- **telemetria · tokens** — `result.totalUsage` (suma po wszystkich krokach).
- **telemetria · koszt** — `result.providerMetadata.openrouter.usage.cost` (USD), gdy OpenRouter zwróci usage accounting (włączone przez `usage: { include: true }`). Część modeli/tras nie raportuje kosztu — wtedy zobaczysz „brak danych".

## Struktura

```
common/review-schema.ts   # REVIEW_SCHEMA (zod), REVIEW_JSON_SCHEMA, type Review, SYSTEM_PROMPT
review.ts                 # główny agent (stdin → recenzja)
samples/sample-diff.patch # przykładowy diff PHP/Symfony do smoke testu
```

## M5L3 TODO — integracja CI/CD

Kolejna lekcja. Plan:

- [ ] GitHub Action: odpalenie agenta na diffie PR (`git diff origin/${{ github.base_ref }}...HEAD`).
- [ ] Wykorzystanie kodu wyjścia (`fail` → blokada merge / status check).
- [ ] Publikacja `summary` jako komentarz PR (Markdown z `review.json`).
- [ ] Sekret `OPENROUTER_API_KEY` w GitHub Secrets.
- [ ] Budżet kosztów: próg alertu na podstawie telemetrii `usage.cost`.


## M5L3 Etap 3
Extended agent with readPRContext + readPHPFile tools.
