import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { parseCv } from '../server/parser.js';
import { makeDocx } from '../scripts/generate-samples.js';
test('parser: invalid Word archives, expanded-size and extracted-text limits fail safely', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'shortlist-parser-test-'));
  try {
    const file = path.join(directory, 'fixture.docx'),
      zip = new JSZip();
    zip.file('unrelated.txt', 'Not a Word document');
    await writeFile(file, await zip.generateAsync({
      type: 'nodebuffer'
    }));
    await assert.rejects(parseCv(file, 'fixture.docx', false), /not a Word document/);
    zip.file('word/document.xml', 'x'.repeat(33 * 1024 * 1024));
    await writeFile(file, await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE'
    }));
    await assert.rejects(parseCv(file, 'fixture.docx', false), /expanded size exceeds/);
    await writeFile(file, await makeDocx('x'.repeat(100001)));
    await assert.rejects(parseCv(file, 'fixture.docx', false), /100,000 characters/);
    await assert.rejects(parseCv(file, 'fixture.txt', false), /Only PDF and DOCX/);
  } finally {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert(path.basename(directory).startsWith('shortlist-parser-test-'));
    await rm(directory, {
      recursive: true,
      force: true
    });
  }
});
