import type { AgentFineTuneUpstreamDatasetCandidate } from "@/lib/agent/types";

type HuggingFaceDatasetRecord = {
  id?: string;
  description?: string;
  lastModified?: string;
  tags?: string[];
  downloads?: number;
};

type GitHubRepoRecord = {
  full_name?: string;
  name?: string;
  description?: string;
  html_url?: string;
  homepage?: string | null;
  updated_at?: string;
  topics?: string[];
};

type ModelScopeDatasetRecord = {
  Name?: string;
  ChineseName?: string;
  Path?: string;
  Description?: string;
  LastModifiedTime?: string;
  UpdatedAt?: string;
  GmtModified?: string;
  Tags?: string[];
  InstanceCount?: number;
  RecordCount?: number;
};

function truncateText(value: string | undefined, maxLength = 180) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function uniqueTags(...groups: Array<string[] | undefined>) {
  return Array.from(
    new Set(
      groups
        .flatMap((group) => group || [])
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ).slice(0, 8);
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function scanHuggingFaceDatasets(query: string) {
  const url = new URL("https://huggingface.co/api/datasets");
  url.searchParams.set("search", query);
  url.searchParams.set("limit", "6");
  url.searchParams.set("sort", "lastModified");
  url.searchParams.set("direction", "-1");
  const payload = await fetchJson<HuggingFaceDatasetRecord[]>(url.toString(), {
    headers: {
      "User-Agent": "FirstLLMStudio/0.3"
    },
    cache: "no-store"
  });
  return payload
    .map((entry) => {
      if (!entry.id) return null;
      const tags = uniqueTags(entry.tags);
      return {
        id: `huggingface:${entry.id.toLowerCase()}`,
        source: "huggingface" as const,
        label: entry.id.split("/").pop() || entry.id,
        repoId: entry.id,
        repoUrl: `https://huggingface.co/datasets/${entry.id}`,
        docsUrl: `https://huggingface.co/datasets/${entry.id}`,
        summary: truncateText(entry.description) || `${entry.id} · ${tags.join(" · ")}`,
        updatedAt: entry.lastModified,
        // The Hugging Face search API exposes downloads here, not dataset row
        // count. Keep this unknown so the UI does not mislabel popularity as
        // trainable sample volume.
        sampleCount: null,
        tags
      } satisfies AgentFineTuneUpstreamDatasetCandidate;
    })
    .filter(isDefined);
}

async function scanGitHubDatasets(query: string) {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", `${query} dataset finetune jsonl in:name,description,topics`);
  url.searchParams.set("sort", "updated");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", "4");
  const payload = await fetchJson<{ items?: GitHubRepoRecord[] }>(url.toString(), {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "FirstLLMStudio/0.3"
    },
    cache: "no-store"
  });
  return (payload.items || [])
    .map((entry) => {
      if (!entry.full_name || !entry.html_url) return null;
      const tags = uniqueTags(entry.topics);
      return {
        id: `github:${entry.full_name.toLowerCase()}`,
        source: "github" as const,
        label: entry.name || entry.full_name.split("/").pop() || entry.full_name,
        repoId: entry.full_name,
        repoUrl: entry.html_url,
        docsUrl: entry.homepage || entry.html_url,
        summary: truncateText(entry.description) || `${entry.full_name} · ${tags.join(" · ")}`,
        updatedAt: entry.updated_at,
        sampleCount: null,
        tags
      } satisfies AgentFineTuneUpstreamDatasetCandidate;
    })
    .filter(isDefined);
}

async function scanModelScopeDatasets(query: string) {
  const url = new URL("https://www.modelscope.cn/openapi/v1/datasets");
  url.searchParams.set("page_number", "1");
  url.searchParams.set("page_size", "6");
  url.searchParams.set("search", query);
  url.searchParams.set("sort", "last_modified");
  const payload = await fetchJson<{ datasets?: ModelScopeDatasetRecord[] }>(url.toString(), {
    headers: {
      "User-Agent": "FirstLLMStudio/0.3"
    },
    cache: "no-store"
  });
  return (payload.datasets || [])
    .map((entry) => {
      if (!entry.Path || !entry.Name) return null;
      const repoId = `${entry.Path}/${entry.Name}`;
      const tags = uniqueTags(entry.Tags);
      return {
        id: `modelscope:${repoId.toLowerCase()}`,
        source: "modelscope" as const,
        label: entry.ChineseName?.trim() || entry.Name,
        repoId,
        repoUrl: `https://www.modelscope.cn/datasets/${repoId}`,
        docsUrl: `https://www.modelscope.cn/datasets/${repoId}`,
        summary: truncateText(entry.Description) || `${repoId} · ${tags.join(" · ")}`,
        updatedAt: entry.LastModifiedTime || entry.UpdatedAt || entry.GmtModified,
        sampleCount:
          typeof entry.RecordCount === "number"
            ? entry.RecordCount
            : typeof entry.InstanceCount === "number"
              ? entry.InstanceCount
              : null,
        tags
      } satisfies AgentFineTuneUpstreamDatasetCandidate;
    })
    .filter(isDefined);
}

function rankCandidate(candidate: AgentFineTuneUpstreamDatasetCandidate) {
  const freshness = candidate.updatedAt ? Date.parse(candidate.updatedAt) / 1_000_000_000_000 : 0;
  const sampleWeight = typeof candidate.sampleCount === "number" ? Math.log10(candidate.sampleCount + 1) : 0;
  return freshness + sampleWeight;
}

export async function discoverFineTuneUpstreamDatasets(queryInput: string) {
  const query = queryInput.trim();
  if (!query) {
    throw new Error("Dataset discovery query is required.");
  }
  const [huggingface, github, modelscope] = await Promise.allSettled([
    scanHuggingFaceDatasets(query),
    scanGitHubDatasets(query),
    scanModelScopeDatasets(query)
  ]);
  return [
    ...(huggingface.status === "fulfilled" ? huggingface.value : []),
    ...(github.status === "fulfilled" ? github.value : []),
    ...(modelscope.status === "fulfilled" ? modelscope.value : [])
  ]
    .sort((left, right) => rankCandidate(right) - rankCandidate(left))
    .slice(0, 12);
}
