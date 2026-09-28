import { launchBrowser } from './browser.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root=process.cwd();
const srv=http.createServer((q,s)=>{let p=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(fs.existsSync(p)&&fs.statSync(p).isFile()){s.setHeader('content-type',p.endsWith('.js')?'text/javascript':p.endsWith('.html')?'text/html':'application/octet-stream');fs.createReadStream(p).pipe(s)}else{s.statusCode=404;s.end()}}).listen(0);
const port=srv.address().port;
const b=await launchBrowser({args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--hide-scrollbars']});
try{
const p=await b.newPage();await p.setViewport({width:400,height:300});
p.on('pageerror',e=>console.log('ERR',String(e)));p.on('console',m=>console.log('CON',m.text()));
await p.goto(`http://127.0.0.1:${port}/tools/smoke.html`,{waitUntil:'networkidle0'});
await p.waitForFunction('window.__ready===true',{timeout:60000});
await p.screenshot({path:'tools/smoke.png'});console.log('ok');
}finally{await b.close();srv.close();}
