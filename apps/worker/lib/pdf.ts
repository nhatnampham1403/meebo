import { PDFParse } from 'pdf-parse';

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text.trim();
  } catch (err) {
    throw new Error(
      `PDF parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
