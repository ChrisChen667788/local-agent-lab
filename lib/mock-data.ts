import { FeedItem, SessionSummary, SuggestedAction } from "@/lib/types";

export const mockFeedItems: FeedItem[] = [
  {
    id: "item-1",
    title: "Open-source RAG Framework 发布轻量检索压缩方案",
    source: "TechPulse Weekly",
    link: "https://example.com/rag-compression",
    tags: ["AI", "RAG", "Infra"],
    shortSummary:
      "团队通过层级压缩与缓存命中优化，把企业检索管线的平均响应时间降低了 38%，并减少了无效上下文注入。",
    longSummary:
      "该方案在检索阶段引入了双层过滤：先按业务域过滤，再做语义重排，最终只保留最可能影响答案质量的证据块。实测在问答、工单归因和内部知识助手场景中，响应速度和答案可解释性都有稳定提升，尤其适合文档量大但查询意图相对聚焦的团队。",
    valueScore: 91,
    suggestedAction: "deep_read"
  },
  {
    id: "item-2",
    title: "浏览器厂商宣布默认启用更严格的第三方 Cookie 策略",
    source: "Frontend Radar",
    link: "https://example.com/browser-cookie-policy",
    tags: ["Web", "Privacy", "Product"],
    shortSummary:
      "新策略将逐步限制跨站追踪，影响广告归因和部分旧版登录方案；建议产品与增长团队尽早替换依赖路径。",
    longSummary:
      "公告强调了隐私保护与可衡量性之间的平衡，推荐开发者迁移到聚合统计与服务端事件回传模型。短期风险集中在老系统中的 iframe 登录、第三方埋点和跨域会话延续。越早梳理依赖链路，越容易降低上线风险。",
    valueScore: 82,
    suggestedAction: "deep_read"
  },
  {
    id: "item-3",
    title: "某效率工具更新了 17 项界面细节",
    source: "Product Hunt Digest",
    link: "https://example.com/minor-ui-updates",
    tags: ["Design", "Tooling"],
    shortSummary:
      "此次更新以视觉一致性为主，缺少明确的功能增量，适合快速浏览即可，不建议占用深度时间。",
    longSummary:
      "从更新列表看，绝大多数改动属于图标替换、间距调整和动效统一，几乎没有影响工作流的核心交互变化。对于已经稳定使用该工具的用户来说，价值主要是降低学习摩擦，而不是带来新能力。",
    valueScore: 46,
    suggestedAction: "ignore"
  },
  {
    id: "item-4",
    title: "AI Code Review 指南新增“风险优先”评审模板",
    source: "Engineering Notes",
    link: "https://example.com/review-risk-template",
    tags: ["Engineering", "Process", "Quality"],
    shortSummary:
      "模板建议先识别回归风险和缺测区域，再讨论风格问题，可显著降低评审噪音并提升合并质量。",
    longSummary:
      "文中给出了一套可执行流程：先按影响面和可恢复性定位高风险点，再验证监控和回滚路径，最后才处理低优先级建议。对于多人协作仓库，这种顺序可以减少“讨论很多但质量提升有限”的情况。",
    valueScore: 88,
    suggestedAction: "deep_read"
  },
  {
    id: "item-5",
    title: "行业播客整理了过去一周的融资新闻",
    source: "Market Snapshot",
    link: "https://example.com/funding-roundup",
    tags: ["Market", "News"],
    shortSummary:
      "内容覆盖面广但信息密度一般，若你不在融资相关岗位，可先收藏待有需要时再回看。",
    longSummary:
      "该内容属于概览型新闻汇总，适合快速建立宏观认知，但缺少对产品策略或技术路线的深入拆解。对于关注经营环境的人有参考价值，但不属于必须立即处理的信息。",
    valueScore: 63,
    suggestedAction: "skim"
  }
];

export const mockSessionSummary: SessionSummary = {
  durationMinutes: 52,
  newItems: 14,
  deepReadCount: 5,
  ignorableCount: 6
};

export function getItemById(id: string) {
  return mockFeedItems.find((item) => item.id === id);
}

export function getActionLabel(action: SuggestedAction) {
  if (action === "deep_read") return "建议深读";
  if (action === "skim") return "建议快览";
  return "建议忽略";
}
