// CC0, source-authored PDF fixtures. No publisher book pages are redistributed.
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const directory=fileURLToPath(new URL('../benchmarks/pdf/documents/',import.meta.url));
mkdirSync(directory,{recursive:true});
function pdf(name,pages,custom=false) {
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',''];
 const add=value=>{objects.push(value);return objects.length;};
 const font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
 let figurine;
 if(custom) {
  const shape='600 0 0 0 600 800 d1 80 0 m 520 0 l 520 100 l 80 100 l f 140 120 m 500 120 l 480 250 l 380 450 l 540 500 l 480 700 l 350 800 l 280 720 l 200 640 l 140 350 l h f';
  const proc=add(`<< /Length ${shape.length} >>\nstream\n${shape}\nendstream`);
  const cmap=' /CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /NeuroChess def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <58> <0058> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end';
  const unicode=add(`<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`);
  figurine=add(`<< /Type /Font /Subtype /Type3 /FontBBox [0 0 600 800] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /knight ${proc} 0 R >> /Encoding << /Type /Encoding /Differences [88 /knight] >> /FirstChar 88 /LastChar 88 /Widths [600] /Resources << >> /ToUnicode ${unicode} 0 R >>`);
 }
 const kids=[];
 for(const rows of pages) {
  const content=rows.map(({text,x=30,y=720})=>{
    const escape=value=>value.replace(/[\\()]/g,'\\$&');
    if(custom && text.includes('X'))return `BT /F1 16 Tf ${x} ${y} Td ${text.split('X').map((part,index)=>`${index?'/F2 16 Tf (X) Tj /F1 16 Tf ':''}(${escape(part)}) Tj`).join(' ')} ET`;
    return `BT /F1 16 Tf ${x} ${y} Td (${escape(text)}) Tj ET`;
  }).join('\n');
  const stream=add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 ${font} 0 R ${figurine?'/F2 '+figurine+' 0 R':''} >> >> /Contents ${stream} 0 R >>`));
 }
 objects[1]=`<< /Type /Pages /Kids [${kids.map(id=>id+' 0 R').join(' ')}] /Count ${kids.length} >>`;
 let result='%PDF-1.4\n';const offsets=[];
 objects.forEach((object,index)=>{offsets.push(result.length);result+=`${index+1} 0 obj\n${object}\nendobj\n`;});
 const xref=result.length;
 result+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(offset=>String(offset).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 writeFileSync(directory+name,result);
}
pdf('commentary.pdf',[[{text:'1.e4 e5 Commentary about central play. 2.Nf3 Nc6'},{text:'The alternative 2...Nf6',y:680}]]);
pdf('columns.pdf',[[{text:'1.e4 e5',x:30},{text:'2.Nf3 Nc6',x:30,y:690},{text:'3.Bb5 a6',x:30,y:660},{text:'1.d4 d5',x:330},{text:'2.c4 e6',x:330,y:690},{text:'3.Nc3 Nf6',x:330,y:660}]]);
pdf('continuation.pdf',[[{text:'1.e4 e5 2.Nf3 (2.Bc4 Nc6) Nc6'}],[{text:'3.Bb5 a6 The alternative 3...Nf6'}]]);
pdf('figurine.pdf',[[{text:'1.e4 e5 2.Xf3 Xc6'}]],true);
