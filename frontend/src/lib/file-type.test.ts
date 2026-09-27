import { expect, it } from "vitest";
import { getFileTypeLabel, getSelectedFileTypeLabel } from "./file-type";

it("uses validated MIME and original extension to identify file formats", () => {
  expect(getFileTypeLabel("photo.PNG", "image/png")).toBe("PNG image");
  expect(getFileTypeLabel("report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("Word (DOCX)");
  expect(getFileTypeLabel("data.csv", "text/csv; charset=utf-8")).toBe("CSV data");
  expect(getFileTypeLabel("notes.md", "text/markdown; charset=utf-8")).toBe("Markdown document");
  expect(getFileTypeLabel("notes.md", "text/plain; charset=utf-8")).toBe("Markdown document");
  expect(getFileTypeLabel("wrong.png", "application/pdf")).toBe("PDF document");
  expect(getFileTypeLabel("assets.zip", "application/pdf")).toBe("PDF document");
  expect(getFileTypeLabel("unknown.bin", "application/octet-stream")).toBe("Other file");
});

it("uses the selected file extension for provisional labels across supported formats", () => {
  expect(getSelectedFileTypeLabel("assets.ZIP", "application/x-zip-compressed")).toBe("ZIP archive");
  expect(getSelectedFileTypeLabel("data.csv", "application/vnd.ms-excel")).toBe("CSV data");
  expect(getSelectedFileTypeLabel("report.docx", "application/octet-stream")).toBe("Word (DOCX)");
  expect(getSelectedFileTypeLabel("photo.png", "image/jpeg")).toBe("PNG image");
  expect(getSelectedFileTypeLabel("unknown.bin", "application/pdf")).toBe("PDF document");
  expect(getSelectedFileTypeLabel("unknown.bin", "application/octet-stream")).toBe("Other file");
});
