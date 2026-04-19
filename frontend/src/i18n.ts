import { ProviderType, RoomStatus, UiLocale } from "./types";

type LocalizedText = Record<UiLocale, string>;

const text = (zh: string, en: string): LocalizedText => ({
  "zh-CN": zh,
  "en-US": en,
});

export const STORAGE_KEYS = {
  locale: "magc-ui-locale",
  roomRailCollapsed: "magc-room-rail-collapsed",
  insightPanelCollapsed: "magc-insight-panel-collapsed",
  studioOpen: "magc-studio-open",
  uiScalePreset: "magc-ui-scale-preset",
  chatFontPreset: "magc-chat-font-preset",
  topInfoCollapsed: "magc-top-info-collapsed",
  objectiveCollapsed: "magc-objective-collapsed",
  directionCollapsed: "magc-direction-collapsed",
  languageCollapsed: "magc-language-collapsed",
  documentCollapsed: "magc-document-collapsed",
  rolesCollapsed: "magc-roles-collapsed",
} as const;

export const UI_COPY = {
  brandEyebrow: text("本地多角色讨论", "Local Multi-Agent Discussion"),
  brandTitle: text("研究型群聊工作台", "Research Debate Workspace"),
  brandDescription: text(
    "像群聊一样组织角色对话，让不同立场围绕同一议题进行高密度讨论，并由记录员提炼结论。",
    "Run role-based discussion like a real group chat, then let a recorder extract the strongest findings and conclusion.",
  ),
  localeToggle: text("中文 / EN", "EN / 中文"),
  createRoom: text("新建房间", "New Room"),
  saveRoom: text("保存房间", "Save Room"),
  showConfig: text("显示配置", "Show Config"),
  hideConfig: text("隐藏配置", "Hide Config"),
  collapseTopInfo: text("收起顶部信息", "Collapse Top Info"),
  expandTopInfo: text("展开顶部信息", "Expand Top Info"),
  collapseRooms: text("收起房间栏", "Collapse Rooms"),
  expandRooms: text("展开房间栏", "Expand Rooms"),
  collapseInsights: text("收起纪要栏", "Collapse Insights"),
  expandInsights: text("展开纪要栏", "Expand Insights"),
  collapseObjective: text("收起目标", "Collapse Objective"),
  expandObjective: text("展开目标", "Expand Objective"),
  collapseDirection: text("收起方向", "Collapse Direction"),
  expandDirection: text("展开方向", "Expand Direction"),
  collapseLanguage: text("收起语言", "Collapse Language"),
  expandLanguage: text("展开语言", "Expand Language"),
  collapseDocumentPanel: text("收起文档", "Collapse Document"),
  expandDocumentPanel: text("展开文档", "Expand Document"),
  collapseRoles: text("收起角色", "Collapse Roles"),
  expandRoles: text("展开角色", "Expand Roles"),
  idleHint: text("先整理角色与目标，再开始讨论。", "Refine the roles and objective, then start the discussion."),
  startFresh: text("重新开始", "Start Fresh"),
  step: text("单步推进", "Step"),
  runAll: text("运行到底", "Run All"),
  autoPlay: text("自动播放", "Auto Play"),
  pausePlay: text("暂停播放", "Pause"),
  autoPlayRunning: text("正在按节奏播放群聊消息", "Auto-playing the discussion"),
  stop: text("停止", "Stop"),
  noTranscriptTitle: text("还没有聊天记录", "No transcript yet"),
  noTranscriptBody: text(
    "设定清晰的角色目标并启动讨论，聊天记录会像群消息一样逐步生成。",
    "Define strong role goals and start the room. The transcript will unfold like a real group chat.",
  ),
  userInterventionEyebrow: text("用户插话", "User Intervention"),
  userInterventionTitle: text("补充证据、数据或新观点", "Add evidence, data, or a new angle"),
  userInterventionReady: text(
    "你的发言会写入聊天记录，并在后续轮次被所有角色和记录员一起考虑。",
    "Your message is written into the transcript and will be considered by every role and the recorder in later turns.",
  ),
  userInterventionLocked: text(
    "请先启动讨论。用户插话用于进行中的讨论，而不是在开始前堆积上下文。",
    "Start the discussion first. User intervention is designed for an active discussion, not idle setup.",
  ),
  userInterventionPlaceholder: text(
    "补充数据、反例、政策约束、实验条件或你希望大家回应的新证据。",
    "Add a constraint, dataset detail, counter-example, policy rule, or any other evidence the room should address.",
  ),
  replyingTo: text("正在回复", "Replying to"),
  replyingToRoleImmediate: text("发送后，{name}会立刻回应这条用户发言。", "After you send this, {name} will reply immediately."),
  replyingToGeneric: text("这是一条定向回复，系统会优先处理它。", "This is a directed reply, and the system will prioritize it."),
  reply: text("回复", "Reply"),
  cancelReply: text("取消回复", "Cancel Reply"),
  replyPreviewFallback: text("更早消息", "Earlier message"),
  requiredReplyBadge: text("点名必回", "Required Reply"),
  requiredReplyLabel: text("必须由 {name} 回答", "Required reply: {name}"),
  exchangeStatusTitle: text("当前交流阶段", "Current Exchange"),
  exchangeReasonLabel: text("触发原因", "Trigger"),
  exchangeHardTargetLabel: text("硬性回复目标", "Hard Target"),
  exchangeRespondedLabel: text("已回应角色", "Responded Roles"),
  exchangeOpenLabel: text("交流仍在继续", "Discussion still open"),
  exchangeReason: {
    "topic-start": text("新一轮自然讨论", "Natural discussion"),
    "user-message": text("用户插话触发", "User intervention"),
    "participant-forced-reply": text("角色点名回复", "Participant-forced reply"),
  },
  sendToDiscussion: text("发送到讨论", "Send to Discussion"),
  clear: text("清空", "Clear"),
  displayControlsTitle: text("显示设置", "Display"),
  uiScaleLabel: text("界面大小", "UI Size"),
  chatFontLabel: text("聊天字号", "Chat Text"),
  uiScaleCompact: text("紧凑", "Compact"),
  uiScaleDefault: text("默认", "Default"),
  uiScaleComfortable: text("宽松", "Comfortable"),
  chatFontSmall: text("小", "Small"),
  chatFontMedium: text("中", "Medium"),
  chatFontLarge: text("大", "Large"),
  loadFailed: text("加载数据失败。", "Failed to load data."),
  operationFailed: text("操作失败。", "Operation failed."),
  autoPlayFailed: text("自动播放失败。", "Auto play failed."),
  composerStep: text("单步推进", "Step"),
  finalVerdictEyebrow: text("最终结论", "Final Verdict"),
  finalVerdictTitle: text("结论", "Conclusion"),
  finalVerdictEmpty: text("记录员会在这里放置最终结论。", "The recorder will place the final conclusion here."),
  summarySpotlightEyebrow: text("讨论结果", "Discussion Outcome"),
  summarySpotlightTitle: text("最终讨论结论", "Final Discussion Conclusion"),
  summarySpotlightHint: text("这是本房间最核心的输出，可直接导出为笔记。", "This is the core output of the room and can be exported directly as notes."),
  downloadFinalMd: text("导出最终结论 .md", "Export Final .md"),
  downloadFinalTxt: text("导出最终结论 .txt", "Export Final .txt"),
  downloadNotesMd: text("导出完整纪要 .md", "Export Full Notes .md"),
  savedInsightsEyebrow: text("已保存纪要", "Saved Insights"),
  savedInsightsTitle: text("关键纪要", "Saved Highlights"),
  savedInsightsEmpty: text("把关键 checkpoint 或 final conclusion 保存下来，方便持续查看。", "Save any checkpoint or final conclusion you want to keep visible."),
  checkpointsEyebrow: text("阶段纪要", "Checkpoint Notes"),
  checkpointsTitle: text("轮次记录", "Round Notes"),
  checkpointsEmpty: text("启用记录员后，每一轮的阶段纪要会出现在这里。", "Checkpoint notes appear here after each round when the recorder is enabled."),
  roomTab: text("房间", "Room"),
  rolesTab: text("角色", "Roles"),
  presetsTab: text("配置套件", "Provider Presets"),
  roomConfigEyebrow: text("房间配置", "Room Config"),
  roomConfigTitle: text("讨论设置", "Discussion Setup"),
  deleteRoom: text("删除房间", "Delete Room"),
  roomTitleLabel: text("标题", "Title"),
  maxRoundsLabel: text("最大轮次", "Max Rounds"),
  topicLabel: text("议题", "Topic"),
  topicDocumentDefault: text("恢复默认 Topic", "Use Default Topic"),
  topicDocumentRecorder: text("用记录员 AI 生成 Topic", "Generate Topic with Recorder AI"),
  objectiveLabel: text("讨论目标", "Decision Objective"),
  discussionLanguageLabel: text("讨论语言", "Discussion Language"),
  researchDirectionLabel: text("研究方向", "Research Direction"),
  researchDirectionNoteLabel: text("研究方向补充", "Research Direction Note"),
  customDirectionLibraryTitle: text("自定义研究方向库", "Custom Research Direction Library"),
  customDirectionLibraryHint: text("内置方向保留，自定义方向可新增、修改和删除。", "Built-in directions stay fixed; custom ones can be added, edited, and removed."),
  addCustomDirection: text("新增方向", "Add Direction"),
  saveCustomDirection: text("保存方向", "Save Direction"),
  deleteCustomDirection: text("删除方向", "Delete Direction"),
  customDirectionNameLabel: text("方向名称", "Direction Name"),
  customDirectionDescriptionLabel: text("方向描述 / 背景", "Direction Description / Background"),
  customDirectionNamePrompt: text("输入新的研究方向名称", "Enter a name for the new research direction"),
  customDirectionDescriptionPrompt: text("输入该研究方向的背景、关注点或说明", "Enter background, focus, or notes for this direction"),
  deleteCustomDirectionConfirm: text("确定删除自定义方向“{name}”吗？", "Delete custom direction \"{name}\"?"),
  customDirectionEmpty: text("还没有自定义方向。你可以新增如密码学、控制理论等方向。", "No custom directions yet. Add directions such as cryptography or control theory."),
  customDirectionLabel: text("自定义", "Custom"),
  inUseLabel: text("当前使用", "In Use"),
  autoRunDelayLabel: text("自动播放间隔（秒）", "Auto Play Delay (seconds)"),
  researchDirectionNotePlaceholder: text(
    "补充更细的场景、对象、约束、应用背景或评审语境。",
    "Add a narrower scenario, object, constraint, application context, or review setting.",
  ),
  checkpointEveryRoundLabel: text("每阶段生成记录员纪要", "Generate recorder notes after each exchange"),
  roleStudioEyebrow: text("角色工作台", "Role Studio"),
  roleStudioTitle: text("带目标的角色", "Roles With Goals"),
  addParticipant: text("新增参与者", "Add Participant"),
  addRecorder: text("新增记录员", "Add Recorder"),
  roleEditorEmpty: text("先选中一个角色再编辑。", "Select a role to edit it."),
  roleDefinitionHint: text(
    "角色要尽量短，但必须明确身份、目标、判断标准和说话风格。",
    "Keep the role compact, but make the identity, goal, evaluation standard, and speaking style explicit.",
  ),
  removeRole: text("删除角色", "Remove Role"),
  roleNameLabel: text("角色名称", "Role Name"),
  roleTemplateLabel: text("角色模板", "Role Template"),
  accentColorLabel: text("强调色", "Accent Color"),
  enableRoleLabel: text("启用这个角色", "Enable this role"),
  presetLabel: text("Provider 套件", "Provider Preset"),
  noPreset: text("不使用套件", "No preset"),
  personaLabel: text("Persona", "Persona"),
  goalLabel: text("Goal", "Goal"),
  strategyLabel: text("Strategy", "Strategy"),
  voiceStyleLabel: text("Voice Style", "Voice Style"),
  saveCurrentProviderPreset: text("把当前 Provider 保存为套件", "Save Current Provider as Preset"),
  managePresets: text("管理套件", "Manage Presets"),
  advancedProviderSettings: text("高级 Provider 设置", "Advanced Provider Settings"),
  providerPresetsEyebrow: text("Provider 套件", "Provider Presets"),
  providerPresetsTitle: text("可复用的 API / Agent 配置", "Reusable API / Agent Setups"),
  providerGuide: text("接入指南", "Guide"),
  closeGuide: text("关闭指南", "Close Guide"),
  newPreset: text("新建套件", "New Preset"),
  duplicatePreset: text("复制一份", "Duplicate"),
  savePreset: text("保存套件", "Save Preset"),
  deletePreset: text("删除", "Delete"),
  presetEditorEmpty: text("选中一个 Provider 套件后再查看或编辑。", "Select one provider preset to inspect or edit it."),
  builtInPresetHint: text("内置套件只读。先复制一份，再做定制。", "Built-in presets are read-only. Duplicate one to customize it."),
  customPresetHint: text("保存一次，后面就可以给多个角色反复套用。", "Save once, then reuse this provider setup across multiple roles."),
  applyToCurrentRole: text("应用到当前角色", "Apply to Current Role"),
  guideIntroTitle: text("如何接入 Agent / 大模型", "How to Connect Agents / Models"),
  guideMockTitle: text("Mock Demo", "Mock Demo"),
  guideMockBody: text("仅用于离线演示和界面测试，不会调用真实模型或本地 agent。", "For offline demos and UI testing only. It does not call a real model or local agent."),
  guideOpenAITitle: text("OpenAI-Compatible", "OpenAI-Compatible"),
  guideOpenAIBody: text("适用于 OpenAI、Ollama、vLLM 等兼容 /v1/chat/completions 的服务。填写 Endpoint、Model，必要时再填 API Key。", "Use this for OpenAI, Ollama, vLLM, or any /v1/chat/completions compatible service. Fill Endpoint and Model, then API Key if required."),
  guideCustomTitle: text("Custom HTTP", "Custom HTTP"),
  guideCustomBody: text(
    "适用于你自己的本地 agent bridge 或服务。项目后端会把房间上下文、角色信息和 prompt 以 JSON POST 给你的服务；你至少返回 content，也可以附带 replyToMessageId 和 forceReplyRoleId。",
    "Use this for your own local agent bridge or service. The backend POSTs room context, role info, and prompt as JSON. Your service must return content, and can optionally include replyToMessageId and forceReplyRoleId.",
  ),
  guideCodexTitle: text("Codex CLI", "Codex CLI"),
  guideCodexBody: text("适用于本地直接调用 Codex。Model 建议留空，让 Codex 自动选择当前账号可用的默认模型；如果本机别名不可用，改成 Command=npx，Launcher Args=-y @openai/codex。", "Use this to call Codex locally. Leave Model blank so Codex can choose the default model available to the current account. If the alias is unavailable, switch to Command=npx and Launcher Args=-y @openai/codex."),
  guideLocalAgentTitle: text("本地 Agent 推荐路线", "Local Agent Recommendation"),
  guideLocalAgentBody: text("想直接让本机 CLI 型 agent 说话，用 Codex CLI；想接任意本地 agent 或多步代理系统，用 Custom HTTP bridge。流程：群聊角色 -> 本项目后端 -> 本地 bridge/CLI -> agent。", "Use Codex CLI for a local CLI-style agent. Use a Custom HTTP bridge for any local agent service or multi-step agent system. Flow: chat role -> app backend -> local bridge/CLI -> agent."),
  presetNameLabel: text("套件名称", "Preset Name"),
  descriptionLabel: text("说明", "Description"),
  providerLabel: text("Provider", "Provider"),
  modelLabel: text("模型", "Model"),
  endpointLabel: text("接口地址", "Endpoint"),
  apiKeyLabel: text("API Key", "API Key"),
  temperatureLabel: text("Temperature", "Temperature"),
  maxTokensLabel: text("Max Tokens", "Max Tokens"),
  commandLabel: text("命令", "Command"),
  launcherArgsLabel: text("启动参数", "Launcher Args"),
  workingDirectoryLabel: text("工作目录", "Working Directory"),
  timeoutLabel: text("超时（毫秒）", "Timeout (ms)"),
  sandboxLabel: text("沙箱", "Sandbox"),
  skipRepoCheckLabel: text("跳过 Git 仓库检查", "Skip Git repo check"),
  apiKeyPlaceholder: text("只保存在本地", "Stored locally only"),
  presetNamePrompt: text("套件名称", "Preset name"),
  presetDescriptionPrompt: text("套件说明", "Preset description"),
  createPresetDefaultName: text("自定义 Provider 套件", "Custom Provider Preset"),
  savePresetDefaultNameSuffix: text(" Provider 套件", " Provider"),
  duplicatePresetPrompt: text("复制套件为", "Duplicate preset as"),
  duplicatePresetSuffix: text(" 副本", " Copy"),
  deleteRoomConfirm: text("确定删除房间“{name}”吗？", "Delete room \"{name}\"?"),
  deletePresetConfirm: text("确定删除套件“{name}”吗？", "Delete preset \"{name}\"?"),
  customDirectionDefaultName: text("自定义研究方向", "Custom Research Direction"),
  documentSourceTitle: text("文档材料", "Document Source"),
  documentSourceHint: text(
    "上传 PDF、DOCX、TXT 或 Markdown，让房间围绕文档内容展开讨论。",
    "Upload a PDF, DOCX, TXT, or Markdown file so the room can discuss the document itself.",
  ),
  uploadDocument: text("上传文档", "Upload Document"),
  replaceDocument: text("替换文档", "Replace Document"),
  removeDocument: text("移除文档", "Remove Document"),
  documentModeWhole: text("整篇讨论", "Whole Document"),
  documentModeSelected: text("选中片段", "Selected Segments"),
  documentModeLabel: text("讨论模式", "Discussion Mode"),
  documentStatusLabel: text("解析状态", "Parse Status"),
  documentStatusIdle: text("未导入", "Idle"),
  documentStatusProcessing: text("解析中", "Processing"),
  documentStatusReady: text("已就绪", "Ready"),
  documentStatusPartial: text("部分完成", "Partial"),
  documentStatusFailed: text("解析失败", "Failed"),
  documentPageCountLabel: text("页数", "Pages"),
  documentCharCountLabel: text("字符数", "Characters"),
  documentOutlineTitle: text("章节 / 片段", "Sections / Segments"),
  documentOutlineEmpty: text("当前文档没有可用片段。", "No usable segments were extracted from the current document."),
  documentSelectedCount: text("已选 {count} 个片段", "{count} segments selected"),
  documentWholeActive: text("当前按整篇文档讨论。", "The whole document is currently used for discussion."),
  documentFocusMissing: text("长文模式下，请至少选择一个章节或片段。", "Select at least one section or excerpt for long-document discussion."),
  documentFocusCurrent: text("当前焦点", "Current Focus"),
  documentNoAsset: text("当前房间还没有文档材料。", "No document is attached to this room yet."),
  documentWarningsTitle: text("解析提示", "Parsing Warnings"),
  documentGenerateDefaultTopic: text("重新生成默认 Topic", "Regenerate Default Topic"),
  documentGenerateRecorderDisabled: text("需要启用非 Mock 的记录员 provider。", "An enabled non-mock recorder provider is required."),
  documentUploadFailed: text("文档上传失败。", "Failed to upload the document."),
  documentDeleteConfirm: text("确定移除当前文档“{name}”吗？", "Remove the current document \"{name}\"?"),
  documentKind: {
    pdf: text("PDF", "PDF"),
    docx: text("Word 文档", "Word Document"),
    txt: text("文本文件", "Text File"),
    md: text("Markdown", "Markdown"),
  } satisfies Record<"pdf" | "docx" | "txt" | "md", LocalizedText>,
  loading: text("正在加载讨论工作台…", "Loading workspace..."),
  participantCount: text("参与者", "Participants"),
  roundsLabel: text("轮次", "Rounds"),
  savedLabel: text("已保存", "Saved"),
  unsavedLabel: text("保存此纪要", "Save This Insight"),
  showDetails: text("展开全文", "Expand Details"),
  checkpointBadge: text("Checkpoint", "Checkpoint"),
  finalBadge: text("Final", "Final"),
  discussionLanguageZh: text("中文", "Chinese"),
  discussionLanguageEn: text("英文", "English"),
  presetBuiltIn: text("内置", "Built-in"),
  presetCustom: text("自定义", "Custom"),
  participantTag: text("参与者", "Participant"),
  recorderTag: text("记录员", "Recorder"),
  roomSectionTopic: text("议题", "Topic"),
  roomSectionObjective: text("目标", "Objective"),
  roomSectionDirection: text("方向", "Direction"),
  roomSectionLanguage: text("语言", "Language"),
  roomSectionRoles: text("角色", "Roles"),
  roleStripEmpty: text("暂无启用角色", "No active roles"),
  chatTurns: text("消息", "Messages"),
  activeRound: text("当前轮次", "Current Round"),
  checkpointIntervalLabel: text("纪要间隔（轮次）", "Checkpoint Interval (Rounds)"),
  checkpointIntervalHint: text("0 表示关闭中途纪要，只保留最终结论。", "Use 0 to disable mid-discussion checkpoints and keep only the final conclusion."),
  messageMeta: text("第 {round} 轮 · 第 {turn} 条 · {time}", "Round {round} · Turn {turn} · {time}"),
  insightMeta: text("第 {round} 轮 · {time}", "Round {round} · {time}"),
  noteHeadingTopic: text("议题", "Topic"),
  noteHeadingObjective: text("目标", "Objective"),
  noteHeadingFinal: text("最终结论", "Final Conclusion"),
  noteHeadingCheckpoint: text("阶段纪要 {index}", "Checkpoint {index}"),
  mockProviderHint: text(
    "Mock provider 适合离线演示、界面检查和 prompt 迭代，不会调用真实模型。",
    "Mock provider is useful for offline demos, layout checks, and prompt iteration without calling a real model.",
  ),
  guideFlowText: text(
    "群聊角色 -> 本项目后端 ->\nCustom HTTP bridge 或 Codex CLI -> 本地 agent / model",
    "Chat role -> app backend ->\nCustom HTTP bridge or Codex CLI -> local agent / model",
  ),
  status: {
    idle: text("未开始", "Idle"),
    running: text("进行中", "Running"),
    stopped: text("已停止", "Stopped"),
    completed: text("已完成", "Completed"),
  },
  builtInPresetName: {
    mock: text("Mock 演示套组", "Mock Demo Preset"),
    "openai-compatible": text("OpenAI 兼容 API 套组", "OpenAI-Compatible API Preset"),
    "custom-http": text("自定义 HTTP Agent 套组", "Custom HTTP Agent Preset"),
    "codex-cli": text("本地 Codex CLI 套组", "Local Codex CLI Preset"),
  } satisfies Record<ProviderType, LocalizedText>,
  builtInPresetDescription: {
    mock: text("用于离线演示和冒烟测试的确定性 provider。", "Offline deterministic provider for demos and smoke tests."),
    "openai-compatible": text("适用于任意兼容 /v1/chat/completions 的服务。", "Any /v1/chat/completions style API endpoint."),
    "custom-http": text("通过 POST JSON 调用你自己的本地 agent bridge。", "Call your own local agent bridge via POST JSON."),
    "codex-cli": text(
      "在本地运行 Codex CLI；Model 建议留空，如别名不可用可改成 npx + @openai/codex。",
      "Run Codex locally. Leave Model blank to use Codex defaults; if the alias is unavailable, switch to npx with @openai/codex.",
    ),
  } satisfies Record<ProviderType, LocalizedText>,
  providerType: {
    mock: text("Mock 演示", "Mock Demo"),
    "openai-compatible": text("OpenAI 兼容 API", "OpenAI-Compatible API"),
    "custom-http": text("自定义 HTTP Agent", "Custom HTTP Agent"),
    "codex-cli": text("本地 Codex CLI", "Local Codex CLI"),
  } satisfies Record<ProviderType, LocalizedText>,
};

