export const TELEGRAM_MESSAGE_LIMIT = 4096;
export const SAFE_TELEGRAM_CHUNK_LENGTH = 3600;
export const MAX_TELEGRAM_CHUNKS = 5;
export const MAX_TELEGRAM_ERROR_LENGTH = 180;

export interface TelegramSendOptions {
  botToken: string;
  chatId: string;
  text: string;
  fetchImpl?: typeof fetch;
}

export interface TelegramChunkResult {
  index: number;
  delivered: boolean;
  status: number | null;
  error: string | null;
}

export interface TelegramDeliveryResult {
  delivered: boolean;
  attemptedChunks: number;
  successfulChunks: number;
  totalChunks: number;
  chunkResults: TelegramChunkResult[];
  error: string | null;
}

function sanitizeTelegramText(text: string): string {
  const sanitized = text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  return sanitized.length > 0 ? sanitized : " ";
}

function findSplitIndex(text: string, maxLength: number): number {
  if (text.length <= maxLength) return text.length;

  const searchWindow = text.slice(0, maxLength + 1);
  const boundaryCandidates = [
    searchWindow.lastIndexOf("\n\n"),
    searchWindow.lastIndexOf("\n"),
    searchWindow.lastIndexOf(". "),
    searchWindow.lastIndexOf(" "),
  ].filter((index) => index > Math.floor(maxLength * 0.5));

  const boundary = boundaryCandidates[0];
  if (boundary !== undefined) {
    return boundary + (searchWindow.slice(boundary, boundary + 2) === ". " ? 1 : 0);
  }

  return maxLength;
}

export function splitTelegramText(
  text: string,
  options?: { chunkLength?: number; maxChunks?: number }
): string[] {
  const chunkLength = Math.min(options?.chunkLength ?? SAFE_TELEGRAM_CHUNK_LENGTH, TELEGRAM_MESSAGE_LIMIT);
  const maxChunks = options?.maxChunks ?? MAX_TELEGRAM_CHUNKS;
  const chunks: string[] = [];
  let remaining = sanitizeTelegramText(text);

  while (remaining.length > chunkLength && chunks.length < maxChunks - 1) {
    const splitIndex = findSplitIndex(remaining, chunkLength);
    const chunk = remaining.slice(0, splitIndex).trimEnd();
    chunks.push(chunk.length > 0 ? chunk : remaining.slice(0, chunkLength));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining.length > chunkLength) {
    const clipped = remaining.slice(0, Math.max(0, chunkLength - 1)).trimEnd();
    chunks.push(`${clipped}…`);
  } else {
    chunks.push(remaining.length > 0 ? remaining : " ");
  }

  return chunks.slice(0, maxChunks).map((chunk) =>
    chunk.length <= chunkLength ? chunk : chunk.slice(0, chunkLength)
  );
}

export function redactTelegramError(value: unknown, maxLength = MAX_TELEGRAM_ERROR_LENGTH): string {
  const raw = value instanceof Error
    ? value.message
    : typeof value === "string"
      ? value
      : JSON.stringify(value ?? "unknown error");

  return raw
    .replace(/https:\/\/api\.telegram\.org\/bot[^\s/]+\/[^\s)"']+/g, "https://api.telegram.org/<redacted>")
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot<redacted>")
    .replace(/\b\d+:[A-Za-z0-9_-]{8,}\b/g, "<redacted-token>")
    .replace(/Bearer\s+\S+/gi, "Bearer <redacted>")
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

async function readBoundedResponseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (err) {
    return redactTelegramError(err);
  }
}

export async function sendTelegramMessage(options: TelegramSendOptions): Promise<TelegramDeliveryResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const chunks = splitTelegramText(options.text);
  const chunkResults: TelegramChunkResult[] = [];
  const endpoint = `https://api.telegram.org/bot${options.botToken}/sendMessage`;

  for (const [index, chunk] of chunks.entries()) {
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: options.chatId,
          text: chunk,
          disable_web_page_preview: true,
        }),
      });

      if (!response.ok) {
        const body = await readBoundedResponseBody(response);
        const error = redactTelegramError(`telegram http ${response.status}: ${body}`);
        chunkResults.push({ index, delivered: false, status: response.status, error });
        break;
      }

      chunkResults.push({ index, delivered: true, status: response.status, error: null });
    } catch (err) {
      chunkResults.push({
        index,
        delivered: false,
        status: null,
        error: redactTelegramError(err),
      });
      break;
    }
  }

  const successfulChunks = chunkResults.filter((result) => result.delivered).length;
  const firstError = chunkResults.find((result) => result.error !== null)?.error ?? null;
  const delivered = successfulChunks === chunks.length && firstError === null;

  return {
    delivered,
    attemptedChunks: chunkResults.length,
    successfulChunks,
    totalChunks: chunks.length,
    chunkResults,
    error: delivered ? null : firstError ?? "telegram send failed",
  };
}
