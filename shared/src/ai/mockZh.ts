import type { TheoremAnatomy } from "../model";

/**
 * The offline demo's Chinese: names, aliases, definitions and prerequisite reasons for every entry of its knowledge
 * base (keyed like the English KB in mock.ts, `reasons` in the order of its `deps`), and the Chinese templates of its
 * tasks. The definitions follow the Chinese example graph (群论) where it has the concept.
 */
export const KB_ZH: Record<string, { name: string; aliases: string[]; definition: string; reasons: string[] }> = {
  group: {
    name: "群",
    aliases: [],
    definition: "带有一个满足结合律的二元运算的集合，其中有单位元，且每个元素都有逆元。",
    reasons: [],
  },
  subgroup: {
    name: "子群",
    aliases: [],
    definition: "群的一个子集，它在同一运算下本身也构成群。",
    reasons: ["子群是群中对运算封闭的子集。"],
  },
  "normal subgroup": {
    name: "正规子群",
    aliases: ["不变子群"],
    definition: "$G$ 的子群 $N$，对任意 $g \\in G$ 都有 $gNg^{-1} = N$。",
    reasons: ["正规子群是在共轭下不变的子群。"],
  },
  "quotient group": {
    name: "商群",
    aliases: ["因子群"],
    definition: "正规子群 $N$ 的陪集构成的群 $G/N$，运算为 $(aN)(bN) = abN$。",
    reasons: ["$G/N$ 由群 $G$ 构造而来。", "只有 $N$ 是正规子群时，陪集的乘法才是良定义的。"],
  },
  homomorphism: {
    name: "同态",
    aliases: ["群同态"],
    definition: "在代数结构之间保持运算的映射，例如对群有 $\\varphi(ab) = \\varphi(a)\\varphi(b)$。",
    reasons: [],
  },
  isomorphism: {
    name: "同构",
    aliases: ["群同构"],
    definition: "双射的同态；它的逆映射也是同态。",
    reasons: ["同构定义为双射的同态。"],
  },
  kernel: {
    name: "核",
    aliases: ["同态核"],
    definition: "同态 $\\varphi$ 映到单位元的元素构成的集合 $\\ker\\varphi$。",
    reasons: ["核是对同态定义的。"],
  },
  chicken: {
    name: "鸡",
    aliases: [],
    definition: "一种家养的鸟，从蛋中孵出。",
    reasons: ["鸡是从蛋里孵出来的。"],
  },
  egg: {
    name: "蛋",
    aliases: ["鸡蛋"],
    definition: "鸟产下的椭圆形生殖体，孵化后会有雏鸟破壳而出。",
    reasons: ["蛋是鸡下的。"],
  },
  "first isomorphism theorem": {
    name: "第一同构定理",
    aliases: ["同态基本定理"],
    definition: "对同态 $\\varphi: G \\to H$，$G / \\ker\\varphi$ 与 $\\operatorname{im}\\varphi$ 同构。",
    reasons: ["定理从一个同态 $\\varphi: G \\to H$ 出发。", "它的结论是一个同构 $G/\\ker\\varphi \\cong \\operatorname{im}\\varphi$。"],
  },
  "lagrange's theorem": {
    name: "拉格朗日定理",
    aliases: [],
    definition: "对有限群 $G$ 及其子群 $H \\le G$，$H$ 的阶 $|H|$ 整除 $|G|$。",
    reasons: ["定理讨论的是 $G$ 的子群 $H$ 的阶。"],
  },
};

/** The Mathlib answers' "why" in Chinese, by declaration name (the names themselves stay Lean identifiers). */
export const MATHLIB_WHY_ZH: Record<string, string> = {
  Group: "群的类",
  Subgroup: "作为结构的子群",
  "Subgroup.Normal": "正规性谓词",
  MonoidHom: "群同态（捆绑的幺半群同态）",
  "MonoidHom.ker": "作为子群的核",
  "MonoidHom.normal_ker": "核是正规子群",
  "MonoidHom.kernelSubgroupOfDoom": "一个编造的名字，用来展示它会被丢掉",
  MulEquiv: "群同构",
  "QuotientGroup.quotientKerEquivRange": "G / ker φ ≃ range φ",
};

