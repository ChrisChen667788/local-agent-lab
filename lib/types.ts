export type SuggestedAction = "deep_read" | "skim" | "ignore";

export type FeedItem = {
  id: string;
  title: string;
  source: string;
  link: string;
  tags: string[];
  shortSummary: string;
  longSummary: string;
  valueScore: number;
  suggestedAction: SuggestedAction;
};

export type SessionSummary = {
  durationMinutes: number;
  newItems: number;
  deepReadCount: number;
  ignorableCount: number;
};
