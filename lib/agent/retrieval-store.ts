import crypto from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type {
  AgentGroundedVerification,
  AgentKnowledgeDocument,
  AgentKnowledgeHit,
  AgentRetrievalSummary
} from "@/lib/agent/types";
import { getObservabilityPaths } from "@/lib/agent/log-store";

type KnowledgeChunkRecord = {
  id: string;
  documentId: string;
  title: string;
  source?: string;
  tags: string[];
  sectionPath: string[];
  order: number;
  content: string;
  charCount: number;
  tokenEstimate: number;
};

type StructuredBlock = {
  sectionPath: string[];
  content: string;
};

type KnowledgeBaseSnapshot = {
  documents: AgentKnowledgeDocument[];
  chunks: KnowledgeChunkRecord[];
};

type KnowledgeBaseStats = {
  documentCount: number;
  chunkCount: number;
  avgChunkChars: number;
  avgChunkTokens: number;
};

type UpsertKnowledgeDocumentInput = {
  id?: string;
  title: string;
  source?: string;
  tags?: string[];
  content: string;
};

const CHUNK_TARGET_CHARS = 720;
const CHUNK_OVERLAP_CHARS = 160;
const DEFAULT_TOP_K = 4;
const KNOWLEDGE_CITATION_PREFIX = "KB";
const CITATION_PATTERN = /\[(KB\d+)\]/gi;
const UNCERTAINTY_PATTERN =
  /(insufficient|uncertain|not enough|can't verify|cannot verify|unable to verify|evidence is insufficient|不确定|无法确认|不能确认|证据不足|信息不足|暫時無法確認|證據不足|情報不足)/i;

function ensureDataDir() {
  mkdirSync(getObservabilityPaths().dataDir, { recursive: true });
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, value: unknown) {
  ensureDataDir();
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildKnowledgePaths() {
  const paths = getObservabilityPaths();
  return {
    documentFile: paths.knowledgeDocumentFile,
    chunkFile: paths.knowledgeChunkFile
  };
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

function normalizeTags(tags: string[] = []) {
  return Array.from(
    new Set(
      tags
        .flatMap((tag) => tag.split(","))
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

function normalizeContent(content: string) {
  return content.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
}

function pushHeading(stack: string[], level: number, title: string) {
  const next = stack.slice(0, Math.max(0, level - 1));
  next[level - 1] = title;
  return next;
}

function extractStructuredBlocks(content: string) {
  const normalized = normalizeContent(content);
  if (!normalized) return [] as StructuredBlock[];

  const lines = normalized.split("\n");
  const blocks: StructuredBlock[] = [];
  let headingStack: string[] = [];
  let paragraphLines: string[] = [];

  function flushParagraph() {
    const text = paragraphLines.join("\n").trim();
    if (!text) {
      paragraphLines = [];
      return;
    }
    blocks.push({
      sectionPath: [...headingStack],
      content: text
    });
    paragraphLines = [];
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      if (title) {
        headingStack = pushHeading(headingStack, level, title);
      }
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    paragraphLines.push(line);
  }
  flushParagraph();

  if (!blocks.length) {
    return [{ sectionPath: [], content: normalized }];
  }
  return blocks;
}

function chunkStructuredBlocks(blocks: StructuredBlock[]) {
  const chunks: Array<{ sectionPath: string[]; content: string }> = [];
  let currentBlocks: StructuredBlock[] = [];
  let currentChars = 0;

  const flushChunk = () => {
    if (!currentBlocks.length) return;
    const content = currentBlocks.map((block) => block.content).join("\n\n").trim();
    if (!content) {
      currentBlocks = [];
      currentChars = 0;
      return;
    }
    chunks.push({
      sectionPath: currentBlocks[0]?.sectionPath || [],
      content
    });

    const overlapBlocks: StructuredBlock[] = [];
    let overlapChars = 0;
    for (let index = currentBlocks.length - 1; index >= 0; index -= 1) {
      overlapBlocks.unshift(currentBlocks[index]);
      overlapChars += currentBlocks[index].content.length;
      if (overlapChars >= CHUNK_OVERLAP_CHARS) break;
    }
    currentBlocks = overlapBlocks;
    currentChars = overlapChars;
  };

  for (const block of blocks) {
    const blockChars = block.content.length + 2;
    if (currentBlocks.length && currentChars + blockChars > CHUNK_TARGET_CHARS) {
      flushChunk();
    }
    currentBlocks.push(block);
    currentChars += blockChars;
  }
  flushChunk();

  return chunks;
}

function buildChunkRecords(document: AgentKnowledgeDocument) {
  const structuredBlocks = extractStructuredBlocks(document.content);
  const chunks = chunkStructuredBlocks(structuredBlocks);
  return chunks.map((chunk, index) => ({
    id: `${document.id}:chunk:${index + 1}`,
    documentId: document.id,
    title: document.title,
    source: document.source,
    tags: document.tags,
    sectionPath: chunk.sectionPath,
    order: index + 1,
    content: chunk.content,
    charCount: chunk.content.length,
    tokenEstimate: estimateTokens(chunk.content)
  }));
}

function readSnapshot(): KnowledgeBaseSnapshot {
  const { documentFile, chunkFile } = buildKnowledgePaths();
  return {
    documents: readJsonFile<AgentKnowledgeDocument[]>(documentFile, []),
    chunks: readJsonFile<KnowledgeChunkRecord[]>(chunkFile, [])
  };
}

function writeSnapshot(snapshot: KnowledgeBaseSnapshot) {
  const { documentFile, chunkFile } = buildKnowledgePaths();
  writeJsonFile(documentFile, snapshot.documents);
  writeJsonFile(chunkFile, snapshot.chunks);
}

function tokenizeLatin(text: string) {
  return text.toLowerCase().match(/[a-z0-9_]{2,}/g) || [];
}

function tokenizeCjk(text: string) {
  const groups = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) || [];
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

function tokenize(text: string) {
  return Array.from(new Set([...tokenizeLatin(text), ...tokenizeCjk(text)]));
}

function compressChunkForQuery(query: string, content: string, maxChars = 320) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;

  const queryTokens = tokenize(query).sort((a, b) => b.length - a.length);
  const lower = normalized.toLowerCase();
  let anchor = -1;
  for (const token of queryTokens) {
    anchor = lower.indexOf(token.toLowerCase());
    if (anchor !== -1) break;
  }

  if (anchor === -1) {
    return `${normalized.slice(0, maxChars)}...`;
  }

  const half = Math.floor(maxChars / 2);
  const start = Math.max(0, anchor - half);
  const end = Math.min(normalized.length, anchor + half);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalized.length ? "..." : "";
  return `${prefix}${normalized.slice(start, end).trim()}${suffix}`;
}

function countOverlap(queryTokens: string[], candidateTokens: Set<string>) {
  let overlap = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) overlap += 1;
  }
  return overlap;
}

function formatCitationLabel(index: number) {
  return `[${KNOWLEDGE_CITATION_PREFIX}${index}]`;
}

const GENERAL_KNOWLEDGE_PATTERNS = [
  /^(什么是|什么叫|解释一下|请解释|介绍一下|说说|如何理解|为什么|怎么|如何|有哪些|区别是什么|有什么区别|推荐|建议)/,
  /^(what is|what's|explain|why|how|compare|difference|recommend|suggest)/i,
  /(上火|水果|蔬菜|感冒|发烧|RAG|prompt cache|agent|benchmark|幻觉|检索增强)/i,
];

const KNOWLEDGE_SPECIFIC_PATTERNS = [
  /(仓库|repo|repository|代码|文件|目录|文档|知识库|kb|引用|citation|当前项目|这个系统|上述材料|上述资料|根据知识库|根据文档|结合资料|本仓库|本项目)/i,
  /(file|files|folder|directory|repository|repo|document|docs|knowledge base|citation|codebase|this project|this repo)/i,
];

function isGeneralKnowledgeQuestion(query: string) {
  const normalized = query.trim();
  if (!normalized) return false;
  if (KNOWLEDGE_SPECIFIC_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  return GENERAL_KNOWLEDGE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function buildKnowledgeBaseStats(snapshot: KnowledgeBaseSnapshot): KnowledgeBaseStats {
  const chunkCount = snapshot.chunks.length;
  const totalChars = snapshot.chunks.reduce((sum, chunk) => sum + chunk.charCount, 0);
  const totalTokens = snapshot.chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0);
  return {
    documentCount: snapshot.documents.length,
    chunkCount,
    avgChunkChars: chunkCount ? Number((totalChars / chunkCount).toFixed(1)) : 0,
    avgChunkTokens: chunkCount ? Number((totalTokens / chunkCount).toFixed(1)) : 0
  };
}

export function getKnowledgeBaseSnapshot() {
  const snapshot = readSnapshot();
  return {
    documents: snapshot.documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    stats: buildKnowledgeBaseStats(snapshot)
  };
}

export function upsertKnowledgeDocument(input: UpsertKnowledgeDocumentInput) {
  const title = input.title.trim();
  const content = normalizeContent(input.content);
  if (!title) {
    throw new Error("title is required.");
  }
  if (!content) {
    throw new Error("content is required.");
  }

  const snapshot = readSnapshot();
  const now = new Date().toISOString();
  const existing = input.id ? snapshot.documents.find((document) => document.id === input.id) : null;
  const documentId = existing?.id || `kb-doc-${crypto.randomUUID()}`;
  const normalizedTags = normalizeTags(input.tags || []);
  const nextDocument: AgentKnowledgeDocument = {
    id: documentId,
    title,
    source: input.source?.trim() || undefined,
    tags: normalizedTags,
    content,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    chunkCount: 0,
    charCount: content.length
  };

  const nextChunks = buildChunkRecords(nextDocument);
  nextDocument.chunkCount = nextChunks.length;

  const nextDocuments = snapshot.documents
    .filter((document) => document.id !== documentId)
    .concat(nextDocument)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const otherChunks = snapshot.chunks.filter((chunk) => chunk.documentId !== documentId);
  writeSnapshot({
    documents: nextDocuments,
    chunks: [...otherChunks, ...nextChunks]
  });

  return {
    document: nextDocument,
    stats: buildKnowledgeBaseStats({
      documents: nextDocuments,
      chunks: [...otherChunks, ...nextChunks]
    })
  };
}

export function deleteKnowledgeDocument(documentId: string) {
  const snapshot = readSnapshot();
  const nextDocuments = snapshot.documents.filter((document) => document.id !== documentId);
  if (nextDocuments.length === snapshot.documents.length) {
    return false;
  }
  const nextChunks = snapshot.chunks.filter((chunk) => chunk.documentId !== documentId);
  writeSnapshot({
    documents: nextDocuments,
    chunks: nextChunks
  });
  return true;
}

function buildSearchResult(
  chunk: KnowledgeChunkRecord,
  index: number,
  score: number,
  confidence: number,
  query: string
): AgentKnowledgeHit {
  return {
    chunkId: chunk.id,
    documentId: chunk.documentId,
    title: chunk.title,
    source: chunk.source,
    sectionPath: chunk.sectionPath,
    order: chunk.order,
    content: compressChunkForQuery(query, chunk.content),
    citationLabel: formatCitationLabel(index + 1),
    score: Number(score.toFixed(2)),
    confidence: Number(confidence.toFixed(3))
  };
}

export function searchKnowledgeBase(query: string, topK = DEFAULT_TOP_K): AgentRetrievalSummary {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return {
      query: normalizedQuery,
      hitCount: 0,
      lowConfidence: true,
      topScore: 0,
      usedInPrompt: false,
      results: []
    };
  }

  const snapshot = readSnapshot();
  const queryTokens = tokenize(normalizedQuery);
  if (!queryTokens.length || !snapshot.chunks.length) {
    return {
      query: normalizedQuery,
      hitCount: 0,
      lowConfidence: true,
      topScore: 0,
      usedInPrompt: false,
      results: []
    };
  }

  const ranked = snapshot.chunks
    .map((chunk) => {
      const bodyTokens = new Set(tokenize(chunk.content));
      const titleTokens = new Set(tokenize(chunk.title));
      const sectionTokens = new Set(tokenize(chunk.sectionPath.join(" ")));
      const sourceTokens = new Set(tokenize(chunk.source || ""));

      const bodyOverlap = countOverlap(queryTokens, bodyTokens);
      const titleOverlap = countOverlap(queryTokens, titleTokens);
      const sectionOverlap = countOverlap(queryTokens, sectionTokens);
      const sourceOverlap = countOverlap(queryTokens, sourceTokens);
      const normalizedOverlap = bodyOverlap / Math.max(1, queryTokens.length);
      const exactPhraseBonus = chunk.content.includes(normalizedQuery) || chunk.title.includes(normalizedQuery) ? 0.35 : 0;
      const score =
        normalizedOverlap * 100 +
        titleOverlap * 18 +
        sectionOverlap * 10 +
        sourceOverlap * 6 +
        exactPhraseBonus * 100;
      const confidence = Math.min(1, normalizedOverlap + titleOverlap * 0.12 + sectionOverlap * 0.05 + exactPhraseBonus);

      return {
        chunk,
        score,
        confidence
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.order - b.chunk.order)
    .slice(0, Math.max(1, topK));

  const topScore = ranked[0]?.score || 0;
  const lowConfidence = topScore < 24;
  const results = ranked.map((entry, index) =>
    buildSearchResult(entry.chunk, index, entry.score, entry.confidence, normalizedQuery)
  );

  return {
    query: normalizedQuery,
    hitCount: results.length,
    lowConfidence,
    topScore: Number(topScore.toFixed(2)),
    usedInPrompt: results.length > 0,
    results
  };
}

export function applyRetrievalBypassStrategy(
  query: string,
  retrieval: AgentRetrievalSummary | null
): AgentRetrievalSummary | null {
  if (!retrieval) return retrieval;
  if (!isGeneralKnowledgeQuestion(query)) return retrieval;

  if (retrieval.hitCount === 0) {
    return {
      ...retrieval,
      usedInPrompt: false,
      bypassGrounding: true,
      bypassReason: "general-question-no-evidence"
    };
  }

  if (retrieval.lowConfidence) {
    return {
      ...retrieval,
      usedInPrompt: false,
      bypassGrounding: true,
      bypassReason: "general-question-low-confidence"
    };
  }

  return retrieval;
}

export function buildGroundedSystemPrompt(basePrompt: string, retrieval: AgentRetrievalSummary | null) {
  if (!retrieval) {
    return basePrompt;
  }

  if (retrieval.bypassGrounding) {
    return basePrompt;
  }

  if (!retrieval.results.length) {
    return [
      basePrompt,
      "",
      "Grounding policy:",
      "- Retrieval grounding is enabled for this turn.",
      "- No supporting evidence was retrieved from the local knowledge base.",
      "- You may still answer common or general questions from general model knowledge.",
      "- Do not fabricate knowledge-base citations when there is no retrieved evidence.",
      "- If the user asks about repository-specific, document-specific, or knowledge-base-specific facts, clearly say that no local evidence was found and separate that from any general guidance."
    ].join("\n");
  }

  const evidenceLines = retrieval.results.flatMap((result) => {
    const header = [
      `${result.citationLabel} ${result.title}`,
      result.sectionPath.length ? ` > ${result.sectionPath.join(" > ")}` : "",
      result.source ? ` · ${result.source}` : ""
    ].join("");
    return [header, result.content, ""];
  });

  return [
    basePrompt,
    "",
    "Grounding policy:",
    "- Use the retrieved evidence below when it is relevant to the question.",
    "- Cite grounded factual claims inline with the provided citation labels, for example [KB1].",
    "- Do not invent citations and do not cite labels that are not present in the retrieved evidence.",
    "- If the evidence is weak, incomplete, or only loosely related, you may still answer common questions from general model knowledge, but do not present the weak evidence as a strong factual source.",
    "- If you cannot support a repository-specific or document-specific claim with the evidence below, say so explicitly instead of presenting it as a fact.",
    "",
    retrieval.lowConfidence
      ? "Retrieval confidence is low. Prefer a general answer without forced citations unless the retrieved evidence clearly supports the claim."
      : "Retrieval confidence is acceptable. Prefer evidence-backed claims and keep citations close to those claims.",
    "",
    "Retrieved evidence:",
    ...evidenceLines
  ].join("\n");
}

function extractCitationLabels(content: string) {
  return Array.from(
    new Set(
      [...content.matchAll(CITATION_PATTERN)]
        .map((match) => match[1]?.toUpperCase())
        .filter((value): value is string => Boolean(value))
    )
  );
}

function stripCitationLabels(content: string) {
  return content.replace(CITATION_PATTERN, " ");
}

function hasUncertaintySignal(content: string) {
  return UNCERTAINTY_PATTERN.test(content);
}

function calculateLexicalGroundingScore(content: string, retrieval: AgentRetrievalSummary) {
  const answerTokens = tokenize(stripCitationLabels(content));
  if (!answerTokens.length) return 0;
  const evidenceTokens = new Set(
    retrieval.results.flatMap((result) => tokenize(`${result.title} ${result.content} ${result.sectionPath.join(" ")}`))
  );
  if (!evidenceTokens.size) return 0;
  const overlap = countOverlap(answerTokens, evidenceTokens);
  return Number((overlap / Math.max(answerTokens.length, 1)).toFixed(3));
}

function buildFallbackAnswer(retrieval: AgentRetrievalSummary | null) {
  if (!retrieval || !retrieval.results.length) {
    return "我目前无法基于知识库证据确认这个回答。当前没有检索到足够相关的依据，请缩小问题范围或补充资料后再试。";
  }

  const evidencePreview = retrieval.results
    .slice(0, 3)
    .map((result) => `- ${result.citationLabel} ${result.title}${result.sectionPath.length ? ` > ${result.sectionPath.join(" > ")}` : ""}`)
    .join("\n");

  return [
    "我目前无法基于现有检索证据给出高置信度结论。",
    retrieval.lowConfidence
      ? "当前命中的证据相关性偏低，我不应把下面内容表述成确定事实。"
      : "当前回答缺少足够明确的证据支撑，我先只返回可确认的证据范围。",
    "",
    "可用证据：",
    evidencePreview,
    "",
    "如果你愿意，可以缩小问题范围，或者补充更具体的文档后我再继续回答。"
  ].join("\n");
}

export function verifyGroundedAnswer(
  content: string,
  retrieval: AgentRetrievalSummary | null
): AgentGroundedVerification {
  if (!retrieval) {
    return {
      enforced: false,
      citationRequired: false,
      citationsPresent: false,
      verdict: "not-applicable",
      fallbackApplied: false,
      citedLabels: [],
      missingLabels: [],
      unsupportedLabels: [],
      lexicalGroundingScore: 0,
      notes: ["retrieval-disabled"]
    };
  }

  if (retrieval.bypassGrounding) {
    return {
      enforced: false,
      citationRequired: false,
      citationsPresent: false,
      verdict: "not-applicable",
      fallbackApplied: false,
      citedLabels: [],
      missingLabels: [],
      unsupportedLabels: [],
      lexicalGroundingScore: 0,
      notes: [retrieval.bypassReason || "retrieval-disabled"]
    };
  }

  const citedLabels = extractCitationLabels(content);
  const supportedLabelSet = new Set(retrieval.results.map((result) => result.citationLabel.replace(/[\[\]]/g, "").toUpperCase()));
  const unsupportedLabels = citedLabels.filter((label) => !supportedLabelSet.has(label));
  const citationsPresent = citedLabels.length > 0;
  const citationRequired = retrieval.hitCount > 0 && !retrieval.lowConfidence;
  const lexicalGroundingScore = calculateLexicalGroundingScore(content, retrieval);
  const notes: string[] = [];

  if (!retrieval.hitCount) {
    notes.push("no-evidence");
    return {
      enforced: false,
      citationRequired: false,
      citationsPresent,
      verdict: "not-applicable",
      fallbackApplied: false,
      citedLabels,
      missingLabels: [],
      unsupportedLabels,
      lexicalGroundingScore,
      notes
    };
  }

  if (unsupportedLabels.length) {
    notes.push("unsupported-citations");
  }
  if (!citationsPresent) {
    notes.push("missing-citations");
  }
  if (retrieval.lowConfidence) {
    notes.push("low-confidence");
  }
  if (lexicalGroundingScore < 0.06) {
    notes.push("weak-overlap");
  }

  let verdict: AgentGroundedVerification["verdict"] = "grounded";
  let fallbackApplied = false;
  let fallbackReason: AgentGroundedVerification["fallbackReason"] | undefined;

  if (retrieval.lowConfidence) {
    if (unsupportedLabels.length) {
      verdict = "unsupported";
      fallbackApplied = true;
      fallbackReason = "unsupported-claims";
    } else if (citationsPresent || lexicalGroundingScore >= 0.06 || hasUncertaintySignal(content)) {
      verdict = "weakly-grounded";
    } else {
      verdict = "not-applicable";
    }
  } else if (!citationsPresent) {
    verdict = lexicalGroundingScore >= 0.12 ? "weakly-grounded" : "unsupported";
    if (verdict === "unsupported") {
      fallbackApplied = true;
      fallbackReason = "missing-citations";
    }
  } else if (unsupportedLabels.length || lexicalGroundingScore < 0.03) {
    verdict = "unsupported";
    fallbackApplied = true;
    fallbackReason = "unsupported-claims";
  } else if (lexicalGroundingScore < 0.08) {
    verdict = "weakly-grounded";
  }

  return {
    enforced: true,
    citationRequired,
    citationsPresent,
    verdict,
    fallbackApplied,
    fallbackReason,
    citedLabels,
    missingLabels: citationsPresent ? [] : retrieval.results.map((result) => result.citationLabel.replace(/[\[\]]/g, "").toUpperCase()),
    unsupportedLabels,
    lexicalGroundingScore,
    notes
  };
}

export function applyGroundedResponsePolicy(
  content: string,
  retrieval: AgentRetrievalSummary | null
): { content: string; verification: AgentGroundedVerification } {
  const verification = verifyGroundedAnswer(content, retrieval);
  if (!verification.fallbackApplied) {
    return {
      content,
      verification
    };
  }

  return {
    content: buildFallbackAnswer(retrieval),
    verification
  };
}

export function listKnowledgeChunks(documentId?: string) {
  const snapshot = readSnapshot();
  return snapshot.chunks
    .filter((chunk) => (documentId ? chunk.documentId === documentId : true))
    .sort((a, b) => {
      if (a.documentId !== b.documentId) return a.documentId.localeCompare(b.documentId);
      return a.order - b.order;
    });
}