export const ANATOMY_ZH: Record<string, TheoremAnatomy> = {
  "first isomorphism theorem": {
    hypotheses: [
      {
        text: "$G$ 和 $H$ 是群。",
        whyNeeded: "只有当结构是群时，商 $G/N$ 和像才是群。",
        counterexampleIfDropped: "对幺半群而言，满同态 $(\\mathbb{N}, +) \\to \\{0, 1\\}$（其中 $1 + 1 = 1$）的核是平凡的 $\\{0\\}$，却不是单射，所以仅凭核不能确定商。",
      },
      {
        text: "$\\varphi: G \\to H$ 是同态。",
        whyNeeded: "核是正规子群、诱导的映射是良定义的，都只是因为 $\\varphi$ 保持乘积。",
        counterexampleIfDropped: "对 $\\mathbb{Z}$ 上的映射 $x \\mapsto x + 1$，$0$ 的原像是 $\\{-1\\}$，不是子群，所以 $G/\\ker\\varphi$ 没有意义。",
      },
    ],
    conclusion: "$G / \\ker\\varphi \\cong \\operatorname{im}\\varphi$，同构由 $g\\ker\\varphi \\mapsto \\varphi(g)$ 给出。",
    proofIdea: "定义 $\\bar\\varphi(g\\ker\\varphi) = \\varphi(g)$。它是良定义的单射，因为 $\\varphi(g) = \\varphi(h)$ 当且仅当 $g^{-1}h \\in \\ker\\varphi$。它是同态，因为 $\\varphi$ 是同态；按构造它映满 $\\operatorname{im}\\varphi$。",
    examples: [
      "$\\det: GL_n(\\mathbb{R}) \\to \\mathbb{R}^\\times$ 给出 $GL_n(\\mathbb{R}) / SL_n(\\mathbb{R}) \\cong \\mathbb{R}^\\times$。",
      "约化 $\\mathbb{Z} \\to \\mathbb{Z}/n\\mathbb{Z}$ 给出 $\\mathbb{Z}/n\\mathbb{Z} \\cong \\mathbb{Z}/n\\mathbb{Z}$，这正是商的定义。",
    ],
    nonExamples: [
      "它并不是说 $G \\cong \\ker\\varphi \\times \\operatorname{im}\\varphi$：$\\mathbb{Z}/4\\mathbb{Z} \\to \\mathbb{Z}/2\\mathbb{Z}$ 的核与像都是 $\\mathbb{Z}/2\\mathbb{Z}$，但 $\\mathbb{Z}/4\\mathbb{Z} \\not\\cong (\\mathbb{Z}/2\\mathbb{Z})^2$。",
    ],
  },
  "lagrange's theorem": {
    hypotheses: [
      {
        text: "$G$ 是有限群。",
        whyNeeded: "只有有限群的阶才是数；证明要数陪集。",
        counterexampleIfDropped: "对无限群 $G$，这个命题作为整数的整除没有意义；此时改用指数 $[G:H]$。",
      },
      {
        text: "$H$ 是 $G$ 的子群。",
        whyNeeded: "子群的陪集把 $G$ 划分成大小都为 $|H|$ 的块。",
        counterexampleIfDropped: "对一般的子集它不成立：$S_3$ 的任意 4 元子集有 4 个元素，而 4 不整除 6。",
      },
    ],
    conclusion: "$|H|$ 整除 $|G|$，且 $|G| = [G:H]\\,|H|$。",
    proofIdea: "左陪集 $gH$ 构成 $G$ 的一个划分，且 $h \\mapsto gh$ 是双射 $H \\to gH$，所以每个陪集都有 $|H|$ 个元素。逐个陪集地数 $G$ 的元素，就得到 $|G| = [G:H]\\,|H|$。",
    examples: ["在 $S_3$（阶为 6）中，子群的阶为 1、2、3 和 6。"],
    nonExamples: ["逆命题不成立：$A_4$ 的阶为 12，却没有 6 阶子群。"],
  },
};

export const EXPLAIN_ZH: Record<string, { intuition: string; keyPoints: string[]; examples: { title: string; body: string }[]; pitfalls: string[] }> = {
  homomorphism: {
    intuition: "同态把一个结构翻译成另一个结构，而不破坏它的运算：先运算再映射，或先映射再运算，结果相同。",
    keyPoints: [
      "对所有 $a, b$ 都有 $\\varphi(ab) = \\varphi(a)\\varphi(b)$。",
      "它把单位元映到单位元，把逆元映到逆元。",
      "它的核是正规子群，它的像是子群。",
    ],
    examples: [
      { title: "指数映射", body: "从 $(\\mathbb{R}, +)$ 到 $(\\mathbb{R}_{>0}, \\times)$ 的 $x \\mapsto e^x$：$e^{x+y} = e^x e^y$。" },
      { title: "模 n 约化", body: "$\\mathbb{Z} \\to \\mathbb{Z}/n\\mathbb{Z}$ 把每个整数映到它的剩余类；和映到和。" },
      { title: "反例", body: "$(\\mathbb{Z}, +)$ 上的 $x \\mapsto x + 1$ 不把 $0$ 映到 $0$，所以不是同态。" },
    ],
    pitfalls: [
      "同态不必是单射或满射——这正是同构额外要求的。",
      "要检查两边结构各自的运算：$(\\mathbb{R}, +) \\to (\\mathbb{R}, \\times)$ 与 $(\\mathbb{R}, +) \\to (\\mathbb{R}, +)$ 是不同的情形。",
    ],
  },
  isomorphism: {
    intuition: "同构的结构就是把元素换了名字的同一个结构。",
    keyPoints: ["同构是双射的同态。", "它的逆映射自动是同态。", "同构的群具有完全相同的群论性质。"],
    examples: [{ title: "对数", body: "$\\log: (\\mathbb{R}_{>0}, \\times) \\to (\\mathbb{R}, +)$ 是同构，是 $\\exp$ 的逆。" }],
    pitfalls: ["元素个数相同并不意味着两个群同构（$\\mathbb{Z}/4\\mathbb{Z}$ 与 $\\mathbb{Z}/2\\mathbb{Z} \\times \\mathbb{Z}/2\\mathbb{Z}$）。"],
  },
};

