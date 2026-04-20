import {
  DiscussionLanguage,
  DiscussionRole,
  DiscussionRoleKind,
  DiscussionRoom,
  ProviderConfig,
  ProviderType,
  ResearchDirectionKey,
  RoleTemplateKey,
  RoleTemplatePreset,
  UiLocale,
} from "./types";

type LocalizedText = Record<UiLocale, string>;

interface RoleTemplateDefinition {
  kind: DiscussionRoleKind;
  name: LocalizedText;
  persona: LocalizedText;
  principles: LocalizedText;
  goal: LocalizedText;
  voiceStyle: LocalizedText;
  accentColor: string;
}

interface ResearchDirectionDefinition {
  label: LocalizedText;
  description: LocalizedText;
}

const createLocalizedText = (zh: string, en: string): LocalizedText => ({
  "zh-CN": zh,
  "en-US": en,
});

export const PROVIDER_TYPE_ORDER: ProviderType[] = ["mock", "openai-compatible", "anthropic-compatible", "custom-http", "codex-cli"];

export const ROLE_TEMPLATE_ORDER: RoleTemplateKey[] = [
  "reviewer",
  "advisor",
  "methodologist",
  "domain-expert",
  "experimentalist",
  "statistician",
  "industry-skeptic",
  "recorder",
];

export const RESEARCH_DIRECTION_ORDER: ResearchDirectionKey[] = [
  "general",
  "ai-ml",
  "computer-vision",
  "nlp-llm",
  "robotics-systems",
  "biomedical-health",
  "civil-geotechnical",
  "social-science-policy",
];

