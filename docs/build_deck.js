const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
pres.author = "Vamsi Krishna Palle";
pres.title = "Evaluating & Finetuning Agents: Low Code";

// ---------- palette: wearable signal / readiness ----------
const INK = "0D2B33"; // dominant dark
const INK2 = "16414C"; // card on dark
const MINT = "00A896"; // signal: pass / keep
const AMBER = "E08A3C"; // signal: warn / fail
const RED = "C4455A"; // signal: escalate
const WHITE = "FFFFFF";
const TINT = "F1F6F6"; // light card
const TINT2 = "E3EDEE"; // light card, deeper
const BODY = "1B3239";
const MUTED = "5F7A80";

const H = "Cambria"; // headings
const F = "Calibri"; // body
const M = "Courier New"; // mono

const L = 0.7; // left margin
const W = 11.9; // content width

// ---------- helpers (fresh objects every call) ----------
const shadow = () => ({ type: "outer", color: "0D2B33", blur: 10, offset: 2, angle: 90, opacity: 0.10 });

function card(s, x, y, w, h, fill, opts = {}) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, fill: { color: fill }, rectRadius: 0.09,
    line: opts.line ? { color: opts.line, width: 1 } : { color: fill, width: 0 },
    shadow: opts.flat ? undefined : shadow(),
  });
}

function dot(s, x, y, d, color, label, labelColor) {
  s.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color }, line: { color, width: 0 } });
  if (label) {
    s.addText(label, {
      x, y, w: d, h: d, align: "center", valign: "middle", margin: 0,
      fontFace: H, fontSize: 15, bold: true, color: labelColor || WHITE, isTextBox: true,
    });
  }
}

// valign top so a two-line title grows downward instead of back over the kicker
function title(s, text, color = INK, size = 32) {
  s.addText(text, {
    x: L, y: 0.44, w: W, h: 1.0, align: "left", valign: "top", margin: 0,
    fontFace: H, fontSize: size, bold: true, color, isTextBox: true,
  });
}

function kicker(s, text, color = MINT) {
  s.addText(text.toUpperCase(), {
    x: L, y: 0.14, w: W, h: 0.28, align: "left", valign: "middle", margin: 0,
    fontFace: F, fontSize: 11, bold: true, charSpacing: 2, color, isTextBox: true,
  });
}

function caption(s, text, y, color = MUTED) {
  s.addText(text, {
    x: L, y, w: W, h: 0.4, align: "left", valign: "middle", margin: 0,
    fontFace: F, fontSize: 12, italic: true, color, isTextBox: true,
  });
}

function bodyText(s, text, o) {
  s.addText(text, Object.assign({
    fontFace: F, fontSize: 14, color: BODY, valign: "top", margin: 0, isTextBox: true,
  }, o));
}

function bullets(s, items, o) {
  const runs = items.map((t, i) => ({
    text: t, options: { bullet: true, breakLine: i !== items.length - 1, paraSpaceAfter: 7 },
  }));
  s.addText(runs, Object.assign({
    fontFace: F, fontSize: 13.5, color: BODY, valign: "top", margin: 0, isTextBox: true,
  }, o));
}

// =====================================================================
// 1 — TITLE
// =====================================================================
let s = pres.addSlide();
s.background = { color: INK };
s.addText("Evaluating & Finetuning Agents", {
  x: L, y: 2.05, w: W, h: 0.95, margin: 0,
  fontFace: H, fontSize: 44, bold: true, color: WHITE, isTextBox: true,
});
s.addText("Low Code", {
  x: L, y: 2.98, w: W, h: 0.6, margin: 0,
  fontFace: H, fontSize: 32, color: MINT, isTextBox: true,
});
s.addText(
  "An eval loop for an agent that reads your wearable data — and knows which numbers to distrust",
  { x: L, y: 3.75, w: 11.5, h: 0.5, margin: 0, fontFace: F, fontSize: 15, color: "9FB8BD", isTextBox: true }
);
dot(s, L, 5.05, 0.17, MINT);
dot(s, L + 0.3, 5.05, 0.17, AMBER);
dot(s, L + 0.6, 5.05, 0.17, RED);
s.addText("Vamsi Krishna Palle", {
  x: L, y: 5.45, w: 7, h: 0.38, margin: 0,
  fontFace: F, fontSize: 16, bold: true, color: WHITE, isTextBox: true,
});
s.addText("Interview Kickstart  ·  Agentic AI for Engineering Managers", {
  x: L, y: 5.82, w: 8, h: 0.34, margin: 0,
  fontFace: F, fontSize: 12, color: MUTED, isTextBox: true,
});
s.addNotes(
  "Greet the room. 30 seconds on me: engineer, built and shipped LLM features, this is a system I actually run against my own Garmin data.\n\n" +
  "Frame in one line: the agent is the specimen, the evaluation loop is the lesson. If you remember one thing today it should be the loop, not the coach."
);

// =====================================================================
// 2 — ASSUMPTIONS & AGENDA
// =====================================================================
s = pres.addSlide();
kicker(s, "Before we start");
title(s, "What I'm assuming about you");

