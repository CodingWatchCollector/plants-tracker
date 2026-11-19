import type { Client } from '@libsql/client';

type LogFitCheckProps = {
  db: Client;
  homeId: number;
  candidateText: string;
  speciesId: number | null;
  verdict: string;
  responseJson: string;
  model: string;
  promptVersion: string;
  inputTokens: number | null | undefined;
  outputTokens: number | null | undefined;
  latencyMs: number;
  guardrailFired: boolean;
};
export const logFitCheck = ({
  db,
  homeId,
  candidateText,
  speciesId,
  verdict,
  responseJson,
  model,
  promptVersion,
  inputTokens,
  outputTokens,
  latencyMs,
  guardrailFired,
}: LogFitCheckProps) => {
  // Migration added: version 5 in src/lib/server/migrate.ts. Run `pnpm db:migrate`.
  return db
    .execute({
      sql: `
    INSERT INTO fit_checks (home_id, candidate_text, species_id, 
    verdict, response_json, model, prompt_version, 
    input_tokens, output_tokens,latency_ms, guardrail_fired)
    VALUES(?,?,?,?,?,?,?,?,?,?,?);
    `,
      args: [
        homeId,
        candidateText, // cap it at the route (100 chars, per the plan); no need to repeat it here
        speciesId,
        verdict,
        responseJson,
        model,
        promptVersion,
        inputTokens ?? null,
        outputTokens ?? null,
        latencyMs,
        guardrailFired ? 1 : 0,
      ],
    })
    .catch((err) => {
      console.error(`[LogFitCheck error] ${err?.message || 'unknown error'}`);
      return null;
    });
};

type GetFitCheckCountByHomeAndDateProps = {
  db: Client;
  homeId: number;
  date?: Date;
};
export const getFitCheckCountByHomeAndDate = ({
  db,
  homeId,
  date,
}: GetFitCheckCountByHomeAndDateProps) => {
  // One statement for both cases, so the bound parameters always match the placeholders (the HTTP
  // client rejects extras). SQLite's date() reads a bound 'now' the same as the literal.
  const day = date ? date.toISOString() : 'now';
  return db
    .execute({
      sql: `
  SELECT COUNT(*) as check_count FROM fit_checks
  WHERE home_id = $homeId
    AND created_at >= date($day) AND created_at < date($day, '+1 day')
  `,
      args: { homeId, day },
    })
    .then((result) => result.rows[0]['check_count'])
    .catch((err) => {
      console.error(`[GetFitCheckCountByHomeAndDate error] ${err?.message || 'unknown error'}`);
      return null;
    });
};
