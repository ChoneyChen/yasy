# 语料准入 v2

语料库积累值得单独复习的搭配、地道表达、精确用语、句型与语篇结构。孤立单词进入单词本；“I think”“very good”“a lot of”“for example”“in conclusion”等基础套话不为了数量强行收录。短并不等于普通：`build confidence`、`strike a balance`、`draw a distinction` 可以通过准入。

## 新候选需要的依据

AI 每条候选须附：

```json
{
  "admission": {
    "approved": true,
    "reasonZh": "这个搭配能准确表达兼顾不同需求，可迁移到多个话题。",
    "reasonEn": "This collocation precisely describes managing competing needs across different topics.",
    "benefit": "collocation",
    "transferExampleEn": "Managers need to strike a balance between flexibility and consistency."
  }
}
```

`benefit` 仅允许 `collocation`、`idiomatic`、`precision`、`structure`、`discourse`。AI 明确拒绝时保留其拒绝理由；不能把字符串 `"true"` 或其他真值当作批准。

本地 `assessExpression(expression, {scope, answerText})` 返回 `status`、`reasonZh`、`reasonEn` 和 `policyVersion: 2`。只允许 `approved` 候选进入语料库；其余状态由调用方展示或保留审计记录。

| 状态 | 含义 |
| --- | --- |
| `approved` | 模型提供批准理由、合法收益分类和迁移例句，且本地检查通过。 |
| `rejected` | 模型拒绝，或本地发现基础套话、单词、非原文、语域冲突、格式/依据缺失。 |
| `pending` | 历史语料没有准入证据，或缺少学习域/原答案，尚不能确认。 |

本地核实连续原句，只允许大小写差异，不折叠内部空格、不改标点、不用改写替代原文，也不将另一个单词内部的子串当作表达。写作排除小范围明确的口语俗语和标为 informal/colloquial/slang 的用法；Task 1 排除 Task 2 立场与论证句式。共享的正式搭配不会因同时可用于口语而被拦截。

中英准入理由必须非空，英文理由不夹中文；“高级”“有用”等单独泛泛标签不足。`usageNoteEn` 必须给出英文用途，迁移例句必须是英文示例，均至少4词；例句不能只是重复候选表达本身。例句可以变换时态、主语与句型槽位，本地不强迫它逐字重复原句。

**批准理由是模型提供的学习价值判断，不是官方雅思分数，也不代表本地完成了全面语义审查。** 本地只能检查有限的结构、原文与语域条件；迁移例句是否准确、表达是否真正有收益，仍应结合模型说明和用户复核。基础表达清单刻意保持小范围，避免用巨大词表误挡有用搭配。

## 历史条目与审计

历史条目无 `admission` 时，明显基础条目可被本地拒绝；其他条目统一 `pending`，不假装已经审查通过。补齐上下文并经过重新审核后，才能转为批准。

`auditExpressions(expressions, options)` 是纯函数，返回 `{items, counts, policyVersion}`。每个 `items` 元素是 `{expression, assessment}`：保留原对象、关联和全部旧字段，附本次状态与理由，不删除拒绝或待复核条目，不读写数据库或密钥。调用方可用 `options.contextFor(expression)` 提供该条目的 `{scope, answerText}`；未提供时可直接使用同一上下文选项，历史条目仍不会被自动批准。

准入模块独立于保存与推荐。过滤后的语料数组与素材关联索引由导入器负责正确映射；0条值得积累的语料是合法结果，不应为凑数补条目。历史关联和旧答案应保留，界面可将待复核/拒绝条目与获准语料分开展示。