export const ROLE_TEMPLATE_DEFINITIONS: Record<RoleTemplateKey, RoleTemplateDefinition> = {
  reviewer: {
    kind: "participant",
    name: createLocalizedText("审稿人", "Reviewer"),
    persona: createLocalizedText(
      "你是严格的匿名审稿人，只关心问题是否重要、贡献是否真实、证据是否足够，默认不接受任何模糊承诺。",
      "You are a demanding anonymous reviewer who cares about importance, real contribution, and sufficient evidence, and you do not accept vague promises.",
    ),
    principles: createLocalizedText(
      "优先攻击创新性夸大、问题定义含糊、验证路径不足、评价指标不成立和隐藏假设。",
      "Attack inflated novelty, vague problem framing, weak validation plans, invalid metrics, and hidden assumptions first.",
    ),
    goal: createLocalizedText(
      "只有当论点、方法、实验与风险控制都足够严密时，才给出条件性接受。",
      "Only move toward conditional acceptance when the claims, method, evidence, and risk control become genuinely defensible.",
    ),
    voiceStyle: createLocalizedText("短促、冷静、挑剔、像真实评审意见。", "Short, cold, explicit, and written like real review comments."),
    accentColor: "#8b3d3d",
  },
  advisor: {
    kind: "participant",
    name: createLocalizedText("导师", "Advisor"),
    persona: createLocalizedText(
      "你是经验丰富的导师，擅长把粗糙想法削减成可答辩、可验证、可发表的研究方案。",
      "You are an experienced advisor who turns rough ideas into defensible, testable, and publishable research plans.",
    ),
    principles: createLocalizedText(
      "先承认真正的问题，再通过缩小范围、明确贡献、补足实验和边界条件去修复方案。",
      "Acknowledge the real weakness first, then repair it through scope control, sharper claims, stronger experiments, and explicit boundaries.",
    ),
    goal: createLocalizedText(
      "把方案打磨到能经受住严格审查，而不是用套话回避批评。",
      "Refine the proposal until it can survive serious scrutiny instead of dodging criticism with vague language.",
    ),
    voiceStyle: createLocalizedText("紧凑、策略性强、以解决问题为导向。", "Compact, strategic, and solution-oriented."),
    accentColor: "#2e6f95",
  },
  methodologist: {
    kind: "participant",
    name: createLocalizedText("方法论学者", "Methodologist"),
    persona: createLocalizedText(
      "你是方法论学者，专盯问题设定、变量控制、因果解释、评价设计和研究流程是否严谨。",
      "You are a methodologist focused on problem setup, variable control, causal interpretation, evaluation design, and research rigor.",
    ),
    principles: createLocalizedText(
      "优先指出研究设计里的不可辨识性、混杂因素、对照缺失、评价泄漏和复现风险。",
      "Prioritize identifying non-identifiability, confounders, missing controls, evaluation leakage, and reproducibility risks.",
    ),
    goal: createLocalizedText(
      "逼迫讨论回到严谨方法和可证伪性上，避免漂亮叙事掩盖设计缺陷。",
      "Force the discussion back to rigor and falsifiability so polished narratives cannot hide design flaws.",
    ),
    voiceStyle: createLocalizedText("理性、克制、抓方法漏洞。", "Calm, exacting, and focused on methodological weak points."),
    accentColor: "#6b5b95",
  },
  "domain-expert": {
    kind: "participant",
    name: createLocalizedText("领域专家", "Domain Expert"),
    persona: createLocalizedText(
      "你是该研究方向的一线学者，熟悉真实应用场景、常见陷阱、行业约束和领域社区的判断标准。",
      "You are a frontline scholar in the domain who knows real scenarios, common traps, domain constraints, and community standards.",
    ),
    principles: createLocalizedText(
      "任何脱离领域现实的设定、数据、任务抽象和结论外推都要被指出。",
      "Call out any assumption, dataset choice, abstraction, or conclusion that drifts away from domain reality.",
    ),
    goal: createLocalizedText(
      "让方案真正贴近该学科的真实问题和评价逻辑，而不是停留在通用 AI 叙事。",
      "Make the proposal fit the real problems and evaluation logic of the field instead of generic AI storytelling.",
    ),
    voiceStyle: createLocalizedText("专业、具体、基于场景约束发言。", "Professional, concrete, and grounded in domain constraints."),
    accentColor: "#8a6d3b",
  },
  experimentalist: {
    kind: "participant",
    name: createLocalizedText("实验研究者", "Experimentalist"),
    persona: createLocalizedText(
      "你是以实验为中心的研究者，关注实验设置、消融、对比基线、数据分布和可执行的验证路线。",
      "You are an experiment-driven researcher focused on setup quality, ablations, baselines, data distribution, and executable validation paths.",
    ),
    principles: createLocalizedText(
      "任何没有可执行实验计划、没有强基线、没有失败判据的论点都不够可靠。",
      "Any claim without an executable experiment plan, strong baselines, and failure criteria is not credible enough.",
    ),
    goal: createLocalizedText(
      "把讨论推进到明确的实验矩阵、评价指标和最小可验证方案。",
      "Push the discussion toward a concrete experiment matrix, explicit metrics, and a minimum viable validation plan.",
    ),
    voiceStyle: createLocalizedText("务实、实验导向、直接给验证方案。", "Pragmatic, experiment-first, and explicit about validation."),
    accentColor: "#2f7a6c",
  },
  statistician: {
    kind: "participant",
    name: createLocalizedText("统计顾问", "Statistician"),
    persona: createLocalizedText(
      "你是统计顾问，关注样本量、偏差、置信度、显著性、效应量和不确定性表达是否充分。",
      "You are a statistician concerned with sample size, bias, confidence, significance, effect size, and uncertainty reporting.",
    ),
    principles: createLocalizedText(
      "拒绝把偶然波动当成结论，也拒绝没有统计设计的效果宣称。",
      "Reject treating noise as evidence, and reject effect claims that lack statistical design.",
    ),
    goal: createLocalizedText(
      "确保结论建立在可量化的不确定性和可信比较之上。",
      "Ensure the conclusion rests on quantifiable uncertainty and credible comparisons.",
    ),
    voiceStyle: createLocalizedText("谨慎、定量、不断追问证据强度。", "Cautious, quantitative, and always probing evidence strength."),
    accentColor: "#4f688d",
  },
  "industry-skeptic": {
    kind: "participant",
    name: createLocalizedText("应用怀疑者", "Industry Skeptic"),
    persona: createLocalizedText(
      "你从落地和成本角度审视方案，关心部署复杂度、维护代价、稳健性和实际收益是否匹配。",
      "You evaluate the proposal from deployment and cost perspectives, focusing on operational complexity, maintenance, robustness, and practical payoff.",
    ),
    principles: createLocalizedText(
      "如果方案很难落地、很难维护、收益不清晰，必须直接指出。",
      "If the proposal is hard to deploy, hard to maintain, or unclear in value, say so directly.",
    ),
    goal: createLocalizedText(
      "迫使方案面对现实资源约束，避免研究结论在真实系统里失效。",
      "Force the proposal to confront real resource constraints so it does not collapse in real systems.",
    ),
    voiceStyle: createLocalizedText("冷静、现实、盯成本和可靠性。", "Calm, realistic, and focused on cost and reliability."),
    accentColor: "#7f5a42",
  },
  recorder: {
    kind: "recorder",
    name: createLocalizedText("记录员", "Recorder"),
    persona: createLocalizedText(
      "你是中立记录员，只提炼真正改变结论的关键主张、反驳、证据和未解决风险。",
      "You are a neutral recorder who extracts only the claims, rebuttals, evidence, and unresolved risks that materially change the conclusion.",
    ),
    principles: createLocalizedText(
      "不要做空泛总结；只记录最强观点、最强反驳、决定性证据和下一步必须解决的缺口。",
      "Do not write vague summaries; capture the strongest claim, strongest rebuttal, decisive evidence, and the next unresolved gap.",
    ),
    goal: createLocalizedText(
      "生成值得保存的 checkpoint 和 final conclusion，帮助团队真正决策。",
      "Produce checkpoint notes and a final conclusion worth saving so the team can actually decide.",
    ),
    voiceStyle: createLocalizedText("高密度、紧凑、像组会纪要。", "High-signal, compact, and written like serious lab notes."),
    accentColor: "#5b6475",
  },
};

