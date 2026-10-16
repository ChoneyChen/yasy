import { buildIOSIdeaPrompt, ideaSystem } from './prompts.mjs';
import { assert, AppError, text, stringList, parseAPIContent } from '../../server/domain.mjs';

/** An independent preview: one call, with no draft/answer/material writes. */
export async function draftIOSIdea(store, provider, input) {
  const question = store.question(input.questionId);
  assert(question.active !== false, '归档题目仅可查看。', 409);
  const textZh = text(input.textZh ?? '', '已有中文素材', 20000, true);
  assert(provider.config.public('iiiapi').configured, '请先在 iPhone 设置中配置 API 密钥与模型。', 503);
  const { apiKey, model } = provider.config.secret();
  try {
    const response = await provider.request('/chat/completions', { credential: apiKey, body: { model, stream: false, max_tokens: 4096,
      messages: [{ role: 'system', content: ideaSystem }, { role: 'user', content: buildIOSIdeaPrompt({ question, textZh }) }] } });
    const choice = response.choices?.[0];
    assert(choice?.message && choice.finish_reason !== 'length', '中文素材未完整返回，请重试。', 502);
    const result = parseAPIContent(choice.message.content, '中文素材助写');
    assert(![apiKey, provider.config.secret().apiKey].filter(Boolean).some(key => JSON.stringify(result).includes(key)), '返回内容包含认证信息，未保存。', 502);
    assert(result.questionId === question.id && result.origin === (textZh ? 'refined' : 'generated') && result.requiresConfirmation === true, '构思结果与本题或输入不一致。', 502);
    const draftZh = text(result.draftZh, '构思后的中文素材', 20000);
    assert((draftZh.match(/[\u3400-\u9fff]/g) ?? []).length >= 5, '构思结果应为中文素材。', 502);
    const notes = stringList(result.notes, '素材构思说明', 10);
    if (!textZh && !notes.some(note => /确认|真实|假设|示例/.test(note))) notes.unshift('构思示例，采纳前请确认符合真实情况。');
    return { questionId: question.id, draftZh, origin: result.origin, notes: notes.slice(0, 3), requiresConfirmation: true };
  } catch (error) {
    throw new AppError(provider.config.redact(error.message, apiKey), error instanceof AppError ? error.status : 502);
  }
}
