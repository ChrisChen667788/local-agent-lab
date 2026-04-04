export const APP_LOCALES = ["zh-CN", "zh-TW", "en", "ko", "ja"] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

export const LOCALE_LABELS: Record<AppLocale, string> = {
  "zh-CN": "简体",
  "zh-TW": "繁體",
  en: "EN",
  ko: "한국어",
  ja: "日本語"
};

const dictionaries = {
  "zh-CN": {
    nav: {
      agent: "Agent",
      dashboard: "后台",
      language: "语言"
    },
    agent: {
      shell: "Agent Shell",
      title: "本地优先编码工作台",
      subtitle: "面向 Apple Silicon 的本地 Agent 工作台，可切换本地 MLX 与远端 API。",
      targets: "目标模型",
      selectedProfile: "当前配置",
      context: "上下文",
      memory: "内存画像",
      toolMode: "工具模式",
      toolsAvailable: "支持文件感知 Agent 循环",
      toolsUnavailable: "仅聊天模式",
      toolRegistry: "工具注册表",
      resolvedEndpoint: "已解析接口",
      selfCheck: "连接自检",
      selfCheckDescription: "对当前 API 目标执行三段探测：models、chat、tool calls。",
      runCheck: "运行自检",
      checking: "检查中...",
      allChecksPassed: "全部通过",
      checkAttention: "需要关注",
      openDocs: "打开文档",
      localRuntime: "本地运行时",
      runtimeBusy: "运行中",
      runtimeIdle: "空闲",
      runtimeOffline: "离线",
      resolvedModel: "已解析模型",
      promptFrame: "系统提示词",
      launchHints: "启动提示",
      messages: "消息",
      turns: "轮次",
      tools: "工具",
      transcriptReady: "工作台已就绪。选择一个本地或远端目标，然后开始分析仓库或执行任务。",
      enableToolLoop: "启用工具循环",
      clearSession: "清空会话",
      runAgent: "运行 Agent",
      running: "执行中...",
      providerSelfCheck: "提供方自检",
      exportMarkdown: "导出 Markdown",
      exportJson: "导出 JSON",
      historySavedAt: "日志目录",
      healthUnknown: "未知",
      healthHealthy: "健康",
      healthWarning: "警告",
      healthDegraded: "降级",
      user: "用户",
      assistant: "助手",
      connectionRecord: "连接检查记录",
      processingWith: "正在使用以下目标处理请求：",
      checkOnlyRemote: "只有已配置密钥的远端 API 目标支持自检。",
      noContent: "提供方未返回可见内容，请检查目标配置后重试。"
    },
    admin: {
      title: "后台监控",
      subtitle: "查看模型调用、并发、Token 用量、自检历史与本机资源状态。",
      target: "监控目标",
      window: "时间窗口",
      refresh: "刷新",
      autoRefresh: "自动刷新",
      totalRequests: "总请求数",
      activeRequests: "当前并发",
      totalTokens: "累计 Token",
      failedRequests: "失败请求",
      latestCheck: "最新自检",
      requestTrend: "请求趋势",
      tokenTrend: "Token 趋势",
      modelBreakdown: "模型分布",
      recentHistory: "最近调用历史",
      recentChecks: "最近自检记录",
      localTelemetry: "本机资源",
      memory: "内存",
      storage: "存储",
      battery: "电源/电池",
      gpuProxy: "GPU / Metal 负载代理",
      queue: "队列",
      active: "活跃",
      noData: "暂无数据",
      savedFiles: "落盘文件"
    },
    common: {
      local: "本地",
      remote: "远端",
      ok: "正常",
      failed: "失败",
      copy: "复制",
      copied: "已复制",
      queue: "队列",
      active: "活跃",
      model: "模型",
      endpoint: "接口",
      unknown: "未知",
      latest: "最新"
    }
  },
  "zh-TW": {
    nav: { agent: "Agent", dashboard: "後台", language: "語言" },
    agent: {
      shell: "Agent Shell",
      title: "本地優先編碼工作台",
      subtitle: "面向 Apple Silicon 的本地 Agent 工作台，可切換本地 MLX 與遠端 API。",
      targets: "目標模型",
      selectedProfile: "目前配置",
      context: "上下文",
      memory: "記憶體輪廓",
      toolMode: "工具模式",
      toolsAvailable: "支援檔案感知 Agent 迴圈",
      toolsUnavailable: "僅聊天模式",
      toolRegistry: "工具註冊表",
      resolvedEndpoint: "已解析介面",
      selfCheck: "連線自檢",
      selfCheckDescription: "對目前 API 目標執行三段探測：models、chat、tool calls。",
      runCheck: "執行自檢",
      checking: "檢查中...",
      allChecksPassed: "全部通過",
      checkAttention: "需要注意",
      openDocs: "打開文件",
      localRuntime: "本地執行時",
      runtimeBusy: "執行中",
      runtimeIdle: "閒置",
      runtimeOffline: "離線",
      resolvedModel: "已解析模型",
      promptFrame: "系統提示詞",
      launchHints: "啟動提示",
      messages: "訊息",
      turns: "輪次",
      tools: "工具",
      transcriptReady: "工作台已就緒。選擇本地或遠端目標後即可分析倉庫或執行任務。",
      enableToolLoop: "啟用工具迴圈",
      clearSession: "清空會話",
      runAgent: "執行 Agent",
      running: "執行中...",
      providerSelfCheck: "提供方自檢",
      exportMarkdown: "匯出 Markdown",
      exportJson: "匯出 JSON",
      historySavedAt: "日誌目錄",
      healthUnknown: "未知",
      healthHealthy: "健康",
      healthWarning: "警告",
      healthDegraded: "降級",
      user: "使用者",
      assistant: "助手",
      connectionRecord: "連線檢查記錄",
      processingWith: "正在使用以下目標處理請求：",
      checkOnlyRemote: "只有已配置金鑰的遠端 API 目標支援自檢。",
      noContent: "提供方未返回可見內容，請檢查目標配置後再試。"
    },
    admin: {
      title: "後台監控",
      subtitle: "查看模型呼叫、並發、Token 用量、自檢歷史與本機資源狀態。",
      target: "監控目標",
      window: "時間視窗",
      refresh: "重新整理",
      autoRefresh: "自動重新整理",
      totalRequests: "總請求數",
      activeRequests: "目前並發",
      totalTokens: "累計 Token",
      failedRequests: "失敗請求",
      latestCheck: "最新自檢",
      requestTrend: "請求趨勢",
      tokenTrend: "Token 趨勢",
      modelBreakdown: "模型分布",
      recentHistory: "最近呼叫歷史",
      recentChecks: "最近自檢記錄",
      localTelemetry: "本機資源",
      memory: "記憶體",
      storage: "儲存",
      battery: "電源/電池",
      gpuProxy: "GPU / Metal 負載代理",
      queue: "佇列",
      active: "活躍",
      noData: "尚無資料",
      savedFiles: "落盤檔案"
    },
    common: {
      local: "本地",
      remote: "遠端",
      ok: "正常",
      failed: "失敗",
      copy: "複製",
      copied: "已複製",
      queue: "佇列",
      active: "活躍",
      model: "模型",
      endpoint: "介面",
      unknown: "未知",
      latest: "最新"
    }
  },
  en: {
    nav: { agent: "Agent", dashboard: "Dashboard", language: "Language" },
    agent: {
      shell: "Agent Shell",
      title: "Local-first coding cockpit",
      subtitle: "A local-first agent workspace for Apple Silicon with switchable MLX and remote API targets.",
      targets: "Targets",
      selectedProfile: "Selected Profile",
      context: "Context",
      memory: "Memory",
      toolMode: "Tool Mode",
      toolsAvailable: "File-aware agent loop available",
      toolsUnavailable: "Chat-only mode",
      toolRegistry: "Tool Registry",
      resolvedEndpoint: "Resolved Endpoint",
      selfCheck: "Provider Self-check",
      selfCheckDescription: "Probe the selected API target through models, chat, and tool calls.",
      runCheck: "Run Check",
      checking: "Checking...",
      allChecksPassed: "All checks passed",
      checkAttention: "Needs attention",
      openDocs: "Open docs",
      localRuntime: "Local Runtime",
      runtimeBusy: "Busy",
      runtimeIdle: "Idle",
      runtimeOffline: "Offline",
      resolvedModel: "Resolved Model",
      promptFrame: "Prompt Frame",
      launchHints: "Launch Hints",
      messages: "Messages",
      turns: "Turns",
      tools: "Tools",
      transcriptReady: "The shell is ready. Pick a target and start inspecting the repo or running tasks.",
      enableToolLoop: "Enable tool loop",
      clearSession: "Clear Session",
      runAgent: "Run Agent",
      running: "Running...",
      providerSelfCheck: "Provider self-check",
      exportMarkdown: "Export Markdown",
      exportJson: "Export JSON",
      historySavedAt: "Log directory",
      healthUnknown: "Unknown",
      healthHealthy: "Healthy",
      healthWarning: "Warning",
      healthDegraded: "Degraded",
      user: "User",
      assistant: "Assistant",
      connectionRecord: "Connection Check Record",
      processingWith: "Processing with:",
      checkOnlyRemote: "Self-check is available only for remote API targets with configured keys.",
      noContent: "The provider returned no visible content. Check the target configuration and try again."
    },
    admin: {
      title: "Admin Dashboard",
      subtitle: "Inspect model traffic, concurrency, token usage, check history, and local machine telemetry.",
      target: "Target",
      window: "Window",
      refresh: "Refresh",
      autoRefresh: "Auto refresh",
      totalRequests: "Total requests",
      activeRequests: "Active requests",
      totalTokens: "Total tokens",
      failedRequests: "Failed requests",
      latestCheck: "Latest check",
      requestTrend: "Request trend",
      tokenTrend: "Token trend",
      modelBreakdown: "Model breakdown",
      recentHistory: "Recent call history",
      recentChecks: "Recent checks",
      localTelemetry: "Local telemetry",
      memory: "Memory",
      storage: "Storage",
      battery: "Power / battery",
      gpuProxy: "GPU / Metal proxy",
      queue: "Queue",
      active: "Active",
      noData: "No data yet",
      savedFiles: "Persisted files"
    },
    common: {
      local: "Local",
      remote: "Remote",
      ok: "OK",
      failed: "Failed",
      copy: "Copy",
      copied: "Copied",
      queue: "Queue",
      active: "Active",
      model: "Model",
      endpoint: "Endpoint",
      unknown: "Unknown",
      latest: "Latest"
    }
  },
  ko: {
    nav: { agent: "Agent", dashboard: "대시보드", language: "언어" },
    agent: {
      shell: "Agent Shell",
      title: "로컬 우선 코딩 워크스페이스",
      subtitle: "Apple Silicon용 로컬 Agent 워크스페이스로, MLX와 원격 API 대상을 전환할 수 있습니다.",
      targets: "대상",
      selectedProfile: "선택한 프로필",
      context: "컨텍스트",
      memory: "메모리",
      toolMode: "도구 모드",
      toolsAvailable: "파일 인식 Agent 루프 사용 가능",
      toolsUnavailable: "채팅 전용 모드",
      toolRegistry: "도구 레지스트리",
      resolvedEndpoint: "해석된 엔드포인트",
      selfCheck: "연결 자가 진단",
      selfCheckDescription: "선택한 API 대상에 대해 models, chat, tool calls를 점검합니다.",
      runCheck: "진단 실행",
      checking: "점검 중...",
      allChecksPassed: "모두 정상",
      checkAttention: "주의 필요",
      openDocs: "문서 열기",
      localRuntime: "로컬 런타임",
      runtimeBusy: "사용 중",
      runtimeIdle: "대기 중",
      runtimeOffline: "오프라인",
      resolvedModel: "해석된 모델",
      promptFrame: "시스템 프롬프트",
      launchHints: "실행 힌트",
      messages: "메시지",
      turns: "턴",
      tools: "도구",
      transcriptReady: "워크스페이스가 준비되었습니다. 대상을 선택하고 저장소 분석이나 작업 실행을 시작하세요.",
      enableToolLoop: "도구 루프 활성화",
      clearSession: "세션 비우기",
      runAgent: "Agent 실행",
      running: "실행 중...",
      providerSelfCheck: "제공자 자가 진단",
      exportMarkdown: "Markdown 내보내기",
      exportJson: "JSON 내보내기",
      historySavedAt: "로그 디렉터리",
      healthUnknown: "알 수 없음",
      healthHealthy: "정상",
      healthWarning: "경고",
      healthDegraded: "저하",
      user: "사용자",
      assistant: "어시스턴트",
      connectionRecord: "연결 점검 기록",
      processingWith: "현재 대상:",
      checkOnlyRemote: "키가 설정된 원격 API 대상에서만 자가 진단을 사용할 수 있습니다.",
      noContent: "제공자가 표시 가능한 내용을 반환하지 않았습니다. 설정을 확인하세요."
    },
    admin: {
      title: "관리 대시보드",
      subtitle: "모델 호출, 동시성, Token 사용량, 점검 기록, 로컬 머신 상태를 확인합니다.",
      target: "대상",
      window: "시간 범위",
      refresh: "새로고침",
      autoRefresh: "자동 새로고침",
      totalRequests: "총 요청 수",
      activeRequests: "현재 동시성",
      totalTokens: "누적 Token",
      failedRequests: "실패 요청",
      latestCheck: "최신 점검",
      requestTrend: "요청 추세",
      tokenTrend: "Token 추세",
      modelBreakdown: "모델 분포",
      recentHistory: "최근 호출 기록",
      recentChecks: "최근 점검 기록",
      localTelemetry: "로컬 자원",
      memory: "메모리",
      storage: "저장소",
      battery: "전원 / 배터리",
      gpuProxy: "GPU / Metal 프록시",
      queue: "대기열",
      active: "활성",
      noData: "데이터 없음",
      savedFiles: "저장 파일"
    },
    common: {
      local: "로컬",
      remote: "원격",
      ok: "정상",
      failed: "실패",
      copy: "복사",
      copied: "복사됨",
      queue: "대기열",
      active: "활성",
      model: "모델",
      endpoint: "엔드포인트",
      unknown: "알 수 없음",
      latest: "최신"
    }
  },
  ja: {
    nav: { agent: "Agent", dashboard: "ダッシュボード", language: "言語" },
    agent: {
      shell: "Agent Shell",
      title: "ローカル優先コーディングワークスペース",
      subtitle: "Apple Silicon 向けのローカル Agent ワークスペースで、MLX とリモート API を切り替えられます。",
      targets: "ターゲット",
      selectedProfile: "選択中のプロファイル",
      context: "コンテキスト",
      memory: "メモリ",
      toolMode: "ツールモード",
      toolsAvailable: "ファイル対応 Agent ループを利用可能",
      toolsUnavailable: "チャット専用モード",
      toolRegistry: "ツール一覧",
      resolvedEndpoint: "解決済みエンドポイント",
      selfCheck: "接続セルフチェック",
      selfCheckDescription: "選択した API ターゲットに対して models、chat、tool calls を検査します。",
      runCheck: "チェック実行",
      checking: "確認中...",
      allChecksPassed: "すべて正常",
      checkAttention: "要確認",
      openDocs: "ドキュメントを開く",
      localRuntime: "ローカル実行環境",
      runtimeBusy: "実行中",
      runtimeIdle: "待機中",
      runtimeOffline: "オフライン",
      resolvedModel: "解決済みモデル",
      promptFrame: "システムプロンプト",
      launchHints: "起動ヒント",
      messages: "メッセージ",
      turns: "ターン",
      tools: "ツール",
      transcriptReady: "ワークスペースの準備ができました。ターゲットを選び、リポジトリ解析やタスク実行を始めてください。",
      enableToolLoop: "ツールループを有効化",
      clearSession: "セッションをクリア",
      runAgent: "Agent 実行",
      running: "実行中...",
      providerSelfCheck: "提供元セルフチェック",
      exportMarkdown: "Markdown を出力",
      exportJson: "JSON を出力",
      historySavedAt: "ログ保存先",
      healthUnknown: "不明",
      healthHealthy: "正常",
      healthWarning: "警告",
      healthDegraded: "劣化",
      user: "ユーザー",
      assistant: "アシスタント",
      connectionRecord: "接続チェック記録",
      processingWith: "処理中ターゲット:",
      checkOnlyRemote: "セルフチェックは、キーが設定されたリモート API ターゲットでのみ利用できます。",
      noContent: "表示可能な内容が返りませんでした。ターゲット設定を確認してください。"
    },
    admin: {
      title: "管理ダッシュボード",
      subtitle: "モデル呼び出し、同時実行、Token 使用量、チェック履歴、ローカル端末の状態を確認します。",
      target: "対象",
      window: "時間範囲",
      refresh: "更新",
      autoRefresh: "自動更新",
      totalRequests: "総リクエスト数",
      activeRequests: "現在の同時実行",
      totalTokens: "累計 Token",
      failedRequests: "失敗リクエスト",
      latestCheck: "最新チェック",
      requestTrend: "リクエスト推移",
      tokenTrend: "Token 推移",
      modelBreakdown: "モデル分布",
      recentHistory: "最近の呼び出し履歴",
      recentChecks: "最近のチェック履歴",
      localTelemetry: "ローカル指標",
      memory: "メモリ",
      storage: "ストレージ",
      battery: "電源 / バッテリー",
      gpuProxy: "GPU / Metal 代理指標",
      queue: "キュー",
      active: "アクティブ",
      noData: "データなし",
      savedFiles: "保存ファイル"
    },
    common: {
      local: "ローカル",
      remote: "リモート",
      ok: "正常",
      failed: "失敗",
      copy: "コピー",
      copied: "コピー済み",
      queue: "キュー",
      active: "アクティブ",
      model: "モデル",
      endpoint: "エンドポイント",
      unknown: "不明",
      latest: "最新"
    }
  }
} as const;

