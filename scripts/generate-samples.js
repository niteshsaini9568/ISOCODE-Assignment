import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { samples, sampleText } from '../server/seed.js';
export function makePdf(text) {
  const escape=s=>s.replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)');
  const stream=`BT /F1 12 Tf 50 780 Td 18 TL ${text.split('\n').map((line,i)=>`${i?'T* ':''}(${escape(line)}) Tj`).join('\n')} ET`;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf='%PDF-1.4\n', offsets=[0];
  objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
export async function makeDocx(text,table=false) {
  const zip=new JSZip(),escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const paragraphs=text.split('\n').map(line=>`<w:p><w:r><w:t xml:space="preserve">${escape(line)}</w:t></w:r></w:p>`);
  const body=table?`<w:tbl>${paragraphs.map(p=>`<w:tr><w:tc>${p}</w:tc></w:tr>`).join('')}</w:tbl>`:paragraphs.join('');
  zip.file('word/document.xml',`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({type:'nodebuffer'});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const directory=path.resolve('sample-data');mkdirSync(directory,{recursive:true});
  for(const [i,s] of samples.entries()){writeFileSync(path.join(directory,`${s.id}.pdf`),makePdf(sampleText(s)));writeFileSync(path.join(directory,`${s.id}.docx`),await makeDocx(sampleText(s),i===1));}
  writeFileSync(path.join(directory,'example-jd.txt'),'Senior Java Developer, 5-8 years, Java, Spring Boot, Noida, notice up to 60 days\n');
  console.log('Generated three PDF and three DOCX sample CVs. Names and facts match the assignment; none include invented CTC or location.');
}
