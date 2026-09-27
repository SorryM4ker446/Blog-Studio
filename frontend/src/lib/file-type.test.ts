import { expect, it } from "vitest";
import { getFileTypeLabel } from "./file-type";

it("uses validated MIME and original extension to identify file formats", () => {
  expect(getFileTypeLabel("photo.PNG", "image/png")).toBe("PNG image");
  expect(getFileTypeLabel("report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("Word (DOCX)");
  expect(getFileTypeLabel("data.csv", "text/csv; charset=utf-8")).toBe("CSV data");
  expect(getFileTypeLabel("notes.md", "text/markdown; charset=utf-8")).toBe("Markdown document");
  expect(getFileTypeLabel("notes.md", "text/plain; charset=utf-8")).toBe("Markdown document");
  expect(getFileTypeLabel("wrong.png", "application/pdf")).toBe("PDF document");
  expect(getFileTypeLabel("unknown.bin", "application/octet-stream")).toBe("Other file");
});