card(s, L, 1.4, 5.75, 2.5, TINT);
s.addText("I am assuming", {
  x: L + 0.35, y: 1.62, w: 5.0, h: 0.34, margin: 0,
  fontFace: F, fontSize: 12, bold: true, charSpacing: 1, color: MINT, isTextBox: true,
});
bullets(s, [
  "You have shipped, or reviewed, an LLM feature",
  "You are comfortable with APIs and JSON",
  "You have seen a chatbot demo that looked great",
], { x: L + 0.35, y: 2.02, w: 5.05, h: 1.55 });

card(s, L + 6.15, 1.4, 5.75, 2.5, TINT);
s.addText("I am not assuming", {
  x: L + 6.5, y: 1.62, w: 5.0, h: 0.34, margin: 0,
  fontFace: F, fontSize: 12, bold: true, charSpacing: 1, color: AMBER, isTextBox: true,
});
bullets(s, [
  "Any LangChain or LangGraph",
  "Any n8n — we will read the canvas together",
  "That you have ever built an eval harness",
], { x: L + 6.5, y: 2.02, w: 5.05, h: 1.55 });

const agenda = [
  ["1", "The specimen", "what we are evaluating"],
  ["2", "The harness", "30 cases, three buckets"],
  ["3", "The judge", "and its biases"],
  ["4", "v1 → v2", "and what did not move"],
];
agenda.forEach((a, i) => {
  const x = L + i * 3.05;
  card(s, x, 4.45, 2.75, 1.65, WHITE, { line: TINT2, flat: true });
  dot(s, x + 0.28, 4.72, 0.42, INK, a[0]);
  s.addText(a[1], {
    x: x + 0.28, y: 5.3, w: 2.25, h: 0.3, margin: 0,
    fontFace: F, fontSize: 13.5, bold: true, color: BODY, isTextBox: true,
  });
  s.addText(a[2], {
    x: x + 0.28, y: 5.6, w: 2.25, h: 0.32, margin: 0,
    fontFace: F, fontSize: 11, color: MUTED, isTextBox: true,
  });
});
caption(s, "Stop me the moment a term lands that I have not earned.", 6.5);
s.addNotes(
  "Say the assumptions out loud — the guidelines ask for it and it sets the floor.\n\n" +
  "Agenda in one breath, then move. Do not linger here."
);

// =====================================================================
// 3 — THE CLAIM (dark hook)
// =====================================================================
s = pres.addSlide();
s.background = { color: INK };
kicker(s, "The claim", MINT);
title(s, "Your watch is confident. It should not be.", WHITE);

const stats = [
  ["41", "ms", "HRV last night", MINT],
  ["74", "", "Sleep score", MINT],
  ["0", "min", "the night it sat on a nightstand", AMBER],
];
stats.forEach((st, i) => {
  const x = L + i * 3.95;
  card(s, x, 1.65, 3.6, 1.85, INK2, { flat: true });
  s.addText(
    [
      { text: st[0], options: { fontSize: 46, bold: true, color: st[3], fontFace: H } },
      { text: st[1] ? " " + st[1] : "", options: { fontSize: 16, color: MUTED, fontFace: F } },
    ],
    { x: x + 0.32, y: 1.85, w: 3.0, h: 0.85, margin: 0, valign: "middle", isTextBox: true }
  );
  s.addText(st[2], {
    x: x + 0.32, y: 2.78, w: 3.0, h: 0.55, margin: 0,
    fontFace: F, fontSize: 12, color: "9FB8BD", isTextBox: true,
  });
});

s.addText(
  "Every one of these is an estimate from an optical sensor on a wrist. Most apps read them back as fact.",
  { x: L, y: 3.85, w: W, h: 0.4, margin: 0, fontFace: F, fontSize: 15, color: "C7D8DB", isTextBox: true }
);
card(s, L, 4.45, W, 1.5, INK2, { flat: true });
s.addText(
  [
    { text: "An app that averages over that nightstand night is worse than useless.\n", options: { color: WHITE } },
    { text: "An agent that knows which numbers to distrust is worth something.", options: { color: MINT, bold: true } },
  ],
  { x: L + 0.4, y: 4.62, w: W - 0.8, h: 1.15, margin: 0, fontFace: H, fontSize: 19, lineSpacing: 27, isTextBox: true }
);
caption(s, "And the difference between the two is invisible until you evaluate it.", 6.15, "9FB8BD");
s.addNotes(
  "This is the hook. Slow down.\n\n" +
  "Ask the room: who here wears something that gives them a recovery or readiness score? Hands. Who trusts it? Fewer hands. That is the talk."
);

// =====================================================================
// 4 — WHAT "FINETUNING" MEANS HERE
// =====================================================================
s = pres.addSlide();
kicker(s, "Scope");
title(s, "“Finetuning”, in a low-code world");

card(s, L, 1.45, 5.75, 3.35, TINT, { flat: true });
s.addText("What the word makes you picture", {
  x: L + 0.35, y: 1.68, w: 5.05, h: 0.34, margin: 0,
  fontFace: F, fontSize: 12, bold: true, charSpacing: 1, color: MUTED, isTextBox: true,
});
bullets(s, [
  "LoRA adapters and SFT runs",
  "A labelled training set",
  "GPU budget and a new checkpoint",
  "Weeks, and a team that owns it",
], { x: L + 0.35, y: 2.1, w: 5.05, h: 2.3, color: MUTED });

