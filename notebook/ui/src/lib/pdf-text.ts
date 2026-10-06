// The text of a PDF, read in the browser with pdf.js, page by page ("Page N"
// lines between pages): what the notebook keeps and searches for an uploaded
// PDF even without a model that reads PDFs. Empty for a scanned PDF.
export async function extractPdfText(file: Blob, { maxPages = 300, maxChars = 1_000_000 } = {}): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  try {
    let text = "";
    for (let n = 1; n <= Math.min(pdf.numPages, maxPages) && text.length < maxChars; n++) {
      const page = await pdf.getPage(n), content = await page.getTextContent();
      text += "\nPage " + n + "\n" + content.items.map((item: any) => item.str || "").join(" ");
    }
    return text.slice(0, maxChars).trim();
  } finally {
    await pdf.destroy();
  }
}
