# Yasy 题库来源与边界

核验日期：2026-10-13（Asia/Shanghai）。本版有 **168 道题、41 个主题、36 个来源入口**：口语 123 道，Academic Task 1 16 道，Task 2 29 道。口语 Part 1 59、Part 2 19、Part 3 45；Part 2 中含 1 道明确标记 `taskType=follow-up` 的收尾追问，其余为长回答卡。

## 来源标签

- `official`：15 道，官方公开样题或教学示例的简短原文摘录。官方公开材料不等于在指定日期实际使用的考卷。部分短摘录省略背景，中文题意和完整链接均保留。
- `reported`：14 道，第三方收集的考生回忆题干短摘录；未获官方认证，措辞、完整性和考场事实可能有偏差。
- `adapted`：139 道，按已注明来源的样题、回忆主题或题型说明练习性改写；不是考试原文，不能标作真题。来源 `type=official` 只表示出处属于官方机构，不表示改写后的题是官方题。

14 个官方来源入口、22 个回忆来源入口。每题用 `sourceId` 指向可点击出处，`basis` 明示题干性质；界面必须展示标签与来源。

目前查到的官方公开入口提供样题、教学练习和考试格式。本次未发现可公开核验的完整官方当季真题库；本版不声称覆盖所有题目或 2026 年 9–12 月考季。回忆主题范围是 **2025 年 5 月至 2026 年 5 月**；保留报道月份，不伪写成精确考试日期。回忆题出现频率也不表示当前考季命中概率。

## 输入与版权约定

1. 口语以主题分组，主题下区分 Part 1 基础问答、Part 2 主话题卡与要点、Part 3 讨论。Part 2 要点是中文概括，方便写真实中文素材；收尾追问应简短回答。
2. 官方与回忆来源每源仅保留少量短摘录，其余题干为简短改写。不复制整套出版题库、参考答案或网站图。原材料的权利属于原权利人；有合法持有的题目时可自行在本地录入并留出处。
3. 全部 **16 道 Task 1** 的本地图表数据、流程及地图布局均为 **synthetic（自建练习）**；不是官方数据、考试原图或第三方重绘图的数据。`visual.note`、`sourceType=adapted` 和 `basis` 均明示。地图当前以方位布局表呈现，流程以节点顺序呈现；不声称还原真实图片。
4. 对按官方“题型说明”自建的具体主题，`basis` 额外声明具体问法并非官方原题。原始官方材料或回忆报道的链接保存在 `sources[].url`，链接用于追溯，不为自建数据背书。
5. 练习原题需要完整原图时应打开出处，或由用户提供有权使用的题目；不能依据回忆补数字并称真题。IELTS-Blog 相关网页也明确称图片是演示重绘；我们不把它视作真实考卷。
6. Task 2 的 `taskType` 保留任务义务：同意与否、双边讨论及个人观点、原因与解决、原因与影响、双问题、优点是否超过缺点。模板仅用于识别任务，不要求机械套固定段数。
7. 公共种子不含预写个人故事或样板答案。用户中文经历、素材元、表达与整理答案应由私人学习流程产生。

## 核验方式与限制

- IELTS.org 当前口语 PDF 已实际读取；核心题干在第 3、5、6 页。官方格式页及 British Council 新版写作入口已打开核验。
- 部分 IDP 页面直接访问返回 403；相应例题由该页面的公开搜索索引全文或摘要核验，不声称本次下载了原图。
- 部分 IELTS-Blog 原页面返回 429；来源使用可读取的原站检索索引、作者公开 RSS 和作者本人 Goodreads 同步文章。转载来源已注明。能追溯到公开报道不等于能够证明考场事实。
- 归档页可能随着新文章增添而移位；本版保留实际读到的入口，不编造单篇 URL。后续更新宜补充可核验永久链接。
- UAE 2026 年 2 月报道存在模板内容及图片日期不一致，已在出处说明；仅用于较低置信度的回忆主题练习。
- 同一作者文章的原站和转载不算独立交叉验证。当前没有将任何主题称为“必考”“预测命中”或“完整当季”。