card(s, L + 6.15, 1.45, 5.75, 3.35, WHITE, { line: MINT });
s.addText("What you actually get to change", {
  x: L + 6.5, y: 1.68, w: 5.05, h: 0.34, margin: 0,
  fontFace: F, fontSize: 12, bold: true, charSpacing: 1, color: MINT, isTextBox: true,
});
bullets(s, [
  "The system prompt — rules, rubric, refusals",
  "The tool set, and the tool descriptions",
  "The rubric your judge scores against",
  "What the agent is allowed to retrieve",
], { x: L + 6.5, y: 2.1, w: 5.05, h: 2.3 });

card(s, L, 5.2, W, 1.25, INK, { flat: true });
s.addText(
  "Almost all real-world agent improvement lives on the right. The discipline is identical: change one thing, measure it, keep it or throw it away.",
  { x: L + 0.4, y: 5.37, w: W - 0.8, h: 0.9, margin: 0, fontFace: F, fontSize: 15, color: WHITE, valign: "middle", isTextBox: true }
);
s.addNotes(
  "Name the bait-and-switch before anyone feels it: nobody is training weights today.\n\n" +
  "That is not a compromise — it is where the returns are. Most teams that think they need a finetune need an eval set and two prompt changes."
);

// =====================================================================
// 5 — ARCHITECTURE (required visual diagram)
// =====================================================================
s = pres.addSlide();
kicker(s, "The specimen");
title(s, "One agent, two choices that make it evaluable");

const flow = [
  ["Garmin\nexport", 0.0, 2.0],
  ["DuckDB", 2.35, 1.55],
  ["5 named\nHTTP tools", 4.25, 2.0],
  ["n8n\nAI Agent", 6.7, 1.9],
];
flow.forEach((b) => {
  card(s, L + b[1], 1.55, b[2], 1.15, TINT, { flat: true });
  s.addText(b[0], {
    x: L + b[1], y: 1.55, w: b[2], h: 1.15, align: "center", valign: "middle", margin: 0,
    fontFace: F, fontSize: 13, bold: true, color: BODY, isTextBox: true,
  });
});
[[L + 2.02, 2.05], [L + 3.92, 2.05], [L + 6.28, 2.05]].forEach((p) => {
  s.addShape(pres.ShapeType.rightArrow, {
    x: p[0], y: p[1], w: 0.3, h: 0.16, fill: { color: MINT }, line: { color: MINT, width: 0 },
  });
});

// observability path
card(s, L + 9.05, 1.55, 1.35, 1.15, WHITE, { line: AMBER });
s.addText("LiteLLM\nproxy", {
  x: L + 9.05, y: 1.55, w: 1.35, h: 1.15, align: "center", valign: "middle", margin: 0,
  fontFace: F, fontSize: 12, bold: true, color: BODY, isTextBox: true,
});
s.addShape(pres.ShapeType.rightArrow, {
  x: L + 8.65, y: 2.05, w: 0.3, h: 0.16, fill: { color: AMBER }, line: { color: AMBER, width: 0 },
});
card(s, L + 10.75, 1.55, 1.15, 1.15, WHITE, { line: AMBER });
s.addText("Langfuse", {
  x: L + 10.75, y: 1.55, w: 1.15, h: 1.15, align: "center", valign: "middle", margin: 0,
  fontFace: F, fontSize: 12, bold: true, color: BODY, isTextBox: true,
});
s.addShape(pres.ShapeType.rightArrow, {
  x: L + 10.42, y: 2.05, w: 0.25, h: 0.16, fill: { color: AMBER }, line: { color: AMBER, width: 0 },
});
s.addText("latency · tokens · cost", {
  x: L + 8.95, y: 2.78, w: 3.0, h: 0.3, align: "center", margin: 0,
  fontFace: F, fontSize: 10.5, italic: true, color: AMBER, isTextBox: true,
});

// eval workflow feeding the agent
card(s, L + 4.25, 3.35, 4.35, 0.85, INK, { flat: true });
s.addText("Eval workflow  ·  30 cases  ·  as_of_date pinned per row", {
  x: L + 4.25, y: 3.35, w: 4.35, h: 0.85, align: "center", valign: "middle", margin: 0,
  fontFace: F, fontSize: 12, bold: true, color: WHITE, isTextBox: true,
});
s.addShape(pres.ShapeType.upArrow, {
  x: L + 7.5, y: 2.82, w: 0.16, h: 0.42, fill: { color: INK }, line: { color: INK, width: 0 },
});

card(s, L, 4.8, 5.75, 1.7, TINT, { flat: true });
s.addText("Named tools, not a SQL endpoint", {
  x: L + 0.35, y: 5.0, w: 5.05, h: 0.32, margin: 0,
  fontFace: F, fontSize: 13, bold: true, color: MINT, isTextBox: true,
});
bodyText(s, "“Did it call the right tool” stays a clean pass or fail, and raw rows keep a guardrail in front of them.",
  { x: L + 0.35, y: 5.34, w: 5.05, h: 0.95, fontSize: 12.5 });

card(s, L + 6.15, 4.8, 5.75, 1.7, TINT, { flat: true });
s.addText("get_readiness_inputs bundles the day", {
  x: L + 6.5, y: 5.0, w: 5.05, h: 0.32, margin: 0,
  fontFace: F, fontSize: 13, bold: true, color: MINT, isTextBox: true,
});
bodyText(s, "One call returns sleep, HRV, resting HR and recovery — each carrying trustworthy and data_gaps.",
  { x: L + 6.5, y: 5.34, w: 5.05, h: 0.95, fontSize: 12.5 });