export function getText(locale: UiLocale, value: LocalizedText): string {
  return value[locale];
}

export function formatTemplate(locale: UiLocale, template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((current, [key, value]) => current.replace(`{${key}}`, value), template);
}

export function getStatusLabel(locale: UiLocale, status: RoomStatus): string {
  return UI_COPY.status[status][locale];
}

export function getProviderTypeLabel(locale: UiLocale, providerType: ProviderType): string {
  return UI_COPY.providerType[providerType][locale];
}

export function getExchangeReasonLabel(locale: UiLocale, reason: "topic-start" | "user-message" | "participant-forced-reply"): string {
  return UI_COPY.exchangeReason[reason][locale];
}

export function getBuiltInPresetName(locale: UiLocale, providerType: ProviderType): string {
  return UI_COPY.builtInPresetName[providerType][locale];
}

export function getBuiltInPresetDescription(locale: UiLocale, providerType: ProviderType): string {
  return UI_COPY.builtInPresetDescription[providerType][locale];
}

export function localizeKnownError(locale: UiLocale, message: string): string {
  switch (message) {
    case "Room not found.":
      return text("房间不存在。", "Room not found.")[locale];
    case "Provider preset not found.":
      return text("Provider 套组不存在。", "Provider preset not found.")[locale];
    case "Preset not found or cannot be deleted.":
      return text("套组不存在，或当前不可删除。", "Preset not found or cannot be deleted.")[locale];
    case "Research direction not found.":
      return text("研究方向不存在。", "Research direction not found.")[locale];
    case "Built-in presets are read-only. Duplicate one if you want to customize it.":
      return text("内置套组是只读的；如果要修改，请先复制一份。", "Built-in presets are read-only. Duplicate one if you want to customize it.")[locale];
    case "At least one enabled participant role is required.":
      return text("至少需要一个启用中的参与者角色。", "At least one enabled participant role is required.")[locale];
    case "The discussion is not currently running.":
      return text("当前讨论并未处于运行状态。", "The discussion is not currently running.")[locale];
    case "User message cannot be empty.":
      return text("用户发言不能为空。", "User message cannot be empty.")[locale];
    case "Insight not found.":
      return text("未找到对应纪要。", "Insight not found.")[locale];
    case "Discussion exceeded the safety step limit and was stopped.":
      return text("讨论超过安全步数上限，已被停止。", "Discussion exceeded the safety step limit and was stopped.")[locale];
    case "No document file was uploaded.":
      return text("没有上传文档文件。", "No document file was uploaded.")[locale];
    case "Failed to attach document.":
      return text("挂载文档失败。", "Failed to attach document.")[locale];
    case "Unsupported document format. Supported formats: PDF, DOCX, TXT, MD.":
      return text("不支持该文档格式，当前只支持 PDF、DOCX、TXT、MD。", "Unsupported document format. Supported formats: PDF, DOCX, TXT, MD.")[locale];
    case "No document is attached to this room.":
      return text("当前房间还没有挂载文档。", "No document is attached to this room.")[locale];
    case "Failed to update document focus.":
      return text("更新文档焦点失败。", "Failed to update document focus.")[locale];
    case "Failed to generate the default topic.":
      return text("生成默认 Topic 失败。", "Failed to generate the default topic.")[locale];
    case "Failed to generate a recorder topic.":
      return text("用记录员生成 Topic 失败。", "Failed to generate a recorder topic.")[locale];
    case "Whole-document mode is only available for shorter documents.":
      return text("只有较短文档才支持整篇讨论模式。", "Whole-document mode is only available for shorter documents.")[locale];
    case "Document parsing is still running. Wait until parsing finishes before starting the discussion.":
      return text("文档仍在解析中，请等待完成后再开始讨论。", "Document parsing is still running. Wait until parsing finishes before starting the discussion.")[locale];
    case "The current document could not be parsed. Replace it or remove it before starting the discussion.":
      return text("当前文档解析失败，请替换或移除后再开始讨论。", "The current document could not be parsed. Replace it or remove it before starting the discussion.")[locale];
    case "Select at least one document section or excerpt before starting the discussion.":
      return text("开始讨论前，请至少选择一个文档章节或片段。", "Select at least one document section or excerpt before starting the discussion.")[locale];
    case "Attach a document before asking the recorder to generate a topic.":
      return text("请先上传文档，再让记录员生成 Topic。", "Attach a document before asking the recorder to generate a topic.")[locale];
    case "Enable a recorder role before generating a topic with recorder AI.":
      return text("请先启用记录员角色，再用记录员 AI 生成 Topic。", "Enable a recorder role before generating a topic with recorder AI.")[locale];
    case "Recorder provider is unavailable for AI topic generation.":
      return text("记录员 provider 当前不可用于 AI Topic 生成。", "Recorder provider is unavailable for AI topic generation.")[locale];
    default:
      if (message.startsWith("The working directory does not exist:")) {
        return locale === "zh-CN" ? `工作目录不存在：${message.slice("The working directory does not exist:".length).trim()}` : message;
      }
      if (message === "The local CLI could not be spawned on Windows. Use a real executable or `.cmd` launcher such as `D:\\nodejs\\npx.cmd`, and make sure the working directory exists.") {
        return locale === "zh-CN"
          ? "Windows 下无法启动本地 CLI。请使用真实可执行文件或 `.cmd` 启动器（例如 `D:\\nodejs\\npx.cmd`），并确认工作目录存在。"
          : message;
      }
      if (message.startsWith("Codex CLI rejected")) {
        return locale === "zh-CN"
          ? "Codex CLI 当前登录态不支持这个模型。把 Model 留空，让 Codex 自动选择默认模型，或改成你的账号支持的模型。"
          : message;
      }
      if (message.startsWith("Codex CLI failed:")) {
        return locale === "zh-CN" ? `Codex CLI 执行失败：${message.slice("Codex CLI failed:".length).trim()}` : message;
      }
      if (message.startsWith("Request failed:")) {
        return locale === "zh-CN" ? `请求失败：${message.slice("Request failed:".length).trim()}` : message;
      }
      return message;
  }
}

