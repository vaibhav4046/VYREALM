import { promises as fs } from 'node:fs';
import path from 'node:path';
import { youtubeError } from './youtube-errors.mjs';

const CLIENT_ID=/^[A-Za-z0-9_-]{3,200}\.apps\.googleusercontent\.com$/;
const MAX_BYTES=16384;
const fields=new Set(['client_id','client_secret','project_id','auth_uri','token_uri','auth_provider_x509_cert_url','redirect_uris']);
const invalid=()=>youtubeError('YOUTUBE_PUBLISHER_CONFIGURATION_INVALID','The app\'s Desktop sign-in registration is invalid or unavailable. Repair the application or use a valid Desktop registration in advanced settings.');
const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype);

/** Release-only native client identification, never a user token or confidential Web registration. */
export function validatePublisherDesktopConfig(value){
 if(!object(value)||Object.keys(value).length!==1||!object(value.installed))throw invalid();
 const installed=value.installed;
 if(Object.keys(installed).some(key=>!fields.has(key))||!CLIENT_ID.test(installed.client_id||'')||typeof installed.client_secret!=='string'||!installed.client_secret||installed.client_secret.length>4096||/[\s\u0000-\u001f\u007f]/.test(installed.client_secret))throw invalid();
 if(installed.project_id!==undefined&&(typeof installed.project_id!=='string'||!/^[a-z][a-z0-9-]{4,100}$/.test(installed.project_id)))throw invalid();
 const urls={auth_uri:['https://accounts.google.com/o/oauth2/auth','https://accounts.google.com/o/oauth2/v2/auth'],token_uri:['https://oauth2.googleapis.com/token'],auth_provider_x509_cert_url:['https://www.googleapis.com/oauth2/v1/certs']};
 for(const [field,allowed] of Object.entries(urls))if(installed[field]!==undefined&&!allowed.includes(installed[field]))throw invalid();
 if(installed.redirect_uris!==undefined){
  if(!Array.isArray(installed.redirect_uris)||!installed.redirect_uris.length||installed.redirect_uris.length>8)throw invalid();
  for(const value of installed.redirect_uris){
   if(typeof value!=='string'||value.length>512)throw invalid();
   let uri;try{uri=new URL(value);}catch{throw invalid();}
   if(uri.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(uri.hostname)||uri.username||uri.password||uri.search||uri.hash||uri.pathname!=='/')throw invalid();
  }
 }
 // Endpoint/redirect metadata is checked above, but never changes the client's fixed destinations.
 return {installed:{client_id:installed.client_id,client_secret:installed.client_secret}};
}

export async function readPublisherDesktopConfig(filePath){
 if(typeof filePath!=='string'||!path.isAbsolute(filePath))throw invalid();
 let file;
 try{
  const stat=await fs.lstat(filePath);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<2||stat.size>MAX_BYTES)throw invalid();
  file=await fs.open(filePath,'r');const opened=await file.stat();if(!opened.isFile()||opened.dev!==stat.dev||opened.ino!==stat.ino)throw invalid();
  const buffer=Buffer.alloc(MAX_BYTES+1);try{const {bytesRead}=await file.read(buffer,0,buffer.length,0);if(bytesRead>MAX_BYTES)throw invalid();return validatePublisherDesktopConfig(JSON.parse(buffer.subarray(0,bytesRead).toString('utf8')));}finally{buffer.fill(0);}
 }catch{throw invalid();}finally{await file?.close();}
}

/** Only fresh profiles bootstrap; a retained account/configuration is never migrated implicitly. */
export async function bootstrapPublisherDesktopConfig({publisherConfigPath,configurationPath,vault,clientFactory}){
 const exists=async()=>{try{await fs.lstat(configurationPath);return true;}catch(error){if(error.code==='ENOENT')return false;throw invalid();}};
 if(await exists())return {applied:false};
 const credentials=await readPublisherDesktopConfig(publisherConfigPath);
 await fs.mkdir(path.dirname(configurationPath),{recursive:true});
 const lockPath=`${configurationPath}.bootstrap.lock`;let lock;
 try{
  try{lock=await fs.open(lockPath,'wx',0o600);}catch{throw youtubeError('YOUTUBE_PUBLISHER_CONFIGURATION_BUSY','Desktop sign-in setup is already in progress or was interrupted. Restart or repair the application before retrying.');}
  if(await exists())return {applied:false};
  const existing=await vault.read();
  if(!object(existing)||Object.keys(existing).length)throw youtubeError('YOUTUBE_PUBLISHER_PROFILE_EXISTS','Existing protected account data needs its original registration restored. Automatic setup has preserved it unchanged.');
  const clientId=credentials.installed.client_id,client=clientFactory({clientId,vault});
  await client.configureDesktopCredentials(credentials);
  // Exclusive creation is intentional: bootstrap cannot replace an independently configured profile.
  await fs.writeFile(configurationPath,JSON.stringify({schemaVersion:1,clientId,type:'desktop',registrationSource:'bundled'}),{flag:'wx',mode:0o600});
  return {applied:true,clientId,client,registrationSource:'bundled'};
 }finally{if(lock){await lock.close();await fs.unlink(lockPath).catch(error=>{if(error.code!=='ENOENT')throw error;});}}
}
