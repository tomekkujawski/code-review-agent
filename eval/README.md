# Code Review Agent — Eval Suite (M5L3)

## Uruchomienie

```bash
# z katalogu głównego repozytorium (promptfoo czyta .env z cwd)
npm run eval
```

Opcjonalnie z raportem HTML:

```bash
npm run eval -- --output eval/report.html
```

## Fixtures

| Plik | Typ pułapki | Oczekiwany werdykt |
|---|---|---|
| `01-sql-injection.diff` | SQL injection (konkatenacja parametrów) | `fail`, `securitySafety <= 3` |
| `02-missing-voter.diff` | Brak `#[IsGranted]` / Voter na endpointach | `fail`, `securitySafety <= 5` |
| `03-jms-groups-leak.diff` | Pola JMS bez `#[Groups]` — wyciek tokenu | `securitySafety <= 6` |
| `04-trivial-change.diff` | Kontrolny pozytywny (stock + null-safe show) | `pass` |

## Czytanie wyników

`PASS` przy asercji = model zachowuje się zgodnie z oczekiwaniem. Interesuje Cię głównie kolumna `pass rate` per model i per asercja. Jeśli model nie wykrywa podatności (assert `javascript` lub `llm-rubric` = FAIL), to sygnał regresji.

Wyniki tekstowe w terminalu; HTML report (`--output`) daje tabelę z pełnymi odpowiedziami.

## Ważne

- Uruchamiaj **z katalogu głównego repozytorium** — `promptfoo` czyta `.env` z bieżącego katalogu.
- Ścieżki w `promptfooconfig.yaml` (`file://fixtures/...`) są względne względem katalogu konfigu (`eval/`).
- Plik `eval/report.html` jest gitignorowany — nie commituj go do repo.
