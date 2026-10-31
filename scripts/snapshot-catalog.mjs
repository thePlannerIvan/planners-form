// Maintainer-only: regenerate catalog.json.
//
// 0.2.0 stops pinning revisions. Installs and updates resolve the repository's
// current `main` commit at the moment the user acts (lib/upstream.js), so the
// catalog only carries the metadata the settings page renders: which Skills
// exist, how they depend on each other, and which are public.
import { writeFile } from 'node:fs/promises';
const entries = [
 ['planners-review-core','审阅核心','公共审阅通信与页面宿主',[],true],
 ['planners-source-index','来源索引','保存资料来源与定位',[],true],
 ['planners-report-kit','报告装配','统一生成离线报告',[],true],
 ['planners-fact-check','事实核查','检查事实与来源的一致性',['planners-source-index'],true],
 ['planners-method-wiki','方法库','共享策略与研究方法',[],true],
 ['planners-ppt-hell','PPT 制作','从材料生成可编辑 PPT',['planners-review-core','planners-source-index','planners-fact-check','planners-report-kit'],false,'ppt'],
 ['planners-proposal-system','策略提案','共创策略判断与方案结构',['planners-review-core','planners-source-index','planners-method-wiki','sparkling','storytelling','slide-copy'],false,null,'Planners-Proposal-System'],
 ['planners-bypage','逐页内容','展开逐页文案、素材与来源',['planners-review-core','planners-source-index','planners-fact-check','planners-method-wiki','storytelling','slide-copy'],false],
 ['editor','文章校对','全文可编辑的修订页：点绿同意、点红不改、未点默认接受',['planners-review-core'],false],
 ['planners-quali-box','定性分析','分析访谈与开放文本',['planners-source-index','planners-report-kit'],false],
 ['planners-quanti-box','定量分析','分析结构化数据并生成报告',['planners-source-index','planners-report-kit'],false],
 ['slide-copy','幻灯片文案','页面角色、标题链与文案规范',[],true],
 ['storytelling','叙事方法','组织叙事推进与认知节奏',[],true],
 ['sparkling','策略研讨','围绕材料共创业务判断',[],true],
 ['video-idea-system','视频创意','从核心洞察到可录口播与念稿审阅',['planners-review-core','planners-source-index'],false],
 ['video-craft','视频制作','剪辑、字幕与成片审阅；渲染工具按安装文档配置',['planners-review-core'],false],
];
export const entriesForRelease = entries;
const packages = entries.map(([id,title,description,dependencies,internal,runtime,repo=id]) => ({id,title,description,dependencies,internal,hidden:['slide-copy','storytelling','sparkling'].includes(id),runtime:runtime||null,repository:`thePlannerIvan/${repo}`,channel:'main',available:true}));
await writeFile(new URL('../catalog.json',import.meta.url),JSON.stringify({schema:2,generatedAt:new Date().toISOString(),channel:'main',packages},null,2)+'\n');
console.log(`Wrote ${packages.length} packages (no pinned revisions); 3 hidden companion Skills.`);
