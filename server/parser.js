import { readFile } from 'node:fs/promises';
import mammoth from 'mammoth';
import { aiEnabled, generate, aiSelection, providers } from './ai.js';
import { fail } from './domain.js';

export async function parseCv(filePath, filename, allowAi, selection=aiSelection()) {
  const buffer = Buffer.isBuffer(filePath) ? filePath : await readFile(filePath);
  let text = '';
  if (/\.pdf$/i.test(filename)) {
    if (buffer.subarray(0,5).toString() !== '%PDF-') fail(422,'File contents do not match PDF extension.');
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try { text = (await parser.getText({ pageJoiner: '\n' })).text; } finally { await parser.destroy(); }
    if (text.replace(/--\s*\d+\s*of\s*\d+\s*--/g,'').trim().length < 50) {
      if (!aiEnabled(selection) || !allowAi || !providers[selection.provider].pdf) return { text:'', needsReview:true, message:selection.provider==='groq'?'Scanned PDF: Groq text scoring needs a verified transcript. No other provider was contacted.':'Scanned PDF: add a verified transcript, or enable AI and record consent for the selected provider before retrying.' };
      const result = await generate('Transcribe this scanned CV faithfully as {"text":"plain text with original line breaks"}. Do not infer or summarize. Mark illegible words [unreadable].', { task:'Consent-based CV transcription' },buffer,selection);
      if (typeof result.text !== 'string' || result.text.trim().length < 50 || result.text.length > 100000) fail(422,'OCR could not read this CV. Add a verified transcript.');
      return { text:result.text, needsReview:true, message:'AI transcription requires recruiter verification before scoring.' };
    }
  } else if (/\.docx$/i.test(filename)) {
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) fail(422,'File contents do not match DOCX extension.');
    // Bound decompressed XML to avoid processing ZIP bombs disguised as CVs.
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(buffer);
    let expanded = 0;
    for (const entry of Object.values(zip.files)) {
      expanded += entry._data?.uncompressedSize || 0;
      if (expanded > 32 * 1024 * 1024) fail(422,'DOCX expanded size exceeds 32 MB.');
    }
    if (!zip.file('word/document.xml')) fail(422,'This ZIP is not a Word document.');
    text = (await mammoth.extractRawText({ buffer })).value;
  } else fail(422,'Only PDF and DOCX are supported.');
  text = text.replace(/\u0000/g,'').trim();
  if (text.length > 100000) fail(422,'CV text exceeds 100,000 characters. Split this document.');
  if (text.length < 30) return { text, needsReview:true, message:'Insufficient text. Add a verified transcript before scoring.' };
  return { text, needsReview:false };
}
