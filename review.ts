import { ToolLoopAgent, Output, stepCountIs } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import pc from 'picocolors';
import {
  REVIEW_SCHEMA,
  SYSTEM_PROMPT,
  type Review,
} from './common/review-schema.ts';

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.6';

/** Wszystkie logi idą na stderr — stdout zostaje czysty (sam JSON do pipe'a). */
const err = (msg: string) => process.stderr.write(msg + '\n');

/** Wczytuje .env jeśli istnieje (Node 22+). Zmienne z otoczenia mają pierwszeństwo. */
function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* brak .env — polegamy na zmiennych środowiskowych */
  }
}

/** Prosty parser: --model <id> (np. --model openai/gpt-5-mini). */
function parseModel(argv: string[]): string {
  const i = argv.indexOf('--model');
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  return DEFAULT_MODEL;
}

/** Asynchroniczne wczytanie całego stdin (git diff). */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** Koloruje ocenę 1–10: >=8 zielony, 5–7 żółty, <5 czerwony. */
function colorScore(n: number): string {
  const label = `${n}/10`;
  if (n >= 8) return pc.green(label);
  if (n >= 5) return pc.yellow(label);
  return pc.red(label);
}

/** Markdownowa tabela z ocenami — drukowana na stderr jako podsumowanie dla człowieka. */
function renderSummary(review: Review): void {
  const rows: Array<[string, number]> = [
    ['Poprawność implementacji', review.implementationCorrectness],
    ['Idiomatyczność', review.idiomaticity],
    ['Prostota (odwr. złożoność)', review.complexity],
    ['Testy / ryzyko', review.testRiskCoverage],
    ['Bezpieczeństwo', review.securitySafety],
  ];

  err('');
  err(pc.bold('## Code Review — podsumowanie'));
  err('');
  err('| Kryterium | Ocena |');
  err('| --- | --- |');
  for (const [name, n] of rows) err(`| ${name} | ${colorScore(n)} |`);
  err('');

  const verdict =
    review.verdict === 'pass'
      ? pc.bgGreen(pc.black(' PASS '))
      : pc.bgRed(pc.white(' FAIL '));
  err(`**Werdykt:** ${verdict}`);
  err('');
  err(pc.bold('### Szczegóły'));
  err(review.summary);
  err('');
}

/** Telemetria kosztów/tokenów na podstawie wyniku generate(). */
function renderTelemetry(usage: any, providerMetadata: any): void {
  const inTok = usage?.inputTokens ?? '?';
  const outTok = usage?.outputTokens ?? '?';
  const total = usage?.totalTokens ?? '?';
  err(
    pc.dim(
      `telemetria · tokens: ${inTok} in / ${outTok} out / ${total} total`,
    ),
  );

  const orUsage = providerMetadata?.openrouter?.usage;
  if (orUsage?.cost != null) {
    err(pc.dim(`telemetria · koszt OpenRouter: $${orUsage.cost}`));
  } else {
    err(pc.dim('telemetria · koszt: brak danych (OpenRouter nie zwrócił usage.cost)'));
  }
}

async function main(): Promise<void> {
  loadDotEnv();

  if (!process.env.OPENROUTER_API_KEY) {
    err(pc.red('Błąd: brak OPENROUTER_API_KEY. Skopiuj .env.example do .env i uzupełnij klucz.'));
    process.exit(1);
  }

  const modelId = parseModel(process.argv.slice(2));
  const diff = await readStdin();

  if (!diff.trim()) {
    err(pc.red('Błąd: brak diffa na stdin. Użyj: git diff | npx tsx review.ts'));
    process.exit(1);
  }

  err(pc.cyan(`Model: ${modelId}`));
  err(pc.dim(`Rozmiar diffa: ${diff.length} znaków`));

  const openrouter = createOpenRouter();
  // usage.include = true → OpenRouter dołącza usage accounting (m.in. koszt)
  // do providerMetadata.openrouter.usage.
  const model = openrouter(modelId, { usage: { include: true } });

  let step = 0;
  const agent = new ToolLoopAgent({
    model,
    instructions: SYSTEM_PROMPT,
    output: Output.object({ schema: REVIEW_SCHEMA }),
    // +1 krok ponad właściwą pracę, bo generowanie strukturalnego outputu to osobny step.
    stopWhen: stepCountIs(2),
    onStepFinish({ usage, finishReason }) {
      step += 1;
      const inTok = usage?.inputTokens ?? '?';
      const outTok = usage?.outputTokens ?? '?';
      err(pc.dim(`krok ${step}: ${inTok} tokens in / ${outTok} tokens out · finishReason=${finishReason}`));
    },
  });

  const result = await agent.generate({ prompt: diff });
  const review = result.output as Review;

  // Podsumowanie + telemetria → stderr (dla człowieka).
  renderSummary(review);
  renderTelemetry(result.totalUsage, result.providerMetadata);

  // Czysty JSON → stdout (do dalszego pipe'a / CI).
  // Czekamy na flush callbacka — przy zapisie do pipe'a/pliku (non-TTY) write jest
  // asynchroniczny, a process.exit() nie czeka na opróżnienie bufora → ucięty JSON.
  await new Promise<void>((resolve) =>
    process.stdout.write(JSON.stringify(review, null, 2) + '\n', () => resolve()),
  );

  // Exit code zgodny z werdyktem — przydatne w CI (M5L3).
  process.exit(review.verdict === 'pass' ? 0 : 1);
}

main().catch((e) => {
  err(pc.red(`Błąd agenta: ${e instanceof Error ? e.message : String(e)}`));
  process.exit(2);
});
