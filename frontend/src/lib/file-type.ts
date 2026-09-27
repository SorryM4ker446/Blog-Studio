const typesByExtension: Record<string, { mime: string; label: string }> = {
  jpg: { mime: "image/jpeg", label: "JPEG image" },
  jpeg: { mime: "image/jpeg", label: "JPEG image" },
  png: { mime: "image/png", label: "PNG image" },
  gif: { mime: "image/gif", label: "GIF image" },
  webp: { mime: "image/webp", label: "WebP image" },
  pdf: { mime: "application/pdf", label: "PDF document" },
  txt: { mime: "text/plain", label: "Text document" },
  md: { mime: "text/markdown", label: "Markdown document" },
  csv: { mime: "text/csv", label: "CSV data" },
  json: { mime: "application/json", label: "JSON data" },
  zip: { mime: "application/zip", label: "ZIP archive" },
  doc: { mime: "application/msword", label: "Word (DOC)" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word (DOCX)" },
  xls: { mime: "application/vnd.ms-excel", label: "Excel (XLS)" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Excel (XLSX)" },
  ppt: { mime: "application/vnd.ms-powerpoint", label: "PowerPoint (PPT)" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", label: "PowerPoint (PPTX)" },
};

export function getFileTypeLabel(filename: string, mimeType: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() || "";
  const mime = mimeType.split(";")[0].trim().toLowerCase();
  const known = typesByExtension[extension];
  if (known && (!mime || known.mime === mime)) return known.label;
  if (known && mime === "text/plain" && (extension === "md" || extension === "csv")) return known.label;

  const fromMime = Object.values(typesByExtension).find(type => type.mime === mime);
  if (fromMime) return fromMime.label;
  if (mime.startsWith("image/")) return "Image";
  if (mime.startsWith("text/")) return "Text document";
  return "Other file";
}

export function getSelectedFileTypeLabel(filename: string, mimeType: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() || "";
  return typesByExtension[extension]?.label || getFileTypeLabel(filename, mimeType);
}
