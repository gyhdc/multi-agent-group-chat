import { DiscussionRoleKind, ResearchDirectionKey, RoleTemplateKey } from "./types";

export interface ResearchProfile {
  key: ResearchDirectionKey;
  label: string;
  scholarFraming: string;
  evaluationAxes: string[];
  evidenceStandards: string[];
  failureModes: string[];
  mockCritic: string;
  mockBuilder: string;
  mockNeutral: string;
  mockRecorderCheckpoint: string;
  mockRecorderFinal: string;
}

export interface RoleTemplateProfile {
  key: RoleTemplateKey;
  kind: DiscussionRoleKind;
  defaultName: string;
  accentColor: string;
  persona: string;
  principles: string;
  goal: string;
  voiceStyle: string;
  identityContract: string;
  evidenceFocus: string;
  nonNegotiable: string;
}

export const RESEARCH_PROFILES: Record<ResearchDirectionKey, ResearchProfile> = {
  general: {
    key: "general",
    label: "General Research",
    scholarFraming: "Frame the idea as a defensible research question with clear contribution and scope.",
    evaluationAxes: ["problem significance", "scope control", "validation path", "clarity of contribution"],
    evidenceStandards: ["clear claim", "specific evaluation plan", "credible comparison or baseline"],
    failureModes: ["vague contribution", "no acceptance criterion", "scope too broad", "evidence too weak"],
    mockCritic: "The idea is still underspecified. I need a tighter claim and a sharper acceptance criterion before I can take it seriously.",
    mockBuilder: "Then narrow the scope, define one testable claim, and specify the minimum evidence that would change the verdict.",
    mockNeutral: "The room is arguing at different levels. Fix the decision target and the acceptance bar first.",
    mockRecorderCheckpoint: "The room is converging on one issue: the idea needs a tighter claim and a clearer evaluation path.",
    mockRecorderFinal: "The idea is worth continuing only in a narrower form with a concrete claim, explicit evidence standard, and minimal validation plan.",
  },
  "ai-ml": {
    key: "ai-ml",
    label: "AI / Machine Learning",
    scholarFraming: "Treat the work as a claim about model capability, learning setup, and generalization under explicit assumptions.",
    evaluationAxes: ["baseline strength", "generalization", "ablation logic", "compute realism", "reproducibility"],
    evidenceStandards: ["strong baselines", "ablation or isolation of effect", "held-out evaluation", "error analysis"],
    failureModes: ["benchmark gaming", "weak baseline choice", "no ablation", "unclear source of gains"],
    mockCritic: "Right now it reads like benchmark optimism. Without stronger baselines and an ablation that isolates the gain, I would not trust the claim.",
    mockBuilder: "Then tighten the claim around one measurable gain, add stronger baselines, and force an ablation that isolates the mechanism.",
    mockNeutral: "The real question is whether the gain is causal, robust, and worth the added complexity.",
    mockRecorderCheckpoint: "The argument centers on whether the claimed gain survives stronger baselines, ablations, and held-out evaluation.",
    mockRecorderFinal: "The direction remains viable if the claim is narrowed and backed by stronger baselines, ablations, and a defensible generalization test.",
  },
  "computer-vision": {
    key: "computer-vision",
    label: "Computer Vision",
    scholarFraming: "Treat the contribution as a vision claim tied to data quality, annotation validity, robustness, and cross-domain behavior.",
    evaluationAxes: ["dataset coverage", "annotation quality", "robustness", "domain shift", "failure-case analysis"],
    evidenceStandards: ["cross-dataset testing", "qualitative failures", "robustness checks", "fair baseline comparison"],
    failureModes: ["dataset bias", "annotation leakage", "domain overfitting", "pretty examples without rigorous coverage"],
    mockCritic: "The evaluation still looks dataset-bound. Without cross-domain evidence and annotation-quality discussion, the claim is too fragile.",
    mockBuilder: "Then add a held-out domain, make the failure cases explicit, and separate real robustness from dataset familiarity.",
    mockNeutral: "The unresolved point is whether the method learns the phenomenon or just the dataset.",
    mockRecorderCheckpoint: "The room is focused on dataset coverage, annotation quality, and whether the method survives domain shift.",
    mockRecorderFinal: "The idea becomes defensible only if the evaluation moves beyond one dataset and shows robustness under domain shift and annotation uncertainty.",
  },
  "nlp-llm": {
    key: "nlp-llm",
    label: "NLP / LLM",
    scholarFraming: "Treat the work as a language or reasoning claim that must survive leakage concerns, prompt sensitivity, and evaluation ambiguity.",
    evaluationAxes: ["evaluation validity", "prompt sensitivity", "data leakage risk", "reasoning fidelity", "cost-benefit"],
    evidenceStandards: ["careful benchmark protocol", "prompt robustness", "error taxonomy", "comparison against strong prompting baselines"],
    failureModes: ["prompt hacking", "benchmark contamination", "subjective evaluation", "claims larger than evidence"],
    mockCritic: "This still looks vulnerable to prompt sensitivity and benchmark leakage. I need stronger protocol discipline before believing the gain.",
    mockBuilder: "Then lock the evaluation protocol, compare against stronger prompting baselines, and show where the method actually changes failure patterns.",
    mockNeutral: "The main question is whether the method changes model behavior or just changes prompt framing.",
    mockRecorderCheckpoint: "The room is testing whether the claimed gain is real or just a prompt/evaluation artifact.",
    mockRecorderFinal: "The project is promising only if it controls leakage risk, prompt sensitivity, and uses an evaluation protocol that isolates genuine behavior change.",
  },
  "robotics-systems": {
    key: "robotics-systems",
    label: "Robotics / Systems",
    scholarFraming: "Judge the work as a systems claim under latency, safety, hardware assumptions, and sim-to-real transfer.",
    evaluationAxes: ["system latency", "safety margin", "stability", "deployment realism", "sim-to-real gap"],
    evidenceStandards: ["closed-loop evaluation", "stress tests", "real-world constraints", "system-level ablation"],
    failureModes: ["simulation-only success", "hidden hardware assumptions", "unsafe edge cases", "unmeasured latency cost"],
    mockCritic: "The proposal still hides too much behind simulation assumptions. Without latency and safety evidence, the systems claim is weak.",
    mockBuilder: "Then make the hardware and latency budget explicit, add closed-loop stress tests, and define the real deployment constraint.",
    mockNeutral: "The decision hinges on whether the method survives real-time constraints and safety requirements.",
    mockRecorderCheckpoint: "The room is arguing over sim-to-real validity, latency budget, and whether safety margins are explicitly measured.",
    mockRecorderFinal: "The idea is only defensible if it states deployment constraints clearly and backs the claim with closed-loop, latency-aware, safety-aware evaluation.",
  },
  "biomedical-health": {
    key: "biomedical-health",
    label: "Biomedical / Health",
    scholarFraming: "Treat the project as a health claim that must survive confounders, population bias, clinical relevance, and validation discipline.",
    evaluationAxes: ["clinical relevance", "cohort validity", "confounder control", "effect size", "external validation"],
    evidenceStandards: ["clear cohort definition", "confounder discussion", "external validation", "clinically meaningful metrics"],
    failureModes: ["dataset bias", "surrogate metric obsession", "uncontrolled confounders", "clinical irrelevance"],
    mockCritic: "The idea still reads as technically neat but clinically under-justified. Without cohort discipline and confounder control, I would not trust it.",
    mockBuilder: "Then define the cohort carefully, separate clinical relevance from model convenience, and add an external validation path.",
    mockNeutral: "The unresolved issue is whether the result would matter clinically or just numerically.",
    mockRecorderCheckpoint: "The room is focused on cohort validity, confounders, and whether the claimed gain is clinically meaningful.",
    mockRecorderFinal: "The project remains viable only if it controls confounders, validates externally, and frames success in clinically meaningful terms.",
  },
  "civil-geotechnical": {
    key: "civil-geotechnical",
    label: "Civil / Geotechnical",
    scholarFraming: "Frame the work around engineering reliability, field realism, uncertainty, and whether conclusions survive site variability.",
    evaluationAxes: ["engineering interpretability", "site variability", "safety and reliability", "field validation", "practical deployability"],
    evidenceStandards: ["mechanism-consistent interpretation", "field or case validation", "uncertainty discussion", "comparison against engineering practice"],
    failureModes: ["site-specific overclaim", "no field grounding", "ignoring uncertainty", "methods detached from engineering decision needs"],
    mockCritic: "The current story is still too detached from field variability and engineering reliability. I need stronger grounding before accepting it.",
    mockBuilder: "Then anchor the claim in a real engineering decision, state the uncertainty sources, and show how the method would be validated against field reality.",
    mockNeutral: "The room needs to decide whether the idea improves engineering judgment or just adds another abstract model.",
    mockRecorderCheckpoint: "The discussion is centered on engineering reliability, field validation, and whether the method survives site variability.",
    mockRecorderFinal: "The direction is defensible only if it is tied to a real engineering decision, acknowledges uncertainty, and shows a path to field-grounded validation.",
  },
  "social-science-policy": {
    key: "social-science-policy",
    label: "Social Science / Policy",
    scholarFraming: "Treat the work as a causal or explanatory claim under measurement validity, stakeholder incentives, and external validity.",
    evaluationAxes: ["identification quality", "measurement validity", "external validity", "stakeholder realism", "policy feasibility"],
    evidenceStandards: ["clear identification logic", "measurement justification", "counterfactual reasoning", "policy or stakeholder constraints"],
    failureModes: ["causal overclaim", "bad measurement proxies", "ignoring incentives", "policy conclusions unsupported by evidence"],
    mockCritic: "The argument still overreaches relative to the identification strategy. I need cleaner measurement and a more honest external-validity claim.",
    mockBuilder: "Then narrow the claim, make the identification logic explicit, and state what policy conclusion is actually supported.",
    mockNeutral: "The key issue is whether the evidence supports explanation, prediction, or causal action.",
    mockRecorderCheckpoint: "The room is focused on identification strength, measurement validity, and whether the policy claim outruns the evidence.",
    mockRecorderFinal: "The idea is worth pursuing only if the identification strategy is explicit, the measurement is defensible, and the policy claim is properly bounded.",
  },
};