/** The "explain more" voices in Chinese (same wrappers as the English ones: the content stays untouched). */
export const EXPLAIN_VOICE_ZH: Record<
  string,
  { open: (name: string) => string; point: (text: string, i: number) => string; example: (body: string) => string; pitfall: (text: string) => string }
> = {
  "nature-documentary": {
    open: (n) => `在数学幽静的灌木丛中，我们发现了${n}。让我们静静观察，不去打扰它。`,
    point: (x, i) => (i === 0 ? `仔细观察：${x}` : `令人惊叹的是：${x}`),
    example: (b) => `野外的一个标本：${b}`,
    pitfall: (x) => `年轻的学习者常在这里失足。${x}`,
  },
  "sports-commentator": {
    open: (n) => `现场直播！${n}登场了，全场观众都站了起来！`,
    point: (x, i) => (i === 0 ? `漂亮的一球：${x}` : `我们来看慢镜头回放：${x}`),
    example: (b) => `即时回放：${b}`,
    pitfall: (x) => `哦，犯规了！${x}`,
  },
  "noir-detective": {
    open: (n) => `雨已经下了三天，这时${n}的案子落到了我的桌上。`,
    point: (x, i) => (i === 0 ? `第一条线索：${x}` : `又一条线索。${x}`),
    example: (b) => `这种事我以前见过。${b}`,
    pitfall: (x) => `新手就是在这里栽跟头的。${x}`,
  },
  "medieval-scholar": {
    open: (n) => `兹有鄙陋学人，谨撰关于${n}之浅论一篇。`,
    point: (x, i) => (i === 0 ? `首先，须知：${x}` : `又有记载曰：${x}`),
    example: (b) => `如古人所示：${b}`,
    pitfall: (x) => `诸君慎之，勿蹈不学者之误。${x}`,
  },
  infomercial: {
    open: (n) => `还在为不给力的概念烦恼吗？隆重推出${n}！`,
    point: (x, i) => (i === 0 ? `就是这么简单：${x}` : `等等，还有更多！${x}`),
    example: (b) => `满意的顾客反馈：${b}`,
    pitfall: (x) => `注意，请阅读细则：${x}`,
  },
  shakespearean: {
    open: (n) => `听啊！是何概念自那边的课本中破晓而出？乃是${n}。`,
    point: (x, i) => (i === 0 ? `牢记此言：${x}` : `还有呢，好友：${x}`),
    example: (b) => `看哪，一例：${b}`,
    pitfall: (x) => `唉，多少学者曾于此失足。${x}`,
  },
};