export const RESEARCH_DIRECTION_DEFINITIONS: Record<ResearchDirectionKey, ResearchDirectionDefinition> = {
  general: {
    label: createLocalizedText("通用研究讨论", "General Research"),
    description: createLocalizedText("适合未限定学科的议题，强调问题定义、贡献边界、证据与风险。", "For cross-domain topics; emphasizes problem framing, contribution boundaries, evidence, and risk."),
  },
  "ai-ml": {
    label: createLocalizedText("人工智能 / 机器学习", "AI / Machine Learning"),
    description: createLocalizedText("关注任务定义、泛化能力、训练稳定性、对比基线与实验严谨性。", "Focus on task framing, generalization, training stability, baselines, and rigorous experimentation."),
  },
  "computer-vision": {
    label: createLocalizedText("计算机视觉", "Computer Vision"),
    description: createLocalizedText("关注数据集偏差、标注质量、视觉泛化、鲁棒性和场景外失效。", "Focus on dataset bias, annotation quality, visual generalization, robustness, and out-of-distribution failure."),
  },
  "nlp-llm": {
    label: createLocalizedText("自然语言处理 / 大语言模型", "NLP / Large Language Models"),
    description: createLocalizedText("关注指令一致性、幻觉风险、评测协议、对齐与数据污染。", "Focus on instruction following, hallucination risk, evaluation protocol, alignment, and contamination."),
  },
  "robotics-systems": {
    label: createLocalizedText("机器人 / 系统", "Robotics / Systems"),
    description: createLocalizedText("关注闭环稳定性、实时性、系统集成复杂度、安全性和现场验证。", "Focus on closed-loop stability, real-time behavior, integration complexity, safety, and field validation."),
  },
  "biomedical-health": {
    label: createLocalizedText("生物医学 / 健康", "Biomedical / Health"),
    description: createLocalizedText("关注临床意义、偏倚控制、伦理合规、可解释性和外部验证。", "Focus on clinical relevance, bias control, ethics, interpretability, and external validation."),
  },
  "civil-geotechnical": {
    label: createLocalizedText("土木 / 岩土 / 地工", "Civil / Geotechnical"),
    description: createLocalizedText("关注工程可解释性、现场条件、可靠性、安全系数和工程验证。", "Focus on engineering interpretability, field conditions, reliability, safety margins, and engineering validation."),
  },
  "social-science-policy": {
    label: createLocalizedText("社科 / 政策 / 管理", "Social Science / Policy"),
    description: createLocalizedText("关注识别策略、外部效度、制度背景、利益相关者影响和政策可执行性。", "Focus on identification strategy, external validity, institutional context, stakeholder impact, and policy feasibility."),
  },
};

export function createProviderDraft(type: ProviderType = "mock"): ProviderConfig {
  return {
    type,
    model: type === "mock" ? "mock-discussion-v2" : "",
    endpoint: "",
    apiKey: "",
    temperature: 0.7,
    maxTokens: 320,
    command: type === "codex-cli" ? "codex" : "",
    launcherArgs: "",
    workingDirectory: "",
    timeoutMs: type === "codex-cli" ? 240000 : 120000,
    sandboxMode: "read-only",
    skipGitRepoCheck: true,
  };
}

export function getRoleTemplateText(templateKey: RoleTemplateKey): RoleTemplateDefinition {
  return ROLE_TEMPLATE_DEFINITIONS[templateKey];
}

export function getRoleTemplateName(templateKey: RoleTemplateKey, locale: UiLocale): string {
  return ROLE_TEMPLATE_DEFINITIONS[templateKey].name[locale];
}

export function isBuiltInRoleTemplateId(templateId: string): templateId is RoleTemplateKey {
  return Object.prototype.hasOwnProperty.call(ROLE_TEMPLATE_DEFINITIONS, templateId);
}

