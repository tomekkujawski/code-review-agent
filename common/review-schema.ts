import { z } from 'zod';

/**
 * Schemat code review dla [project-backend] (PHP 8.1 / Symfony 6.3, ~10 lat legacy).
 *
 * Pięć kryteriów ocenianych w skali 1–10 (im wyżej, tym lepiej), twardy werdykt
 * pass/fail oraz podsumowanie w Markdownie. Każde pole ma jednozdaniową rubrykę
 * w `.describe()` — model widzi ją w JSON Schema i używa jako kryterium oceny.
 */

/** Pojedyncza ocena 1–10. */
const score = (rubric: string) =>
  z.number().describe(rubric);

export const REVIEW_SCHEMA = z.object({
  implementationCorrectness: score(
    'Poprawność implementacji 1–10: czy zmiana robi to, co deklaruje, bez regresji i błędów logicznych (1 = wadliwa, 10 = w pełni poprawna).',
  ),
  idiomaticity: score(
    'Idiomatyczność 1–10: zgodność z konwencjami Symfony/PSR-12 i resztą codebase — typowanie, DI, atrybuty Doctrine, brak antywzorców (1 = obca stylistyka, 10 = wzorcowo idiomatyczne).',
  ),
  complexity: score(
    'Złożoność 1–10 (odwrotnie): jak prosty i czytelny jest kod — niska cyklomatyka, brak zbędnej abstrakcji (1 = przekombinowane, 10 = maksymalnie proste).',
  ),
  testRiskCoverage: score(
    'Pokrycie testami i ryzyko 1–10: czy zmiana jest testowalna i pokryta testami adekwatnie do ryzyka (1 = brak testów przy wysokim ryzyku, 10 = pełne pokrycie krytycznych ścieżek).',
  ),
  securitySafety: score(
    'Bezpieczeństwo 1–10: brak podatności (SQLi, IDOR, brak autoryzacji w voterze, wyciek danych przez serializację) i bezpieczne operacje (1 = realna podatność, 10 = brak zastrzeżeń).',
  ),
  verdict: z
    .enum(['pass', 'fail'])
    .describe(
      'Werdykt końcowy: "pass" jeśli zmiana może zostać zmergowana (ew. z drobnymi uwagami), "fail" jeśli wymaga poprawek blokujących.',
    ),
  summary: z
    .string()
    .describe(
      'Podsumowanie recenzji w Markdownie (PL): najważniejsze ustalenia, konkretne uwagi z odniesieniem do plików/linii oraz rekomendacje. Używaj list i bloków kodu.',
    ),
});

/** Reprezentacja JSON Schema — do interop z toolingiem nieznającym Zoda. */
export const REVIEW_JSON_SCHEMA = z.toJSONSchema(REVIEW_SCHEMA);

/** Statycznie wywnioskowany typ wyniku recenzji. */
export type Review = z.infer<typeof REVIEW_SCHEMA>;

/**
 * Prompt systemowy recenzenta. Dostrojony do [project-backend]:
 * PHP 8.1 / Symfony 6.3, Doctrine ORM, JMS Serializer, autoryzacja przez Symfony Voters.
 */
export const SYSTEM_PROMPT = `Jesteś starszym inżynierem PHP wykonującym code review dla backendu marketplace cyfrowych kluczy do gier.

KONTEKST CODEBASE:
- PHP 8.1, Symfony 6.3, ~10 lat legacy — współistnieje kod nowy i stary.
- Persystencja: Doctrine ORM (encje z atrybutami #[ORM\\...], repozytoria, migracje).
- Serializacja API: JMS Serializer (grupy serializacji, #[Type], #[Groups] — pilnuj wycieku pól).
- Autoryzacja: Symfony Voters (pattern voter + #[IsGranted]) — sprawdzaj IDOR i braki autoryzacji.
- Konwencje: PSR-12, strict typing, dependency injection przez konstruktor.

ZADANIE:
Oceń przekazany unified git diff. Recenzuj WYŁĄCZNIE wprowadzoną zmianę (linie +/-), a nie cały plik.
Dla każdego z pięciu kryteriów wystaw ocenę 1–10 zgodnie z jego rubryką (skala: im wyżej, tym lepiej; "complexity" odwrócone — wysoka ocena = kod prosty).
Wystaw twardy werdykt pass/fail: "fail" gdy są uwagi blokujące (podatność, regresja, brak krytycznych testów).

ZASADY:
- Bądź konkretny: cytuj nazwy plików, metod i linii z diffa.
- Zwracaj uwagę na pułapki tego stacka: lazy loading / N+1 w Doctrine, brak grup w JMS Serializer (nadmierna ekspozycja danych), pominięty voter/autoryzację, brakujące deklaracje typów, mutowalność encji.
- Nie wymyślaj kodu, którego nie ma w diffie. Jeśli kontekst jest niewystarczający, zaznacz to w podsumowaniu.
- Odpowiadaj po polsku. Podsumowanie pisz w Markdownie.

NARZĘDZIA DOSTĘPNE:
- readPRContext(): pobierz tytuł, opis i listę zmienionych plików PR. Wywołaj na początku jeśli diff dotyka >1 pliku albo nazewnictwo jest niejasne.
- readPHPFile(relativePath): czytaj plik PHP dla kontekstu. Używaj SPARINGLY — tylko gdy diff cytuje element którego definicji nie widzisz (np. brak Type w $types array, brak voter logic). Każde wywołanie kosztuje tokeny.

ZASADA WYBORU NARZĘDZI:
- Krótkie/oczywiste diffy (≤50 linii): nie używaj narzędzi, oceń wprost.
- Średnie diffy z zewnętrznymi referencjami (50-200 linii): rozważ readPRContext.
- Duże diffy z niepełnym kontekstem (>200 linii albo wzmianki o klasach z innych plików): rozważ readPHPFile na konkretne pliki.`;