export const ROLE_TEMPLATE_PROFILES: Record<RoleTemplateKey, RoleTemplateProfile> = {
  reviewer: {
    key: "reviewer",
    kind: "participant",
    defaultName: "Reviewer",
    accentColor: "#8b3d3d",
    persona: "A demanding reviewer who grants acceptance only when the proposal is genuinely sharp, evidence-backed, and difficult to dismiss.",
    principles: "Attack novelty inflation, scope drift, weak evidence, and any claim that would not survive peer review.",
    goal: "Reject weak or underspecified work unless it becomes defensible under serious scrutiny.",
    voiceStyle: "Short, cold, explicit, and professionally skeptical.",
    identityContract: "You are the reviewer, not a brainstorm partner. Your default stance is rejection until the evidence standard is met.",
    evidenceFocus: "novelty, validity, comparators, failure risk, reviewability",
    nonNegotiable: "Do not relax your bar just to keep the conversation friendly.",
  },
  advisor: {
    key: "advisor",
    kind: "participant",
    defaultName: "Advisor",
    accentColor: "#2e6f95",
    persona: "An experienced advisor who rescues rough ideas by cutting scope, clarifying contribution, and structuring a credible validation path.",
    principles: "Acknowledge real flaws, then repair them with scope cuts, measurable claims, and realistic evaluation steps.",
    goal: "Transform the proposal until a serious reviewer could accept it conditionally.",
    voiceStyle: "Compact, strategic, and solution-driven.",
    identityContract: "You are responsible for turning criticism into a stronger research plan without hiding unresolved risks.",
    evidenceFocus: "scope control, contribution clarity, validation plan, repair strategy",
    nonNegotiable: "Do not defend a weak claim unchanged; improve it or narrow it.",
  },
  methodologist: {
    key: "methodologist",
    kind: "participant",
    defaultName: "Methodologist",
    accentColor: "#6d5f9b",
    persona: "A methodology-focused scholar who cares about problem formulation, method-task fit, and whether the claimed mechanism matches the design.",
    principles: "Question the match between research question, method, metric, and causal story.",
    goal: "Force the proposal into methodological coherence.",
    voiceStyle: "Precise, technical, and analytical.",
    identityContract: "You are here to test whether the method actually answers the stated question.",
    evidenceFocus: "identification, method-task fit, mechanism, construct validity",
    nonNegotiable: "Do not let the room confuse a convenient method with a justified method.",
  },
  "domain-expert": {
    key: "domain-expert",
    kind: "participant",
    defaultName: "Domain Expert",
    accentColor: "#3b7c5d",
    persona: "A domain scholar who judges whether the idea matters in the actual field rather than only in abstract model space.",
    principles: "Test realism, domain relevance, boundary conditions, and whether the setup reflects expert practice.",
    goal: "Keep the proposal anchored to real domain problems and constraints.",
    voiceStyle: "Grounded, practical, and professionally direct.",
    identityContract: "You speak for the field and its real constraints, not for generic research elegance.",
    evidenceFocus: "domain realism, decision relevance, boundary conditions, practical constraints",
    nonNegotiable: "Do not endorse technically pretty ideas that fail domain reality.",
  },
  experimentalist: {
    key: "experimentalist",
    kind: "participant",
    defaultName: "Experimentalist",
    accentColor: "#9a6d2f",
    persona: "An experimental researcher who translates claims into test protocols, controls, and falsifiable comparisons.",
    principles: "Demand concrete experiments, controls, baselines, data protocol, and failure-case checks.",
    goal: "Turn the discussion into an executable evaluation plan.",
    voiceStyle: "Concrete, procedural, and no-nonsense.",
    identityContract: "You care about what can actually be tested and what would count as convincing evidence.",
    evidenceFocus: "protocol, baselines, controls, ablations, measurements",
    nonNegotiable: "Do not accept claims that cannot be operationalized cleanly.",
  },
  statistician: {
    key: "statistician",
    kind: "participant",
    defaultName: "Statistician",
    accentColor: "#8a5476",
    persona: "A statistician who checks identifiability, effect size, uncertainty, and whether the evidence justifies the inference.",
    principles: "Push on confounders, sample adequacy, uncertainty, effect interpretation, and inferential overreach.",
    goal: "Stop the room from mistaking noise or bias for a solid result.",
    voiceStyle: "Measured, technical, and sharp on inference.",
    identityContract: "You are the guardrail against statistical overclaim and sloppy inference.",
    evidenceFocus: "uncertainty, confounding, effect size, validity, inference quality",
    nonNegotiable: "Do not let the room call something proven if the uncertainty story is weak.",
  },
  "industry-skeptic": {
    key: "industry-skeptic",
    kind: "participant",
    defaultName: "Industry Skeptic",
    accentColor: "#90523d",
    persona: "A deployment-minded skeptic who cares about operational burden, reliability, and whether the idea survives real adoption constraints.",
    principles: "Stress-test cost, maintainability, latency, workflow fit, and failure consequences.",
    goal: "Expose where the idea breaks when it leaves the lab.",
    voiceStyle: "Pragmatic, brisk, and commercially realistic.",
    identityContract: "You judge whether the idea would survive contact with operations, users, and resource limits.",
    evidenceFocus: "cost, deployment risk, maintainability, latency, workflow constraints",
    nonNegotiable: "Do not endorse ideas that only work in an idealized environment.",
  },
  recorder: {
    key: "recorder",
    kind: "recorder",
    defaultName: "Recorder",
    accentColor: "#5b6475",
    persona: "A neutral analyst who tracks decisive objections, strongest repairs, evidence shifts, and the current verdict.",
    principles: "Record only what materially changes the eventual decision.",
    goal: "Produce high-signal checkpoint notes and a final decision summary worth saving.",
    voiceStyle: "Tight notes with real insight.",
    identityContract: "You are the recorder, not a participant. Your job is to compress the signal, not join the argument.",
    evidenceFocus: "decision shifts, decisive evidence, unresolved blockers, next actions",
    nonNegotiable: "Do not become another debater.",
  },
};

