import { getEncoding } from "js-tiktoken";

export interface Tokenizer {
  count(text: string): number;
  name(): string;
}

const SUPPORTED_ENCODINGS = ["cl100k_base", "o200k_base"] as const;
type SupportedEncoding = (typeof SUPPORTED_ENCODINGS)[number];

class TiktokenTokenizer implements Tokenizer {
  private readonly enc: ReturnType<typeof getEncoding>;
  private readonly encoding: SupportedEncoding;

  constructor(encoding: SupportedEncoding) {
    this.encoding = encoding;
    this.enc = getEncoding(encoding);
  }

  count(text: string): number {
    if (text.length === 0) return 0;
    return this.enc.encode(text).length;
  }

  name(): string {
    return this.encoding;
  }
}

class EstimatorTokenizer implements Tokenizer {
  count(text: string): number {
    return Math.ceil(text.length / 4);
  }

  name(): string {
    return "none";
  }
}

export function createTokenizer(name: string): Tokenizer {
  if (name === "none") {
    return new EstimatorTokenizer();
  }
  if ((SUPPORTED_ENCODINGS as readonly string[]).includes(name)) {
    return new TiktokenTokenizer(name as SupportedEncoding);
  }
  throw new Error(
    `Unknown tokenizer encoding: "${name}". Supported: ${[...SUPPORTED_ENCODINGS, "none"].join(", ")}`,
  );
}