type Quip = (a: string, b: string) => string;
export const ABSURD_VOICE_ZH: Record<string, { title: Quip; moral: string; quips: Quip[] }> = {
  deadpan: {
    title: (a, b) => `${a}与${b}：一个再普通不过的联系`,
    moral: "就这样。万物相连，而且大体上没什么问题。",
    quips: [(a, b) => `${a}通向${b}。没有人感到意外。`, (_a, b) => `然后是${b}。自然而然。`, (a, b) => `从${a}到${b}只有几步路。我们走过去了。`],
  },
  conspiracy: {
    title: (a, b) => `关于${a}和${b}，他们不想让你知道的事`,
    moral: "点连得够多就成了线。结论你自己下。",
    quips: [
      (a, b) => `${a}和${b}。巧合？我可不这么认为。`,
      (a, b) => `顺着${a}这条线索往下查：它直通${b}。一如既往，就藏在眼皮底下。`,
      (a, b) => `${a}对谁有利？${b}。每一次都是。`,
    ],
  },
  epic: {
    title: (a, b) => `${a}与${b}的传奇`,
    moral: "于是预言应验了，课本里的预言通常都会应验。",
    quips: [
      (a, b) => `看哪，${b}自${a}中崛起，万古为之震颤。`,
      (a, b) => `随后${b}降临，正如${a}的古老卷轴所预言。`,
      (a, b) => `吟游诗人至今仍在传唱${a}与${b}相遇的那一天。`,
    ],
  },
  bureaucratic: {
    title: (a, b) => `27-B 号表格：申请将${a}连接到${b}`,
    moral: "一式三份，已批准。开悟需等待六到八周。",
    quips: [
      (a, b) => `${a}司已将您的申请转交${b}办公室。`,
      (a, b) => `从${a}到${b}的连接已批准，尚待第二个签字。`,
      (a, b) => `请取号：${b}稍后会接待${a}。`,
    ],
  },
  "academic-overkill": {
    title: (a, b) => `论${a}与${b}之间的非平凡关系：初步札记`,
    moral: "尚需进一步研究。也需要进一步的经费。",
    quips: [
      (a, b) => `可以证明（见脚注 47），${a}在某种精确的意义下与${b}相关。`,
      (a, b) => `引理：${a}迫使我们讨论${b}。证明：留给审稿人。`,
      (a, b) => `在温和的假设下，${b}可由${a}推出，尽管作者承认他们先喝了杯咖啡。`,
    ],
  },
};

/** The absurd chain's concepts in Chinese, by their English name in BRIDGES (mock.ts). */
export const BRIDGE_NAME_ZH: Record<string, string> = {
  Subgroup: "子群",
  Group: "群",
  "Normal subgroup": "正规子群",
  "Quotient group": "商群",
  Homomorphism: "同态",
  Kernel: "核",
  Isomorphism: "同构",
  "First isomorphism theorem": "第一同构定理",
  "Exponential function": "指数函数",
  "Fourier transform": "傅里叶变换",
  "Heat equation": "热方程",
  Heat: "热",
  "Maillard reaction": "美拉德反应",
  Toast: "烤面包片",
  Egg: "蛋",
  Chicken: "鸡",
  "Written language": "文字",
  Paper: "纸",
};

/** The Chinese of each BRIDGES link (mock.ts), in the same order: active labels both ways, and the fact. */
export const BRIDGES_ZH: { kind: string; back: string; fact: string }[] = [
  { kind: "居于", back: "包含", fact: "子群是群的一个子集，它在同一运算下本身也构成群。" },
  { kind: "属于", back: "细化为", fact: "正规子群是在共轭下不变的子群。" },
  { kind: "基于", back: "产生", fact: "商群 $G/N$ 由正规子群 $N$ 的陪集组成。" },
  { kind: "规定规则给", back: "保持", fact: "同态是群之间保持群运算的映射。" },
  { kind: "衡量单射性", back: "决定", fact: "同态的核是它映到单位元的元素全体。" },
  { kind: "属于", back: "特化为", fact: "同构是双射的同态。" },
  { kind: "出发于", back: "支撑", fact: "第一同构定理从一个同态 $\\varphi: G \\to H$ 出发，描述它的像。" },
  { kind: "包括", back: "例示", fact: "指数函数 $x \\mapsto e^x$ 是从 $(\\mathbb{R}, +)$ 到 $(\\mathbb{R}_{>0}, \\times)$ 的同态，因为 $e^{x+y} = e^x e^y$。" },
  { kind: "构建", back: "基于", fact: "傅里叶变换把一个函数写成复指数 $e^{2\\pi i \\xi x}$ 的叠加。" },
  { kind: "为之发明解法", back: "启发", fact: "约瑟夫·傅里叶为求解热方程发展了傅里叶分析，见于他 1822 年关于热的理论的著作。" },
  { kind: "描述流动", back: "遵循", fact: "热方程 $u_t = \\alpha \\nabla^2 u$ 描述热在材料中如何扩散。" },
  { kind: "加速", back: "需要", fact: "氨基酸与还原糖之间的美拉德反应在约 140 到 165 °C 时变得很快。" },
  { kind: "烤黄", back: "得色于", fact: "烤面包片变成褐色，主要是因为面包表面的美拉德反应。" },
  { kind: "凝固于", back: "使之凝固", fact: "蛋受热时，其中的蛋白质变性，蛋就凝固了。" },
  { kind: "下", back: "孵出", fact: "母鸡下蛋。" },
  { kind: "写在", back: "承载", fact: "文字写在纸上已有大约两千年。" },
  { kind: "燃烧于", back: "点燃", fact: "纸加热到大约 230 °C 就会着火。" },
];
