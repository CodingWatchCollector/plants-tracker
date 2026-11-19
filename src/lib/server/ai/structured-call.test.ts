import type { OpenRouter } from '@openrouter/sdk';
import { describe, expect, it, vi } from 'vitest';
import z from 'zod';
import { structuredCall } from './structured-call';

const schema = z.object({ answer: z.string() });

const chatResult = (content: unknown, finishReason = 'stop', refusal: string | null = null) => ({
  choices: [
    {
      index: 0,
      finishReason,
      message: {
        role: 'assistant',
        content: typeof content === 'string' ? content : JSON.stringify(content),
        refusal,
      },
    },
  ],
  usage: { promptTokens: 10, completionTokens: 4 },
});

const call = (send: ReturnType<typeof vi.fn>) =>
  structuredCall({
    client: { chat: { send } } as unknown as OpenRouter,
    model: 'some/model',
    schemaName: 'the-schema',
    schema,
    system: 'system text',
    user: 'user text',
  });

describe('structuredCall', () => {
  it('sends the model, both messages and a strict JSON schema, with no sampling parameters', async () => {
    const send = vi.fn().mockResolvedValue(chatResult({ answer: 'x' }));
    await call(send);
    const request = send.mock.calls[0][0].chatRequest;
    expect(request.model).toBe('some/model');
    expect(request.messages).toEqual([
      { role: 'system', content: 'system text' },
      { role: 'user', content: 'user text' },
    ]);
    expect(request.responseFormat).toMatchObject({
      type: 'json_schema',
      jsonSchema: {
        strict: true,
        name: 'the-schema',
        schema: { type: 'object', required: ['answer'] },
      },
    });
    expect(request.provider).toEqual({ requireParameters: true });
    for (const key of ['temperature', 'reasoning', 'effort', 'cache_control']) {
      expect(request).not.toHaveProperty(key);
    }
  });

  it('returns the parsed data and usage', async () => {
    const send = vi.fn().mockResolvedValue(chatResult({ answer: 'x' }));
    expect(await call(send)).toEqual({
      ok: true,
      data: { answer: 'x' },
      usage: { inputTokens: 10, outputTokens: 4, latencyMs: expect.any(Number) },
    });
  });

  it('checks the finish reason before anything else', async () => {
    const send = vi.fn().mockResolvedValue(chatResult({ answer: 'x' }, 'length', 'no'));
    expect(await call(send)).toMatchObject({
      ok: false,
      failure: 'invalid_response',
      detail: 'unexpected finishReason: length',
      usage: { inputTokens: 10, outputTokens: 4 },
    });
  });

  it('reports a refusal, then bad content, then a schema mismatch', async () => {
    expect(await call(vi.fn().mockResolvedValue(chatResult('', 'stop', 'no')))).toMatchObject({
      ok: false,
      failure: 'refused',
    });
    expect(await call(vi.fn().mockResolvedValue(chatResult('not json')))).toMatchObject({
      ok: false,
      failure: 'invalid_response',
    });
    const mismatch = await call(vi.fn().mockResolvedValue(chatResult({ answer: 5 })));
    expect(mismatch).toMatchObject({ ok: false, failure: 'invalid_response' });
    if (!mismatch.ok) expect(mismatch.detail).toContain('schema mismatch');
  });

  it('caps the content echoed in the failure detail', async () => {
    const result = await call(vi.fn().mockResolvedValue(chatResult('z'.repeat(5000))));
    if (result.ok) throw new Error('expected failure');
    expect(result.detail.length).toBeLessThan(1500);
  });

  it('reports a rejected request as provider_error with no usage', async () => {
    const send = vi.fn().mockRejectedValue(new Error('network down'));
    expect(await call(send)).toEqual({
      ok: false,
      failure: 'provider_error',
      detail: 'network down',
      usage: null,
    });
  });
});
