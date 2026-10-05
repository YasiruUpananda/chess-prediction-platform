import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {Buffer} from 'node:buffer';
const source=ts.transpileModule(readFileSync(new URL('./readerSessionModel.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {restoreReadingSession,compactPageCache}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('parser upgrades preserve reviews and study history, and discard only stale extraction',()=>{
 const migrated=restoreReadingSession({version:1,extractionVersion:'old',timeline:['e2e4'],pages:{'1':{reviewed:true},'2':{reviewed:false}}},'new');
 assert.deepEqual(migrated.timeline,['e2e4']);assert.ok(migrated.pages['1']);assert.equal(migrated.pages['2'],undefined);
 const pages={'1':{reviewed:true},'2':{},'3':{}};compactPageCache(pages,3,0);
 assert.ok(pages['1']);assert.ok(pages['3']);assert.equal(pages['2'],undefined);
});
