# Code Review Agent — Comparison Report: 3 Models × 2 Diffs

## 1. Eksperyment

Przetestowano trzy modele LLM — **Sonnet 4.6**, **Haiku 4.5**, **GPT-5-mini** — na dwóch realnych diffach z głównego repo backendu (PHP 8.1 / Symfony 6.3, marketplace cyfrowych kluczy do gier). Cel: wybrać optymalny model i politykę kosztową dla pipeline'u CI (M5L3). Każdy model uruchamiany przez identyczną rubrykę oceny w `review.ts` za pomocą flagi `--model`. **Small diff** ([TICKET-A], 1 563 znaki): bugfix filtrowania SQL w [ServiceClass] dla [business feature A]. **Medium diff** ([TICKET-B], 9 637 znaków): dodanie atrybutu [business feature B] — nowa migracja Doctrine, stała w [Entity].php, JMS Serializer w [CartCalcModel], DI do [CartCalcBuilder], zmiany w [Builder].php.

---

## 2. Wyniki

### Tabela A — 6 przeglądów

| Model | Diff | Verdict | Tokens Out | Cost (USD) |
|-------|------|---------|-----------|------------|
| Sonnet 4.6 | small | **PASS** | 836 | $0.019 |
| Haiku 4.5 | small | **FAIL** | 1 720 | $0.011 |
| GPT-5-mini | small | **PASS** | 2 149 | $0.0044 |
| Sonnet 4.6 | medium | **FAIL** | 1 305 | $0.033 |
| Haiku 4.5 | medium | **PASS** | 2 240 | $0.016 |
| GPT-5-mini | medium | **FAIL** | 3 344 | $0.0075 |

*Tokens In nie były rejestrowane w output pliku; koszt całkowity obejmuje input + output.*

### Tabela B — Skalowanie kosztu (diff 6× większy)

| Model | Cost small | Cost medium | Wzrost |
|-------|-----------|-------------|--------|
| Sonnet 4.6 | $0.019 | $0.033 | ×1.74 |
| Haiku 4.5 | $0.011 | $0.016 | ×1.45 |
| GPT-5-mini | $0.0044 | $0.0075 | ×1.70 |

---

## 3. Werdykty się rozjechały ⚡

### Krzyżowa tabela werdyktów

| Diff | Sonnet 4.6 | Haiku 4.5 | GPT-5-mini |
|------|-----------|-----------|-----------|
| Small ([TICKET-A]) | PASS | **FAIL** | PASS |
| Medium ([TICKET-B]) | **FAIL** | PASS | **FAIL** |

**Small diff**: Haiku był jedynym modelem, który wystawił FAIL — jako krytyczny powód podał brak testów integracyjnych dla ścieżki biznesowej i potencjalny edge case z NULL `[mode_column]`:

> *„Zmiana modyfikuje kwerendę SQL dotyczącą «najniższych ofert» — jeden z krytycznych mechanizmów biznesowych marketplace'u. Ryzyka: Regresja: istniejące API mogą zwracać różne oferty niż wcześniej. Dane: czy oferty z `[mode_column]` NULL/nie-null są prawidłowo obsługiwane?"* — Haiku, small diff

**Medium diff**: role się odwróciły — Haiku wydał PASS, Sonnet i GPT wystawiły FAIL. Sonnet podniósł jako BLOCKER brak gettera w [CartCalcModel]:

> *„Brak getter'a `get[BusinessFeatureB]()` w [CartCalcModel]. JMS Serializer przy konfiguracji opartej na adnotacjach/atrybutach domyślnie korzysta z metody `getXxx()`. Brak gettera to regresja widoczna w runtime."* — Sonnet 4.6, medium diff

**Wniosek**: polityka „strict vs lenient" nie jest stałą cechą modelu — zależy od typu zmiany i tego, które ryzyko model uzna za dominujące. Strategia „use one model" jest naiwna. Multi-model strategy ma merytoryczne uzasadnienie.

---

## 4. Unikalne obserwacje — co każdy model wniósł indywidualnie

### Sonnet 4.6

**Getter jako runtime BLOCKER** (medium diff) — finding współdzielony, ale klasyfikacja unikalna:
> *„W całym modelu pozostałe pola mają gettery. Brak gettera to regresja widoczna w runtime."*

Haiku sklasyfikował ten sam brak jako priorytet *Niska*; GPT stwierdził wprost: *„Brak getter nie jest wymagany dla JMS."* Trzy sprzeczne werdykty na jeden fakt techniczny — Sonnet okazał się tu najbardziej konserwatywny.

### Haiku 4.5

**Format tabelaryczny** (medium diff) — jedyny model, który podał tabelę `| Problem | Linia | Ważność | Rekomendacja |`, co znacznie ułatwiło triage wyników.

**Unikalna obserwacja dotycząca serializacji** (medium diff) — wprost sprzeczna z Sonnet:
> *„Nie ma gettera, ale JMS Serializer domyślnie wykorzystuje dostęp do właściwości przez refleksję (zgodne z resztą codebase), więc serializacja powinna działać."*