export function normalizeLocale(input?: string | null): AppLocale {
  if (!input) return "zh-CN";
  const direct = APP_LOCALES.find((locale) => locale === input);
  if (direct) return direct;
  if (input.startsWith("zh-TW") || input.startsWith("zh-HK")) return "zh-TW";
  if (input.startsWith("zh")) return "zh-CN";
  if (input.startsWith("ko")) return "ko";
  if (input.startsWith("ja")) return "ja";
  return "en";
}

export function getDictionary(locale: AppLocale) {
  return dictionaries[locale];
}

export function getLocalizedStarterPrompts(locale: AppLocale) {
  switch (locale) {
    case "zh-CN":
      return [
        "检查当前仓库，并告诉我本地编码 Agent Shell 已经实现了什么。",
        "使用工具比较这台 Mac 上的本地 0.6B 配置和本地 4-bit 4B 配置。",
        "为接入 Codex、Claude Code、Kimi、GLM 和 Qwen API 拟定下一步工程计划。"
      ];
    case "zh-TW":
      return [
        "檢查目前倉庫，並告訴我本地編碼 Agent Shell 已經實作了什麼。",
        "使用工具比較這台 Mac 上的本地 0.6B 配置與本地 4-bit 4B 配置。",
        "為接入 Codex、Claude Code、Kimi、GLM 與 Qwen API 擬定下一步工程計畫。"
      ];
    case "ko":
      return [
        "현재 저장소를 검사하고 로컬 코딩 Agent Shell에 이미 구현된 내용을 알려줘.",
        "이 Mac에서 로컬 0.6B 프로필과 로컬 4-bit 4B 프로필을 도구로 비교해줘.",
        "Codex, Claude Code, Kimi, GLM, Qwen API 연동을 위한 다음 엔지니어링 단계를 정리해줘."
      ];
    case "ja":
      return [
        "現在のリポジトリを調べて、ローカル coding Agent Shell に実装済みの内容を教えてください。",
        "この Mac 上の local 0.6B プロファイルと local 4-bit 4B プロファイルをツールで比較してください。",
        "Codex、Claude Code、Kimi、GLM、Qwen API を接続する次の実装ステップを整理してください。"
      ];
    case "en":
    default:
      return [
        "Inspect this repo and tell me what is already implemented for the local coding agent shell.",
        "Use tools to compare the local 0.6B profile and the local 4-bit 4B profile for this Mac.",
        "Draft the next engineering steps to connect Codex, Claude Code, Kimi, GLM, and Qwen APIs."
      ];
  }
}