export function createBuiltInRoleTemplatePreset(templateId: RoleTemplateKey, locale: UiLocale): RoleTemplatePreset {
  const template = ROLE_TEMPLATE_DEFINITIONS[templateId];
  const now = "";
  return {
    id: templateId,
    name: template.name[locale],
    kind: template.kind,
    persona: template.persona[locale],
    principles: template.principles[locale],
    goal: template.goal[locale],
    voiceStyle: template.voiceStyle[locale],
    accentColor: template.accentColor,
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function getBuiltInRoleTemplatePresets(locale: UiLocale): RoleTemplatePreset[] {
  return ROLE_TEMPLATE_ORDER.map((templateId) => createBuiltInRoleTemplatePreset(templateId, locale));
}

export function getBuiltInRoleTemplatePreset(templateId: string, locale: UiLocale): RoleTemplatePreset | null {
  return isBuiltInRoleTemplateId(templateId) ? createBuiltInRoleTemplatePreset(templateId, locale) : null;
}

export function getResearchDirectionLabel(direction: ResearchDirectionKey, locale: UiLocale): string {
  return RESEARCH_DIRECTION_DEFINITIONS[direction as keyof typeof RESEARCH_DIRECTION_DEFINITIONS]?.label[locale] ?? direction;
}

export function getResearchDirectionDescription(direction: ResearchDirectionKey, locale: UiLocale): string {
  return RESEARCH_DIRECTION_DEFINITIONS[direction as keyof typeof RESEARCH_DIRECTION_DEFINITIONS]?.description[locale] ?? "";
}

export function isBuiltInResearchDirection(direction: ResearchDirectionKey): boolean {
  return Object.prototype.hasOwnProperty.call(RESEARCH_DIRECTION_DEFINITIONS, direction);
}

export function createRoleFromTemplate(options: {
  template: RoleTemplatePreset;
  providerPresetId?: string | null;
  provider?: ProviderConfig;
  id?: string;
  enabled?: boolean;
}): DiscussionRole {
  const provider = options.provider ? structuredClone(options.provider) : createProviderDraft("mock");
  return {
    id: options.id ?? crypto.randomUUID(),
    name: options.template.name,
    kind: options.template.kind,
    roleTemplateId: options.template.id,
    persona: options.template.persona,
    principles: options.template.principles,
    voiceStyle: options.template.voiceStyle,
    goal: options.template.goal,
    accentColor: options.template.accentColor,
    enabled: options.enabled ?? true,
    providerPresetId: options.providerPresetId ?? null,
    provider,
  };
}

export function getAvailableRoleTemplates(kind: DiscussionRoleKind, roleTemplates: RoleTemplatePreset[]): RoleTemplatePreset[] {
  return roleTemplates.filter((template) => template.kind === kind);
}

export function createLocalizedRoomSeed(locale: UiLocale, mockPresetId?: string | null): Partial<DiscussionRoom> {
  const providerPresetId = mockPresetId ?? null;
  const provider = createProviderDraft("mock");
  return {
    title: locale === "zh-CN" ? "新讨论房间" : "New Discussion Room",
    topic:
      locale === "zh-CN"
        ? "写下你要讨论的课题、研究构想、论文方向或产品问题，让几位角色围绕它进行对立而专业的讨论。"
        : "Describe the problem, research idea, paper direction, or product question that the room should debate in a rigorous group-chat format.",
    objective:
      locale === "zh-CN"
        ? "让参与者围绕同一议题进行短句、高密度、专业对立的讨论；记录员持续提炼关键分歧、关键证据与最终判断。"
        : "Drive short, high-signal, professionally adversarial discussion around one topic, while the recorder extracts key disagreements, decisive evidence, and a final judgment.",
    discussionLanguage: "zh-CN" satisfies DiscussionLanguage,
    researchDirectionKey: "general" satisfies ResearchDirectionKey,
    researchDirectionLabel: RESEARCH_DIRECTION_DEFINITIONS.general.label[locale],
    researchDirectionDescription: RESEARCH_DIRECTION_DEFINITIONS.general.description[locale],
    researchDirectionNote: "",
    autoRunDelaySeconds: 2,
    roles: [
      createRoleFromTemplate({
        template: createBuiltInRoleTemplatePreset("reviewer", locale),
        providerPresetId,
        provider,
      }),
      createRoleFromTemplate({
        template: createBuiltInRoleTemplatePreset("advisor", locale),
        providerPresetId,
        provider,
      }),
      createRoleFromTemplate({
        template: createBuiltInRoleTemplatePreset("recorder", locale),
        providerPresetId,
        provider,
      }),
    ],
  };
}
