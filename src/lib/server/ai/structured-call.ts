// One model call that must answer in a given JSON schema, shared by the fit check and the
// alternatives re-rank. It sends the request, checks the answer in a fixed order (finish reason,
// refusal, content type, schema) and reports token usage. What to do with the answer is up to the
// caller. Only relative value imports: the eval runs this under tsx, which doesn't resolve $lib.
import type { OpenRouter } from '@openrouter/sdk';
import z from 'zod';

// refused: the model declined. invalid_response: truncated, empty, or not matching the schema.
// provider_error: the request itself failed (network, routing, rate limit, bad key).
export type StructuredCallFailure = 'refused' | 'invalid_response' | 'provider_error';

export type StructuredCallUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
};

export type StructuredCallResult<T> =
  | { ok: true; data: T; usage: StructuredCallUsage }
  | {
      ok: false;
      failure: StructuredCallFailure;
      detail: string; // the error message; for invalid content include up to 1000 chars of it
      usage: StructuredCallUsage | null; // null only for provider_error (no response came back)
    };

type TokenCounts = Pick<StructuredCallUsage, 'inputTokens' | 'outputTokens'>;

class StructuredCallError extends Error {
  constructor(
    readonly failure: StructuredCallFailure,
    message: string,
    readonly tokens?: TokenCounts
  ) {
    super(message);
  }
}

type StructuredCallProps<T> = {
  client: OpenRouter;
  model: string;
  schemaName: string;
  schema: z.ZodType<T>;
  system: string;
  user: string;
};

const MAX_DETAIL_CONTENT = 1000;

export const structuredCall = async <T>({
  client,
  model,
  schemaName,
  schema,
  system,
  user,
}: StructuredCallProps<T>): Promise<StructuredCallResult<T>> => {
  const startTime = performance.now();
  const usageOf = (tokens?: TokenCounts): StructuredCallUsage => ({
    inputTokens: tokens?.inputTokens ?? null,
    outputTokens: tokens?.outputTokens ?? null,
    latencyMs: Math.round(performance.now() - startTime),
  });
  try {
    const res = await client.chat.send({
      chatRequest: {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        responseFormat: {
          type: 'json_schema',
          jsonSchema: {
            strict: true,
            name: schemaName,
            schema: z.toJSONSchema(schema),
          },
        },
        provider: {
          requireParameters: true,
        },
      },
    });
    if (res instanceof ReadableStream) {
      throw new StructuredCallError('provider_error', 'unexpected streaming response');
    }
    const tokens: TokenCounts = {
      inputTokens: res.usage?.promptTokens ?? null,
      outputTokens: res.usage?.completionTokens ?? null,
    };
    const choice = res.choices[0];
    const finishReason = choice.finishReason;
    if (finishReason !== 'stop') {
      throw new StructuredCallError(
        'invalid_response',
        `unexpected finishReason: ${finishReason}`,
        tokens
      );
    }
    if (choice.message.refusal) {
      throw new StructuredCallError('refused', 'received refusal message', tokens);
    }
    const content = choice.message.content;
    if (typeof content !== 'string') {
      throw new StructuredCallError('invalid_response', 'wrong content type', tokens);
    }
    const parsed = schema.safeParse(parseJson(content));
    if (!parsed.success) {
      throw new StructuredCallError(
        'invalid_response',
        `schema mismatch: ${parsed.error.message}\ncontent: ${content.slice(0, MAX_DETAIL_CONTENT)}`,
        tokens
      );
    }
    return { ok: true, data: parsed.data, usage: usageOf(tokens) };
  } catch (error) {
    const message = (error as Error)?.message || 'unknown error';
    console.error(`[StructuredCall error: ${schemaName}] ${message}`);
    if (error instanceof StructuredCallError) {
      return {
        ok: false,
        failure: error.failure,
        detail: message,
        usage: error.tokens ? usageOf(error.tokens) : null,
      };
    }
    return { ok: false, failure: 'provider_error', detail: message, usage: null };
  }
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};
