const storedFileURLPattern = /(https?:\/\/[^/\s)]+)?\/api\/files\/(\d+)\/(?:download|view)\b/gi;

export function rebaseFileViewURLs(value: string, browserAPIBase: string): string {
  if (!value) {
    return value;
  }
  const base = browserAPIBase.replace(/\/$/, "");
  return value.replace(storedFileURLPattern, (_match, origin: string | undefined, fileID: string) => {
    const targetBase = origin ? base : "/api";
    return `${targetBase}/files/${fileID}/view`;
  });
}