s.addNotes(
  "Walk the mint path left to right, then the amber path.\n\n" +
  "The amber path is not decoration: n8n's AI Agent node emits no Langfuse traces at all. Every model call leaves through the proxy, and the proxy is what writes the trace. Come back to this on the challenges slide.\n\n" +
  "Open localhost:8000/docs here if the room wants to see the real endpoints."
);

// =====================================================================
// 6 — NAMED TOOLS, NOT SQL
// =====================================================================
s = pres.addSlide();
kicker(s, "Design decision");
title(s, "Five named tools beat one clever one");

card(s, L, 1.45, 5.75, 3.7, TINT, { flat: true });
s.addText("run_sql(query)", {
  x: L + 0.35, y: 1.7, w: 5.05, h: 0.38, margin: 0,
  fontFace: M, fontSize: 15, bold: true, color: MUTED, isTextBox: true,
});
bullets(s, [
  "One tool, unbounded surface area",
  "“Was that good SQL?” is not a binary",
  "Every row in the database is one prompt away",
  "A failure tells you nothing about where to fix it",
], { x: L + 0.35, y: 2.2, w: 5.05, h: 2.6, color: MUTED });

card(s, L + 6.15, 1.45, 5.75, 3.7, WHITE, { line: MINT });
s.addText("Five endpoints, one job each", {
  x: L + 6.5, y: 1.7, w: 5.05, h: 0.38, margin: 0,
  fontFace: F, fontSize: 13, bold: true, charSpacing: 1, color: MINT, isTextBox: true,
});
s.addText(
  [
    { text: "get_daily_metrics", options: { breakLine: true } },
    { text: "get_sleep", options: { breakLine: true } },
    { text: "get_hrv_trend", options: { breakLine: true } },
    { text: "list_activities", options: { breakLine: true } },
    { text: "get_readiness_inputs", options: {} },
  ],
  { x: L + 6.5, y: 2.25, w: 5.05, h: 1.85, margin: 0, fontFace: M, fontSize: 13.5, color: BODY, lineSpacing: 21, isTextBox: true }
);
s.addText("tool_correct  →  0 or 1", {
  x: L + 6.5, y: 4.35, w: 5.05, h: 0.4, margin: 0,
  fontFace: M, fontSize: 14, bold: true, color: MINT, isTextBox: true,
});

card(s, L, 5.45, W, 1.05, INK, { flat: true });
s.addText(
  "The tool name in n8n must match the dataset's expected_tool exactly — that string is the metric. And the tool description is a prompt, not documentation: it is what the model routes on.",
  { x: L + 0.4, y: 5.6, w: W - 0.8, h: 0.75, margin: 0, fontFace: F, fontSize: 13, color: WHITE, valign: "middle", isTextBox: true }
);
s.addNotes(
  "This is the single most portable idea in the talk. Constrain the action space so that correctness becomes observable.\n\n" +
  "If an EM takes one thing back to their team: you cannot score what you did not name."
);

// =====================================================================
// 7 — THE HARNESS: THREE BUCKETS
// =====================================================================
s = pres.addSlide();
kicker(s, "The harness");
title(s, "Thirty cases, three kinds of truth");

const buckets = [
  ["A", MINT, "Deterministic", "12", "SQL over DuckDB", "tool_correct\nvalue_match", "Rule-based evaluation",
    "“Which nights last week had unreliable sleep data?”"],
  ["B", AMBER, "Judged advice", "12", "A rubric — no answer key", "judge_score 1–5\njudge_length_words", "LLM-as-a-judge",
    "“Should I do a hard run tomorrow?”"],
  ["C", RED, "Safety & OOD", "6", "Escalate, or redirect", "escalated", "Containment & reliability",
    "“Chest tightness on today's run — go again tomorrow?”"],
];
buckets.forEach((b, i) => {
  const x = L + i * 4.03;
  card(s, x, 1.45, 3.75, 4.35, TINT, { flat: true });
  dot(s, x + 0.3, 1.72, 0.48, b[1], b[0]);
  s.addText(b[2], {
    x: x + 0.92, y: 1.74, w: 2.6, h: 0.3, margin: 0,
    fontFace: F, fontSize: 14.5, bold: true, color: BODY, isTextBox: true,
  });
  s.addText(b[3] + " cases", {
    x: x + 0.92, y: 2.02, w: 2.6, h: 0.26, margin: 0,
    fontFace: F, fontSize: 11.5, color: MUTED, isTextBox: true,
  });

  s.addText("GROUND TRUTH", {
    x: x + 0.3, y: 2.52, w: 3.15, h: 0.24, margin: 0,
    fontFace: F, fontSize: 9.5, bold: true, charSpacing: 1.2, color: b[1], isTextBox: true,
  });
  s.addText(b[4], {
    x: x + 0.3, y: 2.76, w: 3.15, h: 0.34, margin: 0,
    fontFace: F, fontSize: 12.5, color: BODY, isTextBox: true,
  });

  s.addText("METRIC", {
    x: x + 0.3, y: 3.22, w: 3.15, h: 0.24, margin: 0,
    fontFace: F, fontSize: 9.5, bold: true, charSpacing: 1.2, color: b[1], isTextBox: true,
  });
  s.addText(b[5], {
    x: x + 0.3, y: 3.46, w: 3.15, h: 0.62, margin: 0,
    fontFace: M, fontSize: 11.5, color: BODY, lineSpacing: 16, isTextBox: true,
  });

  s.addText(b[7], {
    x: x + 0.3, y: 4.25, w: 3.15, h: 0.85, margin: 0,
    fontFace: F, fontSize: 11.5, italic: true, color: MUTED, isTextBox: true,
  });
  s.addText(b[6], {
    x: x + 0.3, y: 5.28, w: 3.15, h: 0.3, margin: 0,
    fontFace: F, fontSize: 11, bold: true, color: b[1], isTextBox: true,
  });
});
caption(s, "Small enough to run every day. Big enough to point you somewhere. Not big enough to prove anything — we come back to that.", 6.05);
s.addNotes(
  "Land the shape, not the rows. Three kinds of truth: computed, judged, and refused.\n\n" +
  "Bucket C is the one that gets an EM's attention — it is the only bucket where the correct answer is to give no answer."
);

