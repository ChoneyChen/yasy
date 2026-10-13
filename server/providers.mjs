import { buildPrompt, resultSchema } from './prompts.mjs';
import { AppError } from './domain.mjs';

/** Provider boundary: future automation may return the same resultSchema;
 * imported output must still pass the store's task, scope and integrity checks. */
export class WebBridgeProvider {
  id='web-bridge';
  automated=false;
  prepare(input) {return {prompt:buildPrompt(input),url:'https://chatgpt.com/',resultSchema,requiresUserSubmission:true};}
  async generate() {throw new AppError('网页桥需手动提交与导入。全自动 provider 尚未配置。',501);}
}
export const providers = new Map([['web-bridge',new WebBridgeProvider()]]);
export function getProvider(id) {const provider=providers.get(id);if(!provider) throw new AppError('AI provider 尚未配置。',503);return provider;}
