// Typen voor e2e-claude-seat.mjs, zodat een e2e.config.ts met `satisfies E2EConfig`
// en een directe `generateText({ model: claudeSeat(...) })` het model blijven
// controleren. Bewust structureel en zonder import van @ai-sdk/provider: dit
// bestand wordt gevendord en moet ook typechecken in een repo die dat pakket niet
// direct installeert. De vormen volgen LanguageModelV4 (@ai-sdk/provider 4.x,
// ai 7), beperkt tot wat deze provider echt teruggeeft.

export interface ClaudeSeatOptions {
  /** De claude-binary; anders CLAUDE_BIN, anders `claude` op PATH. */
  bin?: string;
  /** Basis-env voor het kind; alleen een allowlist gaat mee (PATH, HOME, taal, tijdelijke map, CLAUDE_CONFIG_DIR, CLAUDE_CODE_OAUTH_TOKEN). */
  env?: Record<string, string | undefined>;
  /** Werkmap van het kind; standaard een lege tijdelijke map (geen CLAUDE.md van de repo). */
  cwd?: string;
  /** Eén termijn per modelaanroep in ms, inclusief controle vooraf, nieuwe pogingen en wachten (standaard 180 000). */
  timeoutMs?: number;
  /** Alias van timeoutMs. */
  timeout?: number;
  /** Hoeveel schermafbeeldingen mee gaan; oudere worden een tekstregel (standaard 2). */
  keepImages?: number;
  /** Doorgegeven als `--effort`. */
  effort?: string;
  /** Wachttijden tussen pogingen bij een tijdelijke fout (standaard [2000, 6000]; maximaal 2). */
  retryDelaysMs?: number[];
}

type ClaudeSeatJSONValue = null | string | number | boolean | { readonly [key: string]: ClaudeSeatJSONValue | undefined } | readonly ClaudeSeatJSONValue[];
type ClaudeSeatJSONObject = { [key: string]: ClaudeSeatJSONValue | undefined };
type ClaudeSeatProviderMetadata = Record<string, ClaudeSeatJSONObject>;

export type ClaudeSeatWarning =
  | { type: 'unsupported'; feature: string; details?: string }
  | { type: 'other'; message: string };

export interface ClaudeSeatUsage {
  inputTokens: { total: number | undefined; noCache: number | undefined; cacheRead: number | undefined; cacheWrite: number | undefined };
  /** text = total - reasoning als de CLI denken apart meldt, anders undefined. */
  outputTokens: { total: number | undefined; text: number | undefined; reasoning: number | undefined };
  raw?: ClaudeSeatJSONObject;
}

export interface ClaudeSeatFinishReason {
  unified: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other';
  raw: string | undefined;
}

export type ClaudeSeatContent =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: string };

export interface ClaudeSeatGenerateResult {
  content: ClaudeSeatContent[];
  finishReason: ClaudeSeatFinishReason;
  usage: ClaudeSeatUsage;
  warnings: ClaudeSeatWarning[];
  providerMetadata?: ClaudeSeatProviderMetadata;
  request?: { body?: unknown };
  response?: { id?: string; modelId?: string; timestamp?: Date };
}

export type ClaudeSeatStreamPart =
  | { type: 'stream-start'; warnings: ClaudeSeatWarning[] }
  | { type: 'response-metadata'; id?: string; modelId?: string; timestamp?: Date }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'tool-input-start'; id: string; toolName: string }
  | { type: 'tool-input-delta'; id: string; delta: string }
  | { type: 'tool-input-end'; id: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: string }
  | { type: 'finish'; usage: ClaudeSeatUsage; finishReason: ClaudeSeatFinishReason; providerMetadata?: ClaudeSeatProviderMetadata };

export interface ClaudeSeatStreamResult {
  stream: ReadableStream<ClaudeSeatStreamPart>;
  request?: { body?: unknown };
  response?: { headers?: Record<string, string> };
}

export interface ClaudeSeatModel {
  readonly specificationVersion: 'v4';
  readonly provider: 'claude-seat';
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]>;
  // De aanroepopties zijn die van LanguageModelV4CallOptions; zonder import van
  // @ai-sdk/provider houden we ze open, de resultaten zijn exact getypeerd.
  doGenerate(options: any): PromiseLike<ClaudeSeatGenerateResult>;
  doStream(options: any): PromiseLike<ClaudeSeatStreamResult>;
}

export declare function claudeSeat(modelId: string, options?: ClaudeSeatOptions): ClaudeSeatModel;
export default claudeSeat;

export declare class ClaudeSeatError extends Error {
  /** auth | managed | limit | overloaded | timeout | cli | spawn (managed: beheerd beleid dat de isolatie breekt; geen opt-out) */
  readonly kind: string;
  /** Alleen waar bij een tijdelijke fout; de provider heeft dan al zelf opnieuw geprobeerd. */
  readonly isRetryable?: boolean;
  /** De (geredigeerde) uitvoer van claude. */
  readonly detail?: string;
}

/** Zet de stop_reason van de CLI om in de finish reason van de AI SDK. */
export declare function unifiedFinish(stopReason: string | null | undefined, hasToolCall?: boolean): ClaudeSeatFinishReason['unified'];

/** Haalt de actieve token en elk sk-ant-…-patroon uit een tekst. */
export declare function redact(text: unknown, secrets?: Array<string | undefined>): string;
