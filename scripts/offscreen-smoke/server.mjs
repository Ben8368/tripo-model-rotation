import {build} from 'esbuild';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const output=await build({entryPoints:[fileURLToPath(new URL('./smoke.ts',import.meta.url))],bundle:true,format:'iife',write:false});
const html='<!doctype html><title>Offscreen smoke</title><style>body{background:#222;color:#eee;font:16px monospace;padding:24px}img{width:256px;border:1px solid #777}pre{line-height:1.8}</style><h1>Independent renderer smoke test</h1><div id="frames"></div><pre>Running…</pre><script src="/smoke.js"></script>';
http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/smoke.js'?'application/javascript':'text/html');res.end(req.url==='/smoke.js'?output.outputFiles[0].text:html);}).listen(0,'127.0.0.1',function(){console.log('Open http://127.0.0.1:'+this.address().port+' in a Chromium browser. Ctrl+C to stop.');});