export function getLocalizedTargetDescription(locale: AppLocale, targetId: string, fallback: string) {
  const map: Record<AppLocale, Record<string, string>> = {
    "zh-CN": {
      "local-qwen3-0.6b": "轻量本地配置，适合日常办公状态下的仓库问答、摘要和低压力 Agent 流程。",
      "local-qwen35-4b-4bit": "默认本地 4B 主力配置，适合更好的代码理解、文件感知推理和正式直答评测。",
      "local-qwen3-4b-4bit": "保留的上一代本地 4B 对比配置，用于和 Qwen3.5-4B 做并排验证。",
      "openai-codex": "远端 Codex 类编码目标，适合高质量编码与复杂工具链任务。",
      "anthropic-claude": "通过 Claude 兼容的 OpenAI-compatible 网关接入的目标，适合稳定工具调用。",
      "kimi-api": "Moonshot OpenAI-compatible 目标，适合和本地 Qwen 做对比。",
      "glm-api": "GLM OpenAI-compatible 编码目标，可作为成本更低的远端后端。",
      "qwen-api": "DashScope OpenAI-compatible 目标，在不占用本机内存的前提下保留 Qwen 语义。"
    },
    "zh-TW": {
      "local-qwen3-0.6b": "輕量本地配置，適合日常辦公狀態下的倉庫問答、摘要與低壓力 Agent 流程。",
      "local-qwen35-4b-4bit": "預設本地 4B 主力配置，適合更好的程式碼理解、檔案感知推理與正式直答評測。",
      "local-qwen3-4b-4bit": "保留的上一代本地 4B 對比配置，用於和 Qwen3.5-4B 做並排驗證。",
      "openai-codex": "遠端 Codex 類編碼目標，適合高品質編碼與複雜工具鏈任務。",
      "anthropic-claude": "透過 Claude 相容的 OpenAI-compatible 閘道接入的目標，適合穩定工具呼叫。",
      "kimi-api": "Moonshot OpenAI-compatible 目標，適合和本地 Qwen 做比較。",
      "glm-api": "GLM OpenAI-compatible 編碼目標，可作為成本更低的遠端後端。",
      "qwen-api": "DashScope OpenAI-compatible 目標，在不占用本機記憶體的前提下保留 Qwen 語義。"
    },
    en: {
      "local-qwen3-0.6b": "Light local profile for repo Q&A, summaries, and low-pressure agent flows during a normal workday.",
      "local-qwen35-4b-4bit": "Default local 4B profile for stronger code understanding, file-aware reasoning, and cleaner direct-answer benchmarking.",
      "local-qwen3-4b-4bit": "Legacy local 4B comparison profile kept for side-by-side validation against Qwen3.5-4B.",
      "openai-codex": "Remote Codex-style coding target for higher quality code tasks and deeper tool loops.",
      "anthropic-claude": "Claude routed through a compatible OpenAI-style gateway for stable tool calling.",
      "kimi-api": "Moonshot OpenAI-compatible target for comparison against local Qwen.",
      "glm-api": "GLM OpenAI-compatible coding target as a lower-cost remote back-end.",
      "qwen-api": "DashScope OpenAI-compatible target that preserves Qwen semantics without local memory pressure."
    },
    ko: {
      "local-qwen3-0.6b": "가벼운 로컬 프로필로, 일반 업무 중에도 저장소 질의응답과 요약, 저부하 Agent 흐름에 적합합니다.",
      "local-qwen35-4b-4bit": "코드 이해, 파일 인식 추론, 정답형 벤치마크에 더 적합한 기본 로컬 4B 프로필입니다.",
      "local-qwen3-4b-4bit": "Qwen3.5-4B와 나란히 검증하기 위해 남겨 둔 이전 세대 로컬 4B 비교 프로필입니다.",
      "openai-codex": "더 강한 코딩 품질과 복잡한 도구 루프에 적합한 원격 Codex 계열 대상입니다.",
      "anthropic-claude": "호환 가능한 OpenAI-style 게이트웨이를 통한 Claude 대상이며 도구 호출 안정성이 높습니다.",
      "kimi-api": "로컬 Qwen과 비교하기 좋은 Moonshot OpenAI-compatible 대상입니다.",
      "glm-api": "비용 효율을 노릴 수 있는 GLM OpenAI-compatible 원격 코딩 대상입니다.",
      "qwen-api": "로컬 메모리 부담 없이 Qwen 의미 체계를 유지하는 DashScope OpenAI-compatible 대상입니다."
    },
    ja: {
      "local-qwen3-0.6b": "軽量なローカル構成で、通常の作業中でもリポジトリ Q&A や要約、低負荷の Agent フローに向いています。",
      "local-qwen35-4b-4bit": "コード理解、ファイル認識推論、正式ベンチマークの直答口径に向いた既定のローカル 4B 構成です。",
      "local-qwen3-4b-4bit": "Qwen3.5-4B と並行検証するために残してある旧世代ローカル 4B 比較構成です。",
      "openai-codex": "より高品質なコーディングと複雑なツールループに向いたリモート Codex 系ターゲットです。",
      "anthropic-claude": "互換 OpenAI-style ゲートウェイ経由の Claude ターゲットで、ツール呼び出しが安定しています。",
      "kimi-api": "ローカル Qwen との比較に向いた Moonshot OpenAI-compatible ターゲットです。",
      "glm-api": "コストを抑えやすい GLM OpenAI-compatible リモートコーディングターゲットです。",
      "qwen-api": "ローカルメモリを圧迫せずに Qwen の意味特性を使える DashScope OpenAI-compatible ターゲットです。"
    }
  };
  return map[locale]?.[targetId] || fallback;
}

