export function buildJsonlBlob(lines: string[]): Blob {
  return new Blob(lines, { type: "application/x-ndjson" });
}

export function downloadJsonlFile(filename: string, lines: string[]): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  const blob = buildJsonlBlob(lines);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
