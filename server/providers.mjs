import { buildPrompt, resultSchema } from './prompts.mjs';
import { AppError } from './domain.mjs';
import { IIIAPIProvider } from './iiiapi.mjs';

/** Provider boundary: future automation may return the same resultSchema;
 * imported output must still pass the store's task, scope and integrity checks. */
export class WebBridgeProvider {
  id='web-bridge';
  automated=false;
  prepare(input) {return {prompt:buildPrompt(input),url:'https://chatgpt.com/',resultSchema,requiresUserSubmission:true};}
  async generate() {throw new AppError('网页桥需手动提交与导入。自动整理请切换至 iiiapi API。',501);}
}
export const providers = new Map([['web-bridge',new WebBridgeProvider()],['iiiapi',new IIIAPIProvider()]]);
export function getProvider(id) {const provider=providers.get(id);if(!provider) throw new AppError('AI provider 尚未配置。',503);return provider;}