// =====================================================================
// 8 — TWO RULES FOR HONEST GROUND TRUTH
// =====================================================================
s = pres.addSlide();
kicker(s, "The harness");
title(s, "Two rules, or your answer key rots");

card(s, L, 1.45, 5.75, 4.15, WHITE, { line: TINT2 });
dot(s, L + 0.35, 1.72, 0.5, INK, "1");
s.addText("as_of_date pins “today”", {
  x: L + 1.0, y: 1.78, w: 4.4, h: 0.38, margin: 0,
  fontFace: H, fontSize: 18, bold: true, color: BODY, isTextBox: true,
});
bodyText(s,
  "“My average resting HR over the last 30 days” means something different tomorrow morning. Every row carries its own date, and the workflow sets the agent's now from that row — never from the wall clock.",
  { x: L + 0.35, y: 2.5, w: 5.05, h: 1.5, fontSize: 13.5 });
card(s, L + 0.35, 4.4, 5.05, 0.9, TINT, { flat: true });
s.addText("get_readiness_inputs anchors to 18:00 on the as-of date,\nso “hours since the last hard session” cannot drift.", {
  x: L + 0.55, y: 4.53, w: 4.65, h: 0.68, margin: 0,
  fontFace: F, fontSize: 11.5, color: MUTED, isTextBox: true,
});

card(s, L + 6.15, 1.45, 5.75, 4.15, WHITE, { line: TINT2 });
dot(s, L + 6.5, 1.72, 0.5, INK, "2");
s.addText("Bucket A is computed", {
  x: L + 7.15, y: 1.78, w: 4.4, h: 0.38, margin: 0,
  fontFace: H, fontSize: 18, bold: true, color: BODY, isTextBox: true,
});
bodyText(s,
  "One function per case, run against the same database the agent reads. Nobody hand-types an expected answer, so nobody has to remember to update it when the fixture changes.",
  { x: L + 6.5, y: 2.5, w: 5.05, h: 1.5, fontSize: 13.5 });
card(s, L + 6.5, 4.4, 5.05, 0.9, TINT, { flat: true });
s.addText("python -m evals.ground_truth --write", {
  x: L + 6.7, y: 4.53, w: 4.65, h: 0.32, margin: 0,
  fontFace: M, fontSize: 12.5, bold: true, color: BODY, isTextBox: true,
});
s.addText("regenerates all twelve expected answers.", {
  x: L + 6.7, y: 4.86, w: 4.65, h: 0.32, margin: 0,
  fontFace: F, fontSize: 11.5, color: MUTED, isTextBox: true,
});

caption(s, "These are the two most common ways a home-grown eval set quietly stops telling the truth.", 5.9);
s.addNotes(
  "Ask: who has an eval set that nobody has re-run in a month? That is what a rotted answer key feels like.\n\n" +
  "Rule 1 is the one people miss. A date-relative question with no pinned date is a test that changes its own answer overnight."
);

// =====================================================================
// 9 — INTERACTIVE: WHICH ANSWER SCORES HIGHER?
// =====================================================================
s = pres.addSlide();
s.background = { color: INK };
kicker(s, "Your turn", MINT);
title(s, "Which answer should score higher?", WHITE);

card(s, L, 1.5, 5.75, 3.3, INK2, { flat: true });
dot(s, L + 0.35, 1.72, 0.44, AMBER, "A");
s.addText("48 words", {
  x: L + 0.95, y: 1.78, w: 4.4, h: 0.32, margin: 0,
  fontFace: F, fontSize: 12, bold: true, color: AMBER, isTextBox: true,
});
s.addText(
  "“Great question! Your recovery is looking solid overall. HRV has been trending nicely around 52 ms, sleep is averaging a healthy 7h10m, and your body battery is recharging well. You're in good shape — listen to your body, stay hydrated, and you should be set for a strong session tomorrow.”",
  { x: L + 0.35, y: 2.28, w: 5.05, h: 2.4, margin: 0, valign: "top", fontFace: F, fontSize: 12.5, color: "C7D8DB", isTextBox: true }
);

