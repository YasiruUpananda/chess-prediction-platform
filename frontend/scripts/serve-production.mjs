import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import process from 'node:process';

const root = resolve('dist');
const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json' };
createServer((request,response) => {
  if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
  let path;
  try { path = decodeURIComponent(new URL(request.url,'http://localhost').pathname); }
  catch { response.writeHead(400).end(); return; }
  let file = resolve(root,'.' + path);
  if (!file.startsWith(root + sep) && file !== root) { response.writeHead(403).end(); return; }
  const asset = path.startsWith('/assets/');
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (asset || extname(path)) { response.writeHead(404).end(); return; }
    file = resolve(root,'index.html');
  }
  const original = file;
  const accepted = request.headers['accept-encoding'] || '';
  const encoding = ['br','gzip'].find((value) => accepted.split(',').some((entry) => entry.trim().split(';')[0] === value && !/q=0(?:\.0*)?$/.test(entry)) && existsSync(file + (value === 'br' ? '.br' : '.gz')));
  if (encoding) file += encoding === 'br' ? '.br' : '.gz';
  response.writeHead(200,{ 'Content-Type': types[extname(original)] || 'application/octet-stream',
    'Cache-Control': asset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Vary':'Accept-Encoding', ...(encoding ? {'Content-Encoding':encoding} : {}), 'Content-Length':statSync(file).size });
  if (request.method === 'HEAD') response.end(); else createReadStream(file).pipe(response);
}).listen(Number(process.env.PORT || 4173),'127.0.0.1');
