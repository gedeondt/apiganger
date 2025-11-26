export const DEFAULT_GENERIC_PROMPT =
  "You are an API simulator. Respond with JSON only, validating input and shaping data for the described endpoint.";

export type SimulationRequest<TPayload = unknown> = {
  payload: TPayload;
};

export type SimulationResult = {
  prompt: string;
  result: unknown;
  usingOpenAI: boolean;
};
