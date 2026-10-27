const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}, globals = {}) {
 const code = ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 const sandbox = { exports: {}, require: n => { if (n in mocks) return mocks[n]; throw Error(n); }, TextEncoder, TextDecoder, btoa, atob, AbortController, setTimeout, clearTimeout, console, ...globals };
 vm.runInNewContext(code, sandbox, { filename: file }); return sandbox.exports;
}
(async () => {
 const requests = []; let fail = false, token = 'test-token';
 const { GoogleWorkspaceClient, googleService } = load('src/mcp/google.ts', { './client': { McpHttpError: class extends Error { constructor(m,s) { super(m); this.status=s; } } } }, { fetch: async (url, options) => {
  requests.push({ url, ...options });
  return { ok: !fail, status: fail ? 403 : 200, json: async () => fail ? { error: { message: 'API not enabled' } } : url.includes('format=full') ? { id: 'm1', payload: { mimeType: 'text/plain', body: { data: Buffer.from('Architecture: église').toString('base64url') } } } : url.includes('fields=id,name') ? { id:'f1',name:'Architecture',mimeType:'application/vnd.google-apps.presentation' } : { id:'created' } };
 }});
 assert.equal(googleService('https://gmailmcp.googleapis.com/mcp/v1'),'gmail'); assert.equal(googleService('https://evil.test/drive/v3'),null);
 let binary;
 const gmail = new GoogleWorkspaceClient('https://gmail.googleapis.com','gmail',async()=>token,async()=> '');
 const gt = await gmail.tools(); assert.equal(gt.find(t=>t.name==='create_draft').readOnly,false); assert.equal(gt.find(t=>t.name==='get_message').readOnly,true);
 assert.match(await gmail.call('get_message',{message_id:'m1'}),/église/);
 await gmail.call('search_messages',{query:'from:me architecture'}); assert.match(requests.at(-1).url,/from%3Ame%20architecture/);
 await gmail.call('create_draft',{to:'a@example.com',subject:'Architecture é',body:'Gothic paragraph'});
 const raw=JSON.parse(requests.at(-1).body).message.raw; assert.match(Buffer.from(raw,'base64url').toString(),/Gothic paragraph/);
 const before=requests.length; await assert.rejects(gmail.call('create_draft',{to:'a@example.com\r\nBcc: x@example.com',subject:'a',body:'b'}),/newlines/); assert.equal(requests.length,before);
 await assert.rejects(gmail.call('modify_labels',{message_id:'m1',add_label_ids:'INBOX'}),/array/);
 const drive=new GoogleWorkspaceClient('https://www.googleapis.com/drive/v3','drive',async()=>token,async(...a)=>{binary=a;return 'Slide text';});
 assert.equal(await drive.call('read_file',{file_id:'f1'}),'Slide text'); assert.match(binary[0],/export\?mimeType=/); assert.equal(binary[1],'Architecture.pptx');
 const calendar=new GoogleWorkspaceClient('https://www.googleapis.com/calendar/v3','calendar',async()=>token,async()=> '');
 await assert.rejects(calendar.call('create_event',{calendar_id:'primary',title:'Test',start:'2026-10-27T10:00:00',end:'2026-10-27T11:00:00'}),/timezone/);
 token=null; await assert.rejects(gmail.tools(),e=>e.status===401); token='test'; fail=true; await assert.rejects(drive.tools(),/API not enabled/);
 const {releaseUpdate}=load('src/update-release.ts');
 const release={tag_name:'v0.15.0',html_url:'https://github.com/release',assets:[]};
 assert.equal(releaseUpdate([release],'0.14.0',['arm64-v8a']),null);
 const arm={name:'Neru-arm64-v8a.apk',browser_download_url:'https://example.com/download?id=123',size:42,digest:'sha256:'+'a'.repeat(64)};
 const x86={name:'Neru-x86_64.apk',browser_download_url:'https://example.com/x86.apk'};
 const ready={...release,assets:[x86,arm]}; const update=releaseUpdate([ready],'0.14.0',['arm64-v8a']); assert.equal(update.url,arm.browser_download_url); assert.equal(update.sha256,'a'.repeat(64));
 assert.equal(releaseUpdate([ready],'0.15.0',['arm64-v8a']),null); assert.equal(releaseUpdate([{...ready,draft:true}],'0.14.0',['arm64-v8a']),null); assert.equal(releaseUpdate([ready],'0.14.0',['armeabi-v7a']),null);
 console.log('Google API routing, approvals, MIME export, argument errors, auth failures and APK selection: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