export function getDocumentKindLabel(locale: UiLocale, fileKind: "pdf" | "docx" | "txt" | "md"): string {
  return UI_COPY.documentKind[fileKind][locale];
}

export function localizeDocumentWarning(locale: UiLocale, warning: string): string {
  if (warning === "pdf_render_tool_missing") {
    return locale === "zh-CN" ? "缺少 PDF 渲染工具，无法对低文本页做 OCR。" : "PDF rendering tool is missing, so OCR fallback cannot run on low-text pages.";
  }
  if (warning === "pdf_ocr_tool_missing") {
    return locale === "zh-CN" ? "缺少 OCR 工具，扫描页只能做部分解析。" : "OCR tool is missing, so scanned pages can only be partially parsed.";
  }
  if (warning === "pdf_section_fallback_to_pages") {
    return locale === "zh-CN" ? "未稳定识别章节目录，已回退为按页讨论。" : "No stable section outline was detected, so the document fell back to page-based segments.";
  }
  if (warning === "docx_heading_fallback_to_blocks") {
    return locale === "zh-CN" ? "未稳定识别 Word 标题层级，已回退为按文本块讨论。" : "DOCX headings were not detected reliably, so the document fell back to block-based segments.";
  }
  if (warning === "markdown_heading_fallback_to_blocks") {
    return locale === "zh-CN" ? "Markdown 未检测到有效标题，已回退为按文本块讨论。" : "Markdown headings were not detected, so the document fell back to block-based segments.";
  }
  if (warning === "empty_document_text") {
    return locale === "zh-CN" ? "解析后没有得到可讨论的正文内容。" : "No usable discussion text was extracted from the document.";
  }
  if (warning.startsWith("encoding_fallback:")) {
    const encoding = warning.split(":")[1] || "unknown";
    return locale === "zh-CN" ? `文本文件读取时回退到了 ${encoding} 编码。` : `The text file fell back to ${encoding} encoding during parsing.`;
  }
  if (warning.startsWith("pdf_render_failed:")) {
    const page = warning.split(":")[1] || "?";
    return locale === "zh-CN" ? `第 ${page} 页渲染失败，无法执行 OCR。` : `Page ${page} could not be rendered for OCR.`;
  }
  if (warning.startsWith("pdf_ocr_failed:")) {
    const page = warning.split(":")[1] || "?";
    return locale === "zh-CN" ? `第 ${page} 页 OCR 失败。` : `OCR failed on page ${page}.`;
  }
  if (warning === "docx_missing_document_xml") {
    return locale === "zh-CN" ? "DOCX 缺少核心正文 XML，无法解析。" : "The DOCX file is missing its main document XML and could not be parsed.";
  }
  return warning;
}