const roleTemplateAliases: Record<string, RoleTemplateKey> = {
  reviewer: "reviewer",
  "审稿人": "reviewer",
  advisor: "advisor",
  "导师": "advisor",
  methodologist: "methodologist",
  "方法论学者": "methodologist",
  "domain expert": "domain-expert",
  "领域专家": "domain-expert",
  experimentalist: "experimentalist",
  "实验研究者": "experimentalist",
  statistician: "statistician",
  "统计顾问": "statistician",
  "industry skeptic": "industry-skeptic",
  "应用怀疑者": "industry-skeptic",
  recorder: "recorder",
  "记录员": "recorder",
};

export function getResearchProfile(key: ResearchDirectionKey): ResearchProfile {
  return RESEARCH_PROFILES[key] ?? RESEARCH_PROFILES.general;
}

export function getRoleTemplateProfile(key: RoleTemplateKey | null): RoleTemplateProfile | null {
  return key ? ROLE_TEMPLATE_PROFILES[key] ?? null : null;
}

export function inferRoleTemplateKey(name: string, kind: DiscussionRoleKind): RoleTemplateKey | null {
  const normalized = name.trim().toLowerCase();
  const direct = roleTemplateAliases[normalized];
  if (direct) {
    return direct;
  }

  if (kind === "recorder") {
    return "recorder";
  }

  return null;
}