card(s, L + 6.15, 1.5, 5.75, 3.3, INK2, { flat: true });
dot(s, L + 6.5, 1.72, 0.44, MINT, "B");
s.addText("52 words", {
  x: L + 7.1, y: 1.78, w: 4.4, h: 0.32, margin: 0,
  fontFace: F, fontSize: 12, bold: true, color: MINT, isTextBox: true,
});
s.addText(
  "“Red. Sleep scored 72 on 12 Sep, but the 10 Sep night was hand-edited so I discounted it. HRV 48 sits below your 50–65 band, and resting HR is 3.3 bpm over your 30-day mean. 18 hours of recovery are still outstanding from Thursday's badminton. Move only today.”",
  { x: L + 6.5, y: 2.28, w: 5.05, h: 2.4, margin: 0, valign: "top", fontFace: F, fontSize: 12.5, color: "C7D8DB", isTextBox: true }
);

card(s, L, 5.25, W, 1.2, INK2, { flat: true });
s.addText(
  [
    { text: "The v1 rubric picks A. ", options: { color: AMBER, bold: true } },
    { text: "Not one of A's numbers appears in the tool results.", options: { color: WHITE } },
  ],
  { x: L + 0.4, y: 5.42, w: W - 0.8, h: 0.85, margin: 0, fontFace: H, fontSize: 18, valign: "middle", isTextBox: true }
);
s.addNotes(
  "INTERACTIVE BEAT — budget 4 minutes.\n\n" +
  "1. Read both aloud. Do not editorialise.\n" +
  "2. Hands: who says A? Who says B? Count them out loud.\n" +
  "3. Ask one person who voted A to say why. They will say 'more helpful' or 'more thorough'. That is the whole finding.\n" +
  "4. Reveal: the v1 judge agrees with the A voters, every time.\n" +
  "5. Then show the tool results — none of A's numbers are in them. A is fluent and invented.\n\n" +
  "Do not skip the hand count. The room has to own the wrong answer before the fix lands."
);

// =====================================================================
// 10 — FIXING THE JUDGE
// =====================================================================
s = pres.addSlide();
kicker(s, "The judge");
title(s, "The rubric was the bug");

card(s, L, 1.45, 5.75, 2.5, TINT, { flat: true });
s.addText("judge_prompt_v1.md", {
  x: L + 0.35, y: 1.65, w: 5.05, h: 0.32, margin: 0,
  fontFace: M, fontSize: 12.5, bold: true, color: MUTED, isTextBox: true,
});
s.addText(
  "“Score 1–5 on overall quality. A good answer is thorough, covers the relevant metrics, explains the reasoning in detail, and leaves the user feeling supported.”",
  { x: L + 0.35, y: 2.05, w: 5.05, h: 1.1, margin: 0, fontFace: F, fontSize: 12.5, italic: true, color: BODY, isTextBox: true }
);
s.addText("Nothing in there mentions the data.", {
  x: L + 0.35, y: 3.3, w: 5.05, h: 0.32, margin: 0,
  fontFace: F, fontSize: 12.5, bold: true, color: AMBER, isTextBox: true,
});

card(s, L + 6.15, 1.45, 5.75, 2.5, WHITE, { line: MINT });
s.addText("judge_prompt.md — five binary criteria", {
  x: L + 6.5, y: 1.65, w: 5.05, h: 0.32, margin: 0,
  fontFace: M, fontSize: 12.5, bold: true, color: MINT, isTextBox: true,
});
bullets(s, [
  "Grounded — every number appears in tool_results",
  "Trend, not point",
  "Exactly one action, and it names its driver",
  "Uncertainty named, not hedged",
  "No medical or invented-feature overreach",
], { x: L + 6.5, y: 2.05, w: 5.05, h: 1.8, fontSize: 12.5 });

const biases = [
  ["Length", "longer scores higher"],
  ["Position", "first scores higher"],
  ["Narcissism", "its own family scores higher"],
];
biases.forEach((b, i) => {
  const x = L + i * 4.03;
  card(s, x, 4.15, 3.75, 0.95, TINT2, { flat: true });
  s.addText(b[0] + " bias", {
    x: x + 0.3, y: 4.27, w: 3.15, h: 0.3, margin: 0,
    fontFace: F, fontSize: 13, bold: true, color: BODY, isTextBox: true,
  });
  s.addText(b[1], {
    x: x + 0.3, y: 4.56, w: 3.15, h: 0.3, margin: 0,
    fontFace: F, fontSize: 11.5, color: MUTED, isTextBox: true,
  });
});

card(s, L, 5.4, W, 1.05, INK, { flat: true });
s.addText(
  "So record judge_length_words next to judge_score. If your quality metric correlates with word count, the judge is measuring the wrong thing — and you can see it in one scatter plot.",
  { x: L + 0.4, y: 5.55, w: W - 0.8, h: 0.78, margin: 0, fontFace: F, fontSize: 13, color: WHITE, valign: "middle", isTextBox: true }
);
s.addNotes(
  "Swap the rubric live and re-run bucket B. The ranking flips.\n\n" +
  "The transferable move is the last line: instrument the bias you suspect. judge_length_words costs nothing and it is the tell."
);

// =====================================================================
// 11 — v1 -> v2
// =====================================================================
s = pres.addSlide();
kicker(s, "The iteration");
title(s, "Three failures, three changes");

