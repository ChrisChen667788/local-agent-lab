export function sanitizeDisplayPath(input?: string | null): string {
  if (!input) return "";
  return input
    .replace(/^\/Users\/[^/]+/, "~")
    .replace(/^\/home\/[^/]+/, "~")
    .replace(/^C:\\Users\\[^\\]+/i, "~");
}