**Ryzyko IDOR** (medium diff) — nie wspomniane przez pozostałe modele:
> *„Jeśli [FinderService] nie waliduje prawa dostępu do produktu, może dojść do IDOR; ale w kontekście koszyka, gdzie oferta już istnieje w sesji, ryzyko zminimalizowane."*

### GPT-5-mini

**Ryzyko konfliktu hardkodowanych ID w legacy DB** (medium diff) — jako jedyny model podniósł to jako BLOCKER:
> *„Migracja wstawia konkretne id (52 i 141). W starej, ~10-letniej bazie może już istnieć rekord z tymi ID → migracja rzuci błąd UNIQUE/PK lub nadpisze coś, co nie powinna."*

Obserwacja niedostępna w pozostałych przeglądach — GPT-5-mini jako jedyny połączył kontekst ~10-letniego legacy z ryzykiem konkretnych numerów ID i zaproponował `IF NOT EXISTS` jako zabezpieczenie.

**Weryfikacja importu klasy** (small diff) — jedyny model, który sprawdził use statement:
> *„Upewnij się, że klasa jest poprawnie zaimportowana (`use ...`), w przeciwnym razie może to skutkować błędem niezdefiniowanej klasy w tym namespace."*

---

## 5. Wspólne obserwacje — co wszystkie 3 modele wyłapały

### Small diff
- **PDO type binding**: brak jawnej deklaracji typów dla nowych parametrów ([CONST_A], [CONST_B]) w tablicy `$types` — każdy model wskazał ten problem, choć z różnym priorytetem
- **Brak testów**: żaden model nie zaakceptował braku pokrycia testowego dla krytycznej ścieżki cenowej [business feature A]

### Medium diff
- **N+1 w `prepare[BusinessFeatureB]()`**: wszystkie 3 modele niezależnie zidentyfikowały ten sam wzorzec — metoda wywoływana w pętli `array_map` po elementach koszyka może generować zapytanie SQL per element, jeśli [FinderService] nie cachuje wyników
- **Brak testów**: nowa metoda dotyka kalkulatora koszyka i nie ma pokrycia jednostkowego

---

## 6. Skalowanie kosztu

Diff 6× większy (1 563 → 9 637 znaków) kosztuje tylko **1.45–1.74×** więcej. System prompt + rubryki stanowią dominujący, stały koszt wejściowy — diff jest relatywnie małą częścią całkowitego inputu. To bardzo korzystne dla CI economics.

**Skalowanie miesięczne** (mix small/medium MR, ~100 MR/mies., 16 dev):

| Strategia | Avg cost/MR | Koszt/mies. | Koszt/rok |
|-----------|------------|-------------|-----------|
| Sonnet 4.6 | ~$0.026 | ~$2.5 | ~$30 |
| Haiku 4.5 | ~$0.013 | ~$1.3 | ~$16 |
| GPT-5-mini | ~$0.006 | ~$0.6 | ~$7 |
| Multi-model (×3 równolegle) | ~$0.045 | ~$4.5 | ~$54 |

Nawet strategia multi-model zamknęłaby się w budżecie kawowym (~$54/rok).

---

## 7. Rekomendacja strategiczna dla M5L3

### Opcja A — Sonnet 4.6 jako default (~$2.5/mies.)
Najlepszy balans jakości i kontekstu. Subtelne uwagi (getter jako runtime regresja, spójność $types) mogą zapobiec błędom niewidocznym w code review ludzkim. Rekomendowany gdy jakość review jest priorytetem.

### Opcja B — GPT-5-mini jako default (~$0.6/mies.)
Zaskakująco wysoka jakość przy najniższym koszcie — $0.0044–$0.0075/MR. Unikalna obserwacja o ryzyku ID w legacy DB pokazuje, że model łączy kontekst techniczny z historią projektu. Rekomendowany gdy budżet jest napięty lub jako tańszy screening layer.

### Opcja C — Multi-model strategy (~$4.5/mies.) ← preferowana
Uruchom 3 modele równolegle, scal unikalne uwagi. **Uzasadnienie**: rozjazd werdyktów na medium diff pokazuje, że żaden model nie jest w pełni niezawodny — każdy ma systematyczne blind spots. Implementacja: `Promise.all([reviewSonnet, reviewHaiku, reviewGPT])` → deduplicate findings → synthesized verdict. Przy $54/rok koszt jest znikomy względem wartości dodanej.

**Decyzja implementacyjna pozostaje na M5L3.**

---

## 8. Otwarte pytania / nieprzetestowane

- **Duże diffy (30K+ znaków)**: np. refactor kluczowego serwisu — czy modele zachowują koherencję? Czy koszt nadal rośnie subliniowo?
- **Multi-language MR (PHP + TypeScript)**: czy modele poprawnie rozdzielają kontekst między językami?
- **Stabilność werdyktów**: temperatura = 0 nie gwarantuje pełnej deterministyczności przy długich outputach — czy te werdykty są reproduktywne?
- **Threshold tuning**: aktualna rubrika daje rozbieżne werdykty — kalibracja progów (blocking vs warning) może poprawić agreement między modelami.

Powyższe to potencjalne eksperymenty dla M5L4+.
