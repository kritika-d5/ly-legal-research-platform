/**
 * Text out of a document the user picks, read entirely in the browser: client
 * documents (an FIR, a bail order) are confidential, so the file itself is
 * never uploaded — only the text the user then chooses to analyse.
 *
 * PDFs go through pdf.js, which react-pdf already bundles for the judgment
 * viewer. A scanned PDF has no text layer; that comes back as an empty string
 * and the caller says so, since OCR is out of scope here.
 */
import { pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export const ACCEPTED_DOCUMENTS = '.pdf,.txt,.md,application/pdf,text/plain';

export async function documentText(file: File): Promise<string> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    }
    return pages.join('\n\n').replace(/[ \t]+/g, ' ').trim();
  }
  return (await file.text()).trim();
}