## 官方考试格式

[IELTS Academic Writing 格式](https://ielts.org/take-a-test/test-types/ielts-academic-test/ielts-academic-format-writing)：Task 1 至少 150 词，建议不超过 20 分钟；Task 2 至少 250 词，建议约 40 分钟，总计 60 分钟。Task 2 对总写作分数的权重是 Task 1 的两倍。Task 1 只描述给定信息，不能加入图表未提供的因果解释。

[IELTS Speaking 格式](https://www.ielts.org/take-a-test/test-types/ielts-academic-test/ielts-academic-format-speaking)：Part 1 熟悉话题问答，Part 2 一分钟准备后说一至两分钟，Part 3 抽象讨论；官方没有要求每道口语回答达到固定词数。

[IELTS 官方 Academic 样题入口](https://ielts.org/take-a-test/preparation-resources/sample-test-questions/academic-test)；[British Council Academic Writing 样题入口](https://takeielts.britishcouncil.org/prepare/ielts-free-practice-mock-tests/academic/writing)。

## 逐源索引

| ID | 来源 | 类型 / 报道月份 | 核验备注 |
| --- | --- | --- | --- |
| `ielts-sp` | [IELTS.org — Speaking Sample Tasks](https://ielts.org/cdn/ielts-downloadable-assets/ielts-sample-tests/ielts-speaking-sample-tasks-2023.pdf) | official  | 已读取官方PDF第3、5、6页；公开样题不等于当前考季真题。 |
| `bc-lex` | [British Council — Part 1 familiarisation and lexical resource](https://takeielts.britishcouncil.org/sites/default/files/speaking_part_1_familiarisation_and_lexical_resource.pdf) | official  | 官方教学练习，检索索引可核验Worksheet 3；部分旧PDF会重定向。 |
| `bc-grammar` | [British Council — Part 1 grammar and lexical resource](https://takeielts.britishcouncil.org/sites/default/files/speaking_part_1_grammatical_range_and_accuracy_lexical_resource.pdf) | official  | 官方教学练习，四个示例问句由索引核验，非当季题库。 |
| `bc-health` | [British Council — Say it better, Part 1](https://takeielts.britishcouncil.org/sites/default/files/speaking_part_1_-_say_it_better.pdf) | official  | 官方教学材料，健康问句由索引核验。 |
| `idp-longturn` | [IDP — Preparing for Speaking Part 2](https://ielts.idp.com/thailand/prepare/article-ielts-speaking-test-long-turn-part-2/en-gb) | official  | 官方备考文章（2021-06-07），含三张示例卡。 |
| `idp-crowded` | [IDP — Describe a crowded place](https://ielts.idp.com/vietnam/about/news-and-articles/article-describe-a-crowded-place-you-went-to/en-gb) | official  | 官方机构备考例题，非本库认证的考试真题。 |
| `idp-holiday` | [IDP — Talk about your last holiday](https://ielts.idp.com/vietnam/about/news-and-articles/article-talk-about-your-last-holiday/en-gb) | official  | 官方机构备考文章，假日主题练习。 |
| `kw-may26` | [IELTS-Blog — Kuwait Speaking, May 2026](https://www.ielts-blog.com/recent-ielts-exams/ielts-speaking-test-in-kuwait-may-2026/) | reported 2026-05 | 署名考生D.T.的回忆，由原站检索索引核验；未经官方认证。 |
| `ca-mar26` | [IELTS-Blog — Canada Speaking, March 2026](https://www.ielts-blog.com/recent-ielts-exams/ielts-speaking-test-in-canada-march-2026/) | reported 2026-03 | 署名考生L.S.；月份是报道月份，非精确考试日期。 |
| `ca-feb26` | [IELTS-Blog — Canada Speaking, February 2026](https://www.ielts-blog.com/recent-ielts-exams/ielts-speaking-test-in-canada-february-2026/) | reported 2026-02 | 署名考生L.R.的回忆，由检索索引核验。 |
| `uk-feb26` | [IELTS-Blog — UK Speaking, February 2026](https://www.ielts-blog.com/recent-ielts-exams/ielts-speaking-test-in-uk-february-2026/) | reported 2026-02 | 署名考生M.E.；本链接对应学习、键盘、电视主题。 |
| `uk-dec25` | [IELTS-Blog — UK Speaking, December 2025](https://www.ielts-blog.com/recent-ielts-exams/ielts-speaking-test-in-uk-december-2025/) | reported 2025-12 | 署名考生T.N.；邻里、儿童游戏、争执主题。 |
| `it-dec25` | [IELTS-Blog — Italy Speaking, December 2025](https://www.ielts-blog.com/recent-ielts-exams/ielts-speaking-test-in-italy-december-2025/) | reported 2025-12 | 署名考生T.Y.；太阳镜、教技能主题。 |
| `ca-oct25` | [IELTS-Blog — Canada Speaking, October 2025 (J.C.)](https://www.ielts-blog.com/recent-ielts-exams/ielts-speaking-test-in-canada-october-2025-n3/) | reported 2025-10 | 署名考生J.C.；n3后缀区分同月其他报道。 |
| `ca-jan26` | [IELTS-Blog — January archive, Canada nature topics](https://www.ielts-blog.com/2026/01/page/5/) | reported 2026-01 | 所读归档中署名考生T.P.；自然景点、环境讨论。 |
| `au-jan26` | [IELTS-Blog — January archive, Australia navigation topics](https://www.ielts-blog.com/2026/01/page/2/) | reported 2026-01 | 所读归档中署名考生M.F.的口语回忆；另含Z.F.的英国写作回忆。 |
| `uk-talent26` | [IELTS-Blog — 2026 archive, UK talent topics](https://www.ielts-blog.com/2026/page/14/) | reported 2026-01 | 英国回忆：家乡、鞋、个人才能；摘要未公开考生署名。 |
| `it-mar26` | [IELTS-Blog RSS — Italy Speaking, March 2026](https://ielts142.rssing.com/chan-34911240/article2766.html) | reported 2026-03 | 原作者Simone Braverman公开RSS转载，署名考生R.；原站本次429。 |
| `tw-may26` | [IELTS-Blog RSS — Taiwan Speaking, May 2026](https://ielts142.rssing.com/chan-34911240/article2773.html) | reported 2026-05 | 作者公开RSS转载，2026-05-12发布，署名L.H.；原站本次429。 |
| `au-mar26` | [Simone Braverman author blog — Australia Speaking, March 2026](https://www.goodreads.com/author/show/2859678.Simone_Braverman/blog?page=2) | reported 2026-03 | 作者本人公开同步文章，2026-03-03发布，署名R.R.；原站本次429。 |
| `idp-w-types` | [IDP — Types of essays in Writing Task 2](https://ielts.idp.com/prepare/article-e-is-for-essays) | official  | 官方文章（2021-08-25）；示例由索引核验，直接访问403。 |
| `idp-w-topics` | [IDP — Common topics for Writing Task 2](https://ielts.idp.com/prepare/article-common-topics-for-ielts-writing-task-2) | official  | 官方文章（2024-02-08）；教育、科技、健康、环境等练习示例，不是预测。 |
| `idp-w-position` | [IDP — Presenting your position in Writing Task 2](https://ielts.idp.com/prepare/article-ielts-writing-task-2-how-to-present-your-position) | official  | 官方文章（2025-06-19）；免费公交、居家办公、海外工作学习例题。 |
| `idp-w-agree` | [IDP — Agree or disagree essay](https://ielts.idp.com/vietnam/prepare/article-agree-or-disagree-ielts-writing-task-2/en-gb) | official  | 官方文章（2023-02-03）；烟草政策、科学研究管理示例。 |
| `ielts-w-format` | [IELTS.org — Academic Writing format](https://ielts.org/take-a-test/test-types/ielts-academic-test/ielts-academic-format-writing) | official  | 官方题型说明；本源派生题均为自建练习，不是官方样题。 |
| `idp-w-process` | [IDP — Process chart Task 1 guide](https://ielts.idp.com/nepal/about/news-and-articles/article-process-chart-task-1-guide) | official  | 官方备考文章（2026-06-22）；蛙、冻干咖啡、制砖流程示例，不复制原图。 |
| `idp-w-maps` | [IDP — Task 1 map format](https://ielts.idp.com/vietnam/about/news-and-articles/article-ielts-writing-task-1-maps/en-gb) | official  | 官方备考文章；地图变迁和选址示例；本库布局为自建练习。 |
| `w-ca-aug25` | [IELTS-Blog — Canada Academic Writing, August 2025](https://www.ielts-blog.com/recent-ielts-exams/ielts-test-in-canada-august-2025-academic-module/) | reported 2025-08 | 署名考生M；人口图、频繁换工作；原站图表明确为示意重绘。 |
| `w-ca-may25` | [IELTS-Blog — Canada Academic Writing, May 2025](https://www.ielts-blog.com/recent-ielts-exams/ielts-test-in-canada-may-2025-academic-module/) | reported 2025-05 | 署名DM；办公楼改造、职业导向课程；图片为示意重绘。 |
| `w-ca-may26` | [IELTS-Blog — May archive, Canada Academic Writing](https://www.ielts-blog.com/2026/05/page/2/) | reported 2026-05 | 署名S.T.；家庭用水、住房短缺；图表为作者重绘，非考试原图。 |
| `w-uae-feb26` | [IELTS-Blog — UAE Academic Writing, February 2026](https://www.ielts-blog.com/recent-ielts-exams/ielts-test-in-uae-february-2026-academic-module/) | reported 2026-02 | 署名D.P.；婚姻离婚图、免费供水；页面模板误写Speaking和旧图片月份，信任较低。 |
| `w-au-jan26` | [IELTS-Blog — 2026 archive, Australia Academic Writing](https://www.ielts-blog.com/2026/page/20/) | reported 2026-01 | 署名P.Y.；教师薪资、企业持有个人信息；本页另含V.D.的英国口语回忆。 |
| `w-oman-feb26` | [IELTS-Blog — 2026 archive, Oman Academic Writing](https://www.ielts-blog.com/2026/page/8/) | reported 2026-02 | 署名A.R.；互联网用途、物种多样性；图明确为重绘。 |
| `w-germany-nov25` | [IELTS-Blog — Recent exams archive, Germany Academic Writing](https://www.ielts-blog.com/category/recent-ielts-exams/page/29/) | reported 2025-11 | 德国考生（摘要未署名）；公园地图、出国读书；地图为重绘。 |
| `w-uae-dec25` | [IELTS-Blog — Recent exams archive, UAE Academic Writing](https://www.ielts-blog.com/category/recent-ielts-exams/page/25/) | reported 2025-12 | 署名F.N.；游客交通、机器人发展。 |
| `w-saudi-oct25` | [IELTS-Blog — October archive, Saudi Arabia Academic Writing](https://www.ielts-blog.com/2025/10/) | reported 2025-10 | 署名H.A.；老年就业、游客环保责任；图为示意重绘。 |

## 后续收录字段

每条新增题目需要来源 URL、来源类型、题干是否改写、实际核验日期。回忆题尽量增加报道月份、地区与署名；不能用第三方预测标签替代证据。季节性更新要重新检索，核验后再调整范围说明。付费 Cambridge IELTS 等出版题库不在公共仓库批量复制；个人合法持有内容可在本地私人题库留出处。
