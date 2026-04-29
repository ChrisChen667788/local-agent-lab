import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

export type RetrievalVectorChunk = {
  chunkId: string;
  title: string;
  source?: string;
  sectionPath: string[];
  tags: string[];
  content: string;
  order: number;
  charCount: number;
};

type RetrievalVectorIndex = {
  version: "local-hash-embedding-v1";
  generatedAt: string;
  dims: number;
  chunkCount: number;
  chunkSignature: string;
  items: Array<{
    chunkId: string;
    vector: number[];
  }>;
};

const VECTOR_DIMS = 192;

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenizeWords(text: string) {
  return normalizeText(text).match(/[a-z0-9_]{2,}/g) || [];
}

function tokenizeCjkBigrams(text: string) {
  const groups = normalizeText(text).match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) || [];
  const tokens: string[] = [];
  for (const group of groups) {
    if (group.length === 1) {
      tokens.push(group);
      continue;
    }
    for (let index = 0; index < group.length - 1; index += 1) {
      tokens.push(group.slice(index, index + 2));
    }
  }
  return tokens;
}

function tokenizeCharTrigrams(text: string) {
  const compact = normalizeText(text).replace(/\s+/g, "");
  if (compact.length < 3) return compact ? [compact] : [];
  const tokens: string[] = [];
  for (let index = 0; index < compact.length - 2; index += 1) {
    tokens.push(compact.slice(index, index + 3));
  }
  return tokens;
}

function collectVectorTokens(text: string) {
  return [...tokenizeWords(text), ...tokenizeCjkBigrams(text), ...tokenizeCharTrigrams(text)];
}

function hashToken(token: string) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function normalizeVector(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

function embedText(text: string, dims = VECTOR_DIMS) {
  const vector = new Array<number>(dims).fill(0);
  const tokens = collectVectorTokens(text);
  for (const token of tokens) {
    const hash = hashToken(token);
    const index = hash % dims;
    const sign = hash % 2 === 0 ? 1 : -1;
    vector[index] += sign * Math.min(3, Math.max(1, token.length / 2));
  }
  return normalizeVector(vector);
}

function cosineSimilarity(left: number[], right: number[]) {
  let sum = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    sum += left[index] * right[index];
  }
  return Number(sum.toFixed(6));
}

function buildChunkSignature(chunks: RetrievalVectorChunk[]) {
  return chunks
    .map((chunk) => `${chunk.chunkId}:${chunk.charCount}:${chunk.order}:${chunk.title.slice(0, 24)}`)
    .join("|");
}

function buildIndex(chunks: RetrievalVectorChunk[]): RetrievalVectorIndex {
  return {
    version: "local-hash-embedding-v1",
    generatedAt: new Date().toISOString(),
    dims: VECTOR_DIMS,
    chunkCount: chunks.length,
    chunkSignature: buildChunkSignature(chunks),
    items: chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      vector: embedText(
        [chunk.title, chunk.sectionPath.join(" "), chunk.tags.join(" "), chunk.source || "", chunk.content].join("\n")
      )
    }))
  };
}

export function ensureRetrievalVectorIndex(indexFile: string, chunks: RetrievalVectorChunk[]) {
  const nextSignature = buildChunkSignature(chunks);
  if (existsSync(indexFile)) {
    try {
      const current = JSON.parse(readFileSync(indexFile, "utf8")) as RetrievalVectorIndex;
      if (current.chunkSignature === nextSignature && current.chunkCount === chunks.length) {
        return current;
      }
    } catch {
      // rebuild below
    }
  }
  mkdirSync(path.dirname(indexFile), { recursive: true });
  const next = buildIndex(chunks);
  writeFileSync(indexFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function searchVectorIndex(
  index: RetrievalVectorIndex,
  query: string,
  topK: number
) {
  const queryVector = embedText(query, index.dims);
  return index.items
    .map((item) => ({
      chunkId: item.chunkId,
      score: cosineSimilarity(queryVector, item.vector)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(topK, 1));
}
