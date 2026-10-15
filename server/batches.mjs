import { basename, extname, dirname, resolve } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildBatchPrompt } from './prompts.mjs';
import { uid, now, day, assert, text, tags, scopes, parseResult, stringList, AppError } from './domain.mjs';

const uploadPath=(store,job)=>resolve(dirname(store.file),'uploads',`${job.id}.${job.extension}`);
export async function createBatch(store,input) {
  const filename=text(input.filename,'文件名',200);
  assert(basename(filename)===filename,'文件名不可包含路径。');
  const extension=extname(filename).slice(1).toLowerCase();
  assert(['pdf','doc','docx'].includes(extension),'支持 PDF、DOC 和 DOCX 题目汇总资料。');
  const scope=input.scope ?? 'mixed';assert(['mixed',...scopes].includes(scope),'请选择导入范围。');
  assert(typeof input.fileBase64==='string' && /^[A-Za-z0-9+/]*={0,2}$/.test(input.fileBase64),'上传内容编码错误。');
  const file=Buffer.from(input.fileBase64,'base64');
  assert(file.length>0 && file.length<=10*1024*1024,'原文件大小应在 0–10 MB 之间。');
  const magic=extension==='pdf' ? file.subarray(0,5).toString()==='%PDF-' : extension==='docx' ? file.subarray(0,2).toString()==='PK' : file.subarray(0,8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));
  assert(magic,'文件内容与扩展名不符。请上传有效的 PDF、DOC 或 DOCX。');
  const id=uid('batch');
  const prompt=buildBatchPrompt({requestId:id,filename,scope:scope==='mixed' ? 'all' : scope});
  const job={id,filename,scope,extension,prompt,createdAt:now(),status:'pending',size:file.length,sha256:createHash('sha256').update(file).digest('hex')};
  const path=uploadPath(store,job);await mkdir(dirname(path),{recursive:true});await writeFile(path,file,{mode:0o600});
  store.insert('batch_jobs',job);return {job,prompt};
}
export async function batchFile(store,id) {
  const job=store.get('batch_jobs',id);assert(job,'原文件不存在。',404);
  try {return {job,file:await readFile(uploadPath(store,job))};} catch {throw new AppError('当前 Mac 上没有此原文件。JSON 备份保留题目，但原文件需另行复制 uploads 文件夹。',404);}
}

export { previewBatch, commitBatch } from './batch-core.mjs';
