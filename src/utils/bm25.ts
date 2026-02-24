import type { ExpertiseRecord } from "../schemas/record.ts";

/**
 * BM25 parameters (tuned for short document collections like expertise records)
 */
export interface BM25Params {
  /** Controls non-linear term frequency normalization (typical: 1.2-2.0) */
  k1: number;
  /** Controls document length normalization (0 = no normalization, 1 = full normalization) */
  b: number;
}

/**
 * Default BM25 parameters optimized for expertise records
 */
export const DEFAULT_BM25_PARAMS: BM25Params = {
  k1: 1.5,
  b: 0.75,
};

/**
 * Result of BM25 search
 */
export interface BM25Result {
  record: ExpertiseRecord;
  score: number;
  /** Fields that matched the query */
  matchedFields: string[];
}

/**
 * Tokenize text into searchable terms
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ") // Replace punctuation with spaces (keep hyphens in words)
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * Extract searchable text from a record
 */
export function extractRecordText(record: ExpertiseRecord): {
  allText: string;
  fieldTexts: Record<string, string>;
} {
  const fieldTexts: Record<string, string> = {};
  const allParts: string[] = [];

  // Helper to add field text
  const addField = (name: string, value: unknown): void => {
    if (typeof value === "string" && value.trim().length > 0) {
      fieldTexts[name] = value;
      allParts.push(value);
    } else if (Array.isArray(value)) {
      const arrayText = value
        .filter((item) => typeof item === "string")
        .join(" ");
      if (arrayText.trim().length > 0) {
        fieldTexts[name] = arrayText;
        allParts.push(arrayText);
      }
    }
  };

  // Extract type-specific fields
  switch (record.type) {
    case "pattern":
      addField("name", record.name);
      addField("description", record.description);
      addField("files", record.files);
      break;
    case "convention":
      addField("content", record.content);
      break;
    case "failure":
      addField("description", record.description);
      addField("resolution", record.resolution);
      break;
    case "decision":
      addField("title", record.title);
      addField("rationale", record.rationale);
      break;
    case "reference":
      addField("name", record.name);
      addField("description", record.description);
      addField("files", record.files);
      break;
    case "guide":
      addField("name", record.name);
      addField("description", record.description);
      break;
  }

  // Add common fields
  addField("tags", record.tags);

  return {
    allText: allParts.join(" "),
    fieldTexts,
  };
}

/**
 * Calculate term frequency in a document
 */
function calculateTermFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  return tf;
}

/**
 * Calculate inverse document frequency for all terms in the corpus
 */
function calculateIDF(
  corpus: Array<{ tokens: string[] }>,
): Map<string, number> {
  const docCount = corpus.length;
  const docFreq = new Map<string, number>();

  // Count how many documents contain each term
  for (const doc of corpus) {
    const uniqueTerms = new Set(doc.tokens);
    for (const term of uniqueTerms) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }

  // Calculate IDF for each term
  const idf = new Map<string, number>();
  for (const [term, freq] of docFreq.entries()) {
    // IDF formula: log((N - df + 0.5) / (df + 0.5) + 1)
    // The +1 ensures positive values for common terms
    idf.set(term, Math.log((docCount - freq + 0.5) / (freq + 0.5) + 1));
  }

  return idf;
}

/**
 * Calculate BM25 score for a single document against a query
 */
function calculateBM25Score(
  queryTokens: string[],
  docTokens: string[],
  docLength: number,
  avgDocLength: number,
  idf: Map<string, number>,
  params: BM25Params,
): number {
  const tf = calculateTermFrequency(docTokens);
  let score = 0;

  for (const queryTerm of queryTokens) {
    const termFreq = tf.get(queryTerm) || 0;
    const termIDF = idf.get(queryTerm) || 0;

    // BM25 formula
    const numerator = termFreq * (params.k1 + 1);
    const denominator =
      termFreq +
      params.k1 * (1 - params.b + params.b * (docLength / avgDocLength));

    score += termIDF * (numerator / denominator);
  }

  return score;
}

/**
 * Search records using BM25 ranking
 */
export function searchBM25(
  records: ExpertiseRecord[],
  query: string,
  params: BM25Params = DEFAULT_BM25_PARAMS,
): BM25Result[] {
  if (records.length === 0 || query.trim().length === 0) {
    return [];
  }

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return [];
  }

  // Extract and tokenize all documents
  const docs = records.map((record) => {
    const { allText, fieldTexts } = extractRecordText(record);
    const tokens = tokenize(allText);
    return { record, tokens, allText, fieldTexts };
  });

  // Calculate average document length
  const totalLength = docs.reduce((sum, doc) => sum + doc.tokens.length, 0);
  const avgDocLength = totalLength / docs.length;

  // Calculate IDF for all terms
  const idf = calculateIDF(docs);

  // Score each document
  const results: BM25Result[] = [];

  for (const doc of docs) {
    const score = calculateBM25Score(
      queryTokens,
      doc.tokens,
      doc.tokens.length,
      avgDocLength,
      idf,
      params,
    );

    // Only include results with score > 0
    if (score > 0) {
      // Determine which fields matched
      const matchedFields: string[] = [];
      for (const [fieldName, fieldText] of Object.entries(doc.fieldTexts)) {
        const fieldTokens = tokenize(fieldText);
        const hasMatch = queryTokens.some((qt) => fieldTokens.includes(qt));
        if (hasMatch) {
          matchedFields.push(fieldName);
        }
      }

      results.push({
        record: doc.record,
        score,
        matchedFields,
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results;
}
