import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
export async function streamLocalMedia(req,res,path,mime){
 if(!['GET','HEAD'].includes(req.method))return res.writeHead(405).end();
 let info;try{info=await stat(path);}catch{return res.writeHead(404).end();}
 if(!info.isFile())return res.writeHead(404).end();
 const headers={'Content-Type':mime||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'private, max-age=0','X-Content-Type-Options':'nosniff'};
 let start=0,end=info.size-1,status=200;
 if(req.headers.range){
  const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if(!range||(!range[1]&&!range[2]))return res.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();
  if(!range[1])start=Math.max(0,info.size-Number(range[2]));else{start=Number(range[1]);if(range[2])end=Math.min(end,Number(range[2]));}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=info.size)return res.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();
  status=206;headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;
 }
 headers['Content-Length']=Math.max(0,end-start+1);res.writeHead(status,headers);
 if(req.method==='HEAD'||info.size===0)return res.end();
 const stream=createReadStream(path,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
}
