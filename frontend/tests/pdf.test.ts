import PDFDocument from 'pdfkit';
import { processPDF } from '@/lib/pdf';

jest.mock('@/lib/auth', () => ({ getCurrentUserId: jest.fn() }));

async function fixture() {
  const pdf = new PDFDocument();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => {
    pdf.on('data', (b: Buffer) => chunks.push(b));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
  });
  pdf.text('Production PDF parsing test');
  pdf.end();
  return new File([new Uint8Array(await done)], 'research.pdf', {
    type: 'application/pdf',
  });
}
test('extracts real PDF text and safe page metadata in an isolated worker', async () => {
  const docs = await processPDF(await fixture());
  expect(docs[0].pageContent).toContain('Production PDF parsing test');
  expect(docs[0].metadata).toMatchObject({
    filename: 'research.pdf',
    source: 'research.pdf',
    loc: { pageNumber: 1 },
  });
}, 40000);
test('rejects disguised files and supports cancellation', async () => {
  await expect(
    processPDF(new File(['not a pdf'], 'fake.pdf')),
  ).rejects.toMatchObject({ status: 422 });
  const controller = new AbortController();
  controller.abort();
  await expect(
    processPDF(await fixture(), controller.signal),
  ).rejects.toMatchObject({ status: 408 });
});