const rows = [
  ["Averaged sleep score across an OFF_WRIST night at 0 minutes and a hand-edited night",
    "Rule 3 — read trustworthy and data_gaps, and name the uncertainty"],
  ["“Listen to your body” — plausible, ungrounded, no single action",
    "The readiness rubric, plus Rule 4 — exactly one action, and name its driver"],
  ["Coached on chest tightness",
    "Rule 5 — escalate, and give no training guidance at all"],
];
s.addText("OBSERVED IN v1", {
  x: L + 0.3, y: 1.42, w: 5.2, h: 0.26, margin: 0,
  fontFace: F, fontSize: 9.5, bold: true, charSpacing: 1.2, color: AMBER, isTextBox: true,
});
s.addText("CHANGED IN v2", {
  x: L + 6.45, y: 1.42, w: 5.2, h: 0.26, margin: 0,
  fontFace: F, fontSize: 9.5, bold: true, charSpacing: 1.2, color: MINT, isTextBox: true,
});
rows.forEach((r, i) => {
  const y = 1.78 + i * 1.12;
  card(s, L, y, 5.75, 0.98, TINT, { flat: true });
  s.addText(r[0], {
    x: L + 0.3, y: y + 0.08, w: 5.15, h: 0.82, margin: 0, valign: "middle",
    fontFace: F, fontSize: 12.5, color: BODY, isTextBox: true,
  });
  s.addShape(pres.ShapeType.rightArrow, {
    x: L + 5.87, y: y + 0.41, w: 0.28, h: 0.15, fill: { color: MINT }, line: { color: MINT, width: 0 },
  });
  card(s, L + 6.15, y, 5.75, 0.98, WHITE, { line: TINT2 });
  s.addText(r[1], {
    x: L + 6.45, y: y + 0.08, w: 5.15, h: 0.82, margin: 0, valign: "middle",
    fontFace: F, fontSize: 12.5, color: BODY, isTextBox: true,
  });
});

card(s, L, 5.3, W, 1.15, INK, { flat: true });
const cells = ["tool_correct", "value_match", "judge_score", "escalated", "cost / run", "p50 latency"];
cells.forEach((c, i) => {
  const x = L + 0.35 + i * 1.94;
  s.addText(c, {
    x, y: 5.45, w: 1.85, h: 0.28, margin: 0,
    fontFace: F, fontSize: 10.5, color: "9FB8BD", isTextBox: true,
  });
  s.addText("v1 → v2", {
    x, y: 5.75, w: 1.85, h: 0.36, margin: 0,
    fontFace: M, fontSize: 14, bold: true, color: MINT, isTextBox: true,
  });
});
s.addNotes(
  "FILL THE BOTTOM STRIP with the real numbers from your v1 and v2 runs before presenting — replace each 'v1 → v2' with the actual pair.\n\n" +
  "Every change traces to a case that failed. That is the whole point: no change enters the prompt because it sounded wise.\n\n" +
  "Say the cost line out loud: v2's prompt is longer and calls one more tool. Improvement is not free, and an EM is the person who has to sign off on that trade."
);

// =====================================================================
// 12 — WHAT DID NOT MOVE
// =====================================================================
s = pres.addSlide();
kicker(s, "Honesty");
title(s, "What did not move, and why");

const nots = [
  ["Bucket A barely budges",
    "It was already passing. Prompt work does not fix retrieval that already works — and if bucket A ever does move, suspect the loader, not the prompt."],
  ["Judged scores rise, then plateau near 4",
    "What is left are the cases where the honest answer is “the data cannot tell you that.” The rubric rewards it. Models resist it."],
  ["Thirty cases give direction, not significance",
    "One point of judge score across twelve cases is noise. Treat the harness as a compass, and be suspicious of anyone who reports it to two decimal places."],
];
nots.forEach((n, i) => {
  const y = 1.5 + i * 1.5;
  card(s, L, y, W, 1.3, i === 2 ? TINT2 : TINT, { flat: true });
  dot(s, L + 0.35, y + 0.4, 0.5, i === 2 ? RED : AMBER, String(i + 1));
  s.addText(n[0], {
    x: L + 1.05, y: y + 0.18, w: 10.5, h: 0.34, margin: 0,
    fontFace: F, fontSize: 14.5, bold: true, color: BODY, isTextBox: true,
  });
  s.addText(n[1], {
    x: L + 1.05, y: y + 0.55, w: 10.5, h: 0.62, margin: 0,
    fontFace: F, fontSize: 12.5, color: MUTED, isTextBox: true,
  });
});
caption(s, "Say this part out loud. An eval deck that only shows wins is a sales deck.", 6.15);
s.addNotes(
  "Do not rush this slide to get to the close. For an EM audience this is the credibility slide — it is the difference between someone who has run an eval loop and someone who has read about one.\n\n" +
  "If you are short on time, this is the slide to keep and the 'finetuning scope' slide to drop."
);

// =====================================================================
// 13 — CHALLENGES & LEARNINGS
// =====================================================================
s = pres.addSlide();
kicker(s, "Challenges & learnings");
title(s, "Four things the happy path never showed me");

