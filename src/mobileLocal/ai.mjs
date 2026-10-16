import { buildIOSPrompt, answerSystem } from './prompts.mjs';
import { AppError, assert, parseAPIContent } from '../../server/domain.mjs';
import { nativeCall } from './native';
export async function localProvider(call = nativeCall) {
  const config = await call('ai.config.get');
  // This is an opaque capability marker, never an API credential. Only Swift
  // reads the Keychain and attaches the actual Authorization header.
  const marker = config.hasKey ? 'native-keychain-capability' : '';
  const redact = value => String(value ?? '').replace(/sk-[A-Za-z0-9_.-]{8,}/g, '[redacted]').slice(0, 1200);
  const provider = {
    config: { public: () => config, secret: () => ({ apiKey: marker, model: config.model }), redact },
    prepare: input => ({ prompt: buildIOSPrompt(input), requiresUserSubmission: false }),
    request: async (path, { body } = {}) => {
      assert(path === '/chat/completions', '手机客户端仅允许既定的 AI 处理路径。');
      return call('ai.completions', body);
    },
    generate: async job => {
      assert(config.configured, '请先在 iPhone 的偏好与数据中配置 API 密钥与模型。', 503);
      const response = await call('ai.completions', { model: config.model, stream: false, max_tokens: 8192,
        messages: [{ role: 'system', content: answerSystem }, { role: 'user', content: job.prompt }] });
      const choice = response.choices?.[0];
      assert(choice?.message && choice.finish_reason !== 'length', '模型未返回完整答案，未保存。请检查任务后手动重试。', 502);
      const usage = response.usage ? Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens'].filter(key => typeof response.usage[key] === 'number' && Number.isFinite(response.usage[key])).map(key => [key, response.usage[key]])) : undefined;
      return { result: parseAPIContent(choice.message.content, '答案整理'), model: redact(typeof response.model === 'string' ? response.model : config.model), usage };
    },
  };
  return provider;
}