export function getLocalizedToolDescription(locale: AppLocale, toolName: string, fallback: string) {
  const map: Record<AppLocale, Record<string, string>> = {
    "zh-CN": {
      list_files: "列出当前工作区中的文件与目录。",
      read_file: "按行读取 UTF-8 文本文件。",
      execute_command: "执行经过分级的非交互命令；涉及工作区写入时需要确认。",
      write_file: "写入或追加 UTF-8 文件，并返回 diff 预览和校验结果。",
      apply_patch: "应用 unified diff 补丁，并返回预览与校验结果。"
    },
    "zh-TW": {
      list_files: "列出目前工作區中的檔案與目錄。",
      read_file: "按行讀取 UTF-8 文字檔。",
      execute_command: "執行經過分級的非互動命令；涉及工作區寫入時需要確認。",
      write_file: "寫入或追加 UTF-8 檔案，並返回 diff 預覽與校驗結果。",
      apply_patch: "套用 unified diff 補丁，並返回預覽與校驗結果。"
    },
    en: {
      list_files: "List files and directories in the current workspace.",
      read_file: "Read a UTF-8 text file by line range.",
      execute_command: "Run a classified non-interactive command; workspace-changing commands require confirmation.",
      write_file: "Write or append a UTF-8 file and return a diff preview plus verification.",
      apply_patch: "Apply a unified diff patch and return preview and verification details."
    },
    ko: {
      list_files: "현재 워크스페이스의 파일과 디렉터리를 나열합니다.",
      read_file: "UTF-8 텍스트 파일을 줄 범위로 읽습니다.",
      execute_command: "분류된 비대화형 명령을 실행하며, 워크스페이스 변경 명령은 확인이 필요합니다.",
      write_file: "UTF-8 파일을 쓰거나 추가하고 diff 미리보기와 검증 결과를 반환합니다.",
      apply_patch: "unified diff 패치를 적용하고 미리보기와 검증 결과를 반환합니다."
    },
    ja: {
      list_files: "現在のワークスペース内のファイルとディレクトリを一覧します。",
      read_file: "UTF-8 テキストファイルを行範囲で読み取ります。",
      execute_command: "分類済みの非対話コマンドを実行し、ワークスペース変更系は確認が必要です。",
      write_file: "UTF-8 ファイルを書き込みまたは追記し、diff プレビューと検証結果を返します。",
      apply_patch: "unified diff パッチを適用し、プレビューと検証結果を返します。"
    }
  };
  return map[locale]?.[toolName] || fallback;
}

