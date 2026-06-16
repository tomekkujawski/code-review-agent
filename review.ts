import { ToolLoopAgent, Output, stepCountIs, tool } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { readFileSync, existsSync } from 'node:fs';
import pc from 'picocolors';
import { z } from 'zod';
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

const readPRContext = tool({
  description:
    'Read the pull request context: title, body, and list of changed files. Use this when the diff alone is not enough to understand the intent of the change. Returns null fields if not running in a PR context (e.g., local manual run).',
  inputSchema: z.object({}),
  execute: async () => {
    const title = process.env.PR_TITLE ?? null;
    const body = process.env.PR_BODY ?? null;
    const filesRaw = process.env.PR_FILES ?? '';
    let files: string[] = [];
    if (filesRaw) {
      try {
        files = JSON.parse(filesRaw);
      } catch {
        files = filesRaw.split(/[,\n]/).map((f) => f.trim()).filter(Boolean);
      }
    }
    return { title, body, files };
  },
});

const readPHPFile = tool({
  description:
    "Read a PHP file from the project repository for additional context. Use sparingly — only when the diff references something whose definition or usage you need to verify (e.g., entity property type, voter logic, service injection). Provide path relative to repo root, e.g., 'src/Entity/Order.php'.",
  inputSchema: z.object({
    relativePath: z
      .string()
      .describe("Path relative to repository root, e.g., 'src/Entity/Order.php'"),
  }),
  execute: async ({ relativePath }) => {
    if (relativePath.includes('..')) {
      return { error: 'Path traversal not allowed.' };
    }
    if (!relativePath.startsWith('src/')) {
      return { error: "Path must start with 'src/'." };
    }
    if (!existsSync(relativePath)) {
      return { error: `File not found: ${relativePath}` };
    }
    const content = readFileSync(relativePath, 'utf8');
    if (content.length > 50_000) {
      return { error: 'File too large for context (>50K chars). Read targeted excerpt manually.' };
    }
    return { content, lines: content.split('\n').length, size: content.length };
  },
});

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
    tools: { readPRContext, readPHPFile },
    // Więcej kroków: agent może wywołać readPRContext/readPHPFile przed właściwą oceną.
    stopWhen: stepCountIs(5),
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