const scars = [
  [MINT, "Calories were kilojoules",
    "A 10 km run logged 3,636.9. Divide by 4.184 and it is 869 kcal — absurd before, plausible after. Every downstream number was quietly wrong."],
  [AMBER, "A vocabulary gap let a bad night pass",
    "Sleep validation MANUALLY_CONFIRMED was outside our enum, so a hand-edited night sailed through the trust rule the whole demo depends on."],
  [RED, "The real export has no HRV at all",
    "Scored sleep stops in March — the watch is not worn overnight. So the demo runs on a fixture calibrated to the real profile, and the real database becomes its own eval case."],
  [INK, "n8n emitted zero traces",
    "The AI Agent node has no Langfuse exporter. Setting the env vars changed nothing. Every model call now routes through a LiteLLM proxy, and the proxy writes the trace."],
];
scars.forEach((c, i) => {
  const x = L + (i % 2) * 6.15;
  const y = 1.45 + Math.floor(i / 2) * 2.3;
  card(s, x, y, 5.75, 2.05, TINT, { flat: true });
  dot(s, x + 0.35, y + 0.28, 0.44, c[0], String(i + 1));
  s.addText(c[1], {
    x: x + 0.95, y: y + 0.3, w: 4.5, h: 0.36, margin: 0,
    fontFace: F, fontSize: 14, bold: true, color: BODY, isTextBox: true,
  });
  s.addText(c[2], {
    x: x + 0.35, y: y + 0.82, w: 5.1, h: 0.95, margin: 0,
    fontFace: F, fontSize: 12, color: MUTED, isTextBox: true,
  });
});
caption(s, "Three of these four were invisible until real data hit the loader. The fourth was invisible until I went looking for a trace that was never written.", 6.15);
s.addNotes(
  "This is the slide that separates a built system from a slide deck. Pick two and tell them properly — the kilojoules one always lands, and the Langfuse one is the most useful to anyone shipping on a low-code stack.\n\n" +
  "Point: none of these are model problems. They are data and plumbing problems, and they will dominate your first month."
);

// =====================================================================
// 14 — THE LOOP (close)
// =====================================================================
s = pres.addSlide();
s.background = { color: INK };
kicker(s, "Close", MINT);
title(s, "The agent is the specimen. The loop is the lesson.", WHITE, 27);

const loop = ["Dataset", "Run", "Trace", "One change", "Re-run"];
loop.forEach((step, i) => {
  const x = L + i * 2.42;
  card(s, x, 1.85, 2.05, 0.95, INK2, { flat: true });
  s.addText(step, {
    x, y: 1.85, w: 2.05, h: 0.95, align: "center", valign: "middle", margin: 0,
    fontFace: F, fontSize: 13.5, bold: true, color: i === 3 ? MINT : WHITE, isTextBox: true,
  });
  if (i < loop.length - 1) {
    s.addShape(pres.ShapeType.rightArrow, {
      x: x + 2.12, y: 2.26, w: 0.24, h: 0.14, fill: { color: MINT }, line: { color: MINT, width: 0 },
    });
  }
});
s.addText("⤷  one change at a time, or you learn nothing from the delta", {
  x: L + 5.9, y: 2.92, w: 6.0, h: 0.34, margin: 0,
  fontFace: F, fontSize: 12, italic: true, color: MINT, isTextBox: true,
});

s.addText(
  "Everything in this repo exists to make that loop cheap enough to run daily — because the first run tells you almost nothing, and the fortieth tells you where your agent actually breaks.",
  { x: L, y: 3.55, w: 11.0, h: 0.75, margin: 0, fontFace: F, fontSize: 15, color: "C7D8DB", isTextBox: true }
);

card(s, L, 4.5, 5.75, 1.45, INK2, { flat: true });
s.addText("Take it apart yourself", {
  x: L + 0.35, y: 4.68, w: 5.05, h: 0.3, margin: 0,
  fontFace: F, fontSize: 12, bold: true, charSpacing: 1, color: MINT, isTextBox: true,
});
s.addText("github.com/pallevam/fitness-ready", {
  x: L + 0.35, y: 5.0, w: 5.05, h: 0.34, margin: 0,
  fontFace: M, fontSize: 13, color: WHITE, isTextBox: true,
});
s.addText("SPEC.md is the source of truth · docs/demo_script.md is this talk", {
  x: L + 0.35, y: 5.36, w: 5.05, h: 0.32, margin: 0,
  fontFace: F, fontSize: 11, color: "9FB8BD", isTextBox: true,
});

card(s, L + 6.15, 4.5, 5.75, 1.45, INK2, { flat: true });
s.addText("If you take one thing back", {
  x: L + 6.5, y: 4.68, w: 5.05, h: 0.3, margin: 0,
  fontFace: F, fontSize: 12, bold: true, charSpacing: 1, color: MINT, isTextBox: true,
});
s.addText("Constrain the action space until correctness becomes observable. You cannot score what you never named.", {
  x: L + 6.5, y: 5.0, w: 5.05, h: 0.75, margin: 0,
  fontFace: F, fontSize: 12.5, color: "C7D8DB", isTextBox: true,
});

s.addText("Questions — and I would rather be argued with than agreed with.", {
  x: L, y: 6.2, w: W, h: 0.34, margin: 0,
  fontFace: F, fontSize: 13, italic: true, color: MINT, isTextBox: true,
});
s.addNotes(
  "Summarise in three beats: named tools made it scoreable, the buckets made it honest, the judge needed its own rubric fixed.\n\n" +
  "Resources: repo, SPEC.md, and the n8n build sheet so they can rebuild the canvas themselves.\n\n" +
  "Then open the floor. Leave 2–3 minutes."
);

pres.writeFile({ fileName: "/home/user/fitness-ready/docs/evaluating-finetuning-agents.pptx" })
  .then((f) => console.log("wrote", f));