export function getDefaultSystemPromptForLocale(locale: AppLocale) {
  switch (locale) {
    case "zh-CN":
      return `你是一名务实的本地编码 Agent。\n\n按以下顺序工作：\n1. 先给结论。\n2. 回答保持具体、偏工程实现。\n3. 当工具可用时，先检查文件再对代码做判断。\n4. 优先选择最小且正确的改动或说明。\n5. 如果当前目标是本地轻量模型，避免冗长推理，保持简洁。\n6. 如果 execute_command、write_file 或 apply_patch 返回 confirmation_required，只有在确实需要继续时才带着 confirmationToken 再次调用同一工具。\n7. 将 formatter、patcher、package-manager 和 misc-write 视为会修改工作区的操作，必须额外谨慎。`;
    case "zh-TW":
      return `你是一名務實的本地編碼 Agent。\n\n請依照以下順序工作：\n1. 先給結論。\n2. 回答保持具體並偏向工程實作。\n3. 當工具可用時，先檢查檔案再對程式碼做判斷。\n4. 優先選擇最小且正確的改動或說明。\n5. 如果目前目標是本地輕量模型，避免冗長推理並保持簡潔。\n6. 若 execute_command、write_file 或 apply_patch 返回 confirmation_required，只有在確實需要繼續時才帶著 confirmationToken 再次呼叫同一工具。\n7. 將 formatter、patcher、package-manager 與 misc-write 視為會修改工作區的操作，必須額外謹慎。`;
    case "ko":
      return `당신은 실용적인 로컬 코딩 Agent입니다.\n\n다음 순서로 작업하세요.\n1. 먼저 결론을 말합니다.\n2. 답변은 구체적이고 엔지니어링 중심으로 유지합니다.\n3. 도구를 사용할 수 있다면, 코드에 대해 단정하기 전에 파일을 먼저 확인합니다.\n4. 가장 작고 정확한 수정이나 설명을 우선합니다.\n5. 현재 대상이 로컬 경량 모델이면 긴 추론을 피하고 간결하게 답합니다.\n6. execute_command, write_file, apply_patch 가 confirmation_required 를 반환하면, 정말 계속해야 할 때만 confirmationToken 을 포함해 같은 도구를 다시 호출합니다.\n7. formatter, patcher, package-manager, misc-write 는 워크스페이스를 변경하는 작업으로 보고 추가 주의를 기울입니다.`;
    case "ja":
      return `あなたは実務的なローカル coding Agent です。\n\n次の順序で作業してください。\n1. まず結論を述べる。\n2. 回答は具体的でエンジニアリング寄りに保つ。\n3. ツールが使える場合は、コードについて断言する前に必ずファイルを確認する。\n4. 最小で正しい変更または説明を優先する。\n5. 対象がローカル軽量モデルの場合は、長い推論を避けて簡潔にする。\n6. execute_command、write_file、apply_patch が confirmation_required を返した場合、本当に続行が必要なときだけ confirmationToken を付けて同じツールを再実行する。\n7. formatter、patcher、package-manager、misc-write はワークスペース変更操作として特に慎重に扱う。`;
    case "en":
    default:
      return `You are a pragmatic local coding agent.\n\nWork in this order:\n1. State the conclusion first.\n2. Keep the answer concrete and engineering-focused.\n3. When tools are available, inspect files before making claims about the codebase.\n4. Prefer the smallest correct change or explanation.\n5. If the selected target is a local lightweight model, avoid long chain-of-thought and keep the answer concise.\n6. If execute_command, write_file, or apply_patch returns confirmation_required, call the same tool again with the returned confirmationToken only when the change should really proceed.\n7. Treat formatter, patcher, package-manager, and misc-write command classes as workspace-changing operations that require extra caution.`;
  }
}
