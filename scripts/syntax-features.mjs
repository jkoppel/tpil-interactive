// The Lean syntax a reader of the book should be able to write from memory, and a detector for
// each piece. Drills are chosen so that every feature here is practised (see select-drills.mjs).
//
// Only syntax the book's own examples use is listed: drills are drawn from those examples.
//
// Detectors run on code with comments and string contents removed. They are deliberately simple
// token patterns: a false positive only means a drill is credited with one feature too many.

/** Removes comments and the contents of string literals, keeping line structure. */
export function codeOnly(code) {
  let out = "";
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    const two = code.slice(i, i + 2);
    if (depth > 0) {
      if (two === "/-") { depth++; i++; } else if (two === "-/") { depth--; i++; } else if (code[i] === "\n") out += "\n";
      continue;
    }
    if (two === "/-") { depth = 1; i++; continue; }
    if (two === "--") {
      while (i < code.length && code[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (code[i] === '"') {
      out += '""';
      for (i++; i < code.length && code[i] !== '"'; i++) if (code[i] === "\\") i++;
      continue;
    }
    out += code[i];
  }
  return out;
}

const kw = (w) => new RegExp(`(^|[^\\w.'])${w}(?![\\w'])`, "m");
const tactic = (t) => new RegExp(`(\\bby\\b|^\\s+|[;·(\\[|]|<;>|=>)\\s*${t}(?![\\w'])`, "m");

/** id -> { label, test }. Labels name the construct, not its spelling. */
export const FEATURES = {
  // Commands
  def: { label: "definitions", test: kw("def") },
  theorem: { label: "theorems", test: kw("theorem") },
  example: { label: "anonymous examples", test: kw("example") },
  abbrev: { label: "abbreviations", test: kw("abbrev") },
  axiom: { label: "axioms", test: kw("axiom") },
  check: { label: "checking types", test: /#check\b/ },
  eval: { label: "evaluating", test: /#eval\b/ },
  print: { label: "printing definitions", test: /#print\b/ },
  reduce: { label: "reducing terms", test: /#reduce\b/ },
  variable: { label: "section variables", test: kw("variable") },
  section: { label: "sections", test: kw("section") },
  namespace: { label: "namespaces", test: kw("namespace") },
  open: { label: "opening namespaces", test: /^\s*open\b/m },
  universe: { label: "universe declarations", test: kw("universe") },
  setOption: { label: "options", test: kw("set_option") },
  attribute: { label: "attributes", test: /\battribute\s*\[|@\[/ },
  instanceCmd: { label: "instances", test: kw("instance") },
  classCmd: { label: "type classes", test: /^\s*class\b/m },
  structureCmd: { label: "structures", test: /^\s*structure\b/m },
  inductive: { label: "inductive types", test: kw("inductive") },
  mutual: { label: "mutual blocks", test: kw("mutual") },
  notation: { label: "notations", test: /\b(notation|infix|infixl|infixr|prefix|postfix)\b/ },
  macro: { label: "macros and syntax", test: /\b(macro|syntax|macro_rules)\b/ },
  noncomputable: { label: "noncomputable definitions", test: kw("noncomputable") },
  privateProtected: { label: "private/protected", test: /\b(private|protected)\b/ },
  export: { label: "exporting names", test: /^\s*export\b/m },

  // Terms
  fun: { label: "lambda abstraction", test: /\bfun\b|λ/ },
  funPattern: { label: "destructuring lambdas", test: /\bfun\s*(\([^)]*\)\s*)*⟨/ },
  anonCtor: { label: "anonymous constructors", test: /⟨/ },
  proj: { label: "projections and dot notation", test: /(\b[a-z][\w']*|[)⟩])\.(\d|[a-z]\w*)/ },
  explicitAt: { label: "explicit arguments with @", test: /@[A-Za-z]/ },
  implicitBinder: { label: "implicit binders", test: /\{[^}:]*:[^}]*\}/ },
  instBinder: { label: "instance binders", test: /\[[A-Z][\w.]*\s[^\]]*\]|\[\w+\s*:\s*[A-Z]/ },
  namedArg: { label: "named arguments", test: /\(\w+\s*:=/ },
  depArrow: { label: "dependent function types", test: /\([^()]*:\s*[^()]*\)\s*→/ },
  forall: { label: "universal quantifiers", test: /∀/ },
  exists: { label: "existential quantifiers", test: /∃/ },
  sigma: { label: "Σ types", test: /Σ|\bSigma\b/ },
  prod: { label: "product types", test: /×/ },
  subtype: { label: "subtypes", test: /\{\s*\w+\s*(:\s*[^/]*)?\/\// },
  sort: { label: "universes (Sort/Type u)", test: /\bSort\b|\bType\s+[u-w]\b|\.\{/ },
  let: { label: "local definitions", test: /\blet\b/ },
  have: { label: "local facts", test: /\bhave\b/ },
  show: { label: "show ... from / annotating the goal", test: /\bshow\b/ },
  this: { label: "anonymous `this`", test: /\bthis\b/ },
  assumptionQuote: { label: "assumption quotes", test: /‹/ },
  match: { label: "match expressions", test: /\bmatch\b/ },
  equations: { label: "definitions by equations", test: /^\s*\|.*=>/m },
  ifThenElse: { label: "if-then-else", test: /\bif\b[\s\S]*\bthen\b/ },
  ifLet: { label: "decidable if with a hypothesis name", test: /\bif\s+\w+\s*:/ },
  calc: { label: "calculational proofs", test: /\bcalc\b/ },
  subst: { label: "rewriting with ▸", test: /▸/ },
  absurd: { label: "absurd and False.elim", test: /\b(absurd|False\.elim)\b/ },
  structInst: { label: "structure instances", test: /\{\s*\w+\s*:=/ },
  structUpdate: { label: "structure update", test: /\{\s*\w+\s+with\b/ },
  pipe: { label: "<| and |> application", test: /<\||\|>|\$/ },
  cdotFun: { label: "· function shorthand", test: /\(\s*·|·\s*[+*-]/ },
  whereClause: { label: "where clauses", test: /\bwhere\b/ },
  letRec: { label: "let rec", test: /\blet\s+rec\b/ },
  termination: { label: "termination_by", test: /\btermination_by\b/ },
  decreasing: { label: "decreasing_by", test: /\bdecreasing_by\b/ },
  deriving: { label: "deriving", test: /\bderiving\b/ },
  extends: { label: "structure inheritance", test: /\bextends\b/ },
  inaccessible: { label: "inaccessible patterns", test: /\.\(/ },
  nomatch: { label: "empty matches", test: /\bnomatch\b|\bnofun\b/ },
  motive: { label: "explicit motives", test: /\(motive\s*:=/ },
  quot: { label: "quotients", test: /\bQuot(ient)?\.\w+|⟦/ },
  coe: { label: "coercions", test: /↑|\bCoe(Sort|Fun|Dep)?\b/ },
  rec: { label: "recursors", test: /\.rec\b|\.recOn\b|\.casesOn\b/ },
  iff: { label: "iff intro/mp/mpr", test: /Iff\.intro|\.mp\b|\.mpr\b/ },
  orElim: { label: "or elimination", test: /Or\.elim|Or\.inl|Or\.inr|\.inl\b|\.inr\b/ },
  andIntro: { label: "and intro/elim", test: /And\.intro|And\.left|And\.right/ },
  existsIntro: { label: "∃ intro/elim", test: /Exists\.intro|Exists\.elim/ },
  eqLemmas: { label: "Eq.symm/trans/subst/congr", test: /Eq\.(symm|trans|subst|refl|mpr|mp)|congrArg|congrFun|\.symm\b|\.trans\b/ },
  byCases: { label: "byCases / byContradiction", test: /\b(byCases|byContradiction|Classical\.\w+)\b/ },

  // Tactics
  by: { label: "tactic blocks", test: /\bby\b/ },
  intro: { label: "intro", test: tactic("intros?") },
  apply: { label: "apply", test: tactic("apply") },
  exact: { label: "exact", test: tactic("exact") },
  rfl: { label: "rfl", test: tactic("rfl") },
  rw: { label: "rewriting", test: /\brw\s*\[|\brewrite\s*\[/ },
  rwAt: { label: "rewriting hypotheses", test: /\brw\s*\[[^\]]*\]\s*at\b/ },
  rwBackward: { label: "rewriting right-to-left", test: /\brw\s*\[[^\]]*←/ },
  simp: { label: "simp", test: tactic("simp") },
  simpArgs: { label: "simp with lemmas", test: /\bsimp\b[^\n]*\[/ },
  constructor: { label: "constructor", test: tactic("constructor") },
  cases: { label: "cases", test: tactic("cases") },
  casesWith: { label: "cases with named alternatives", test: /\bcases\b[^\n]*\bwith\b/ },
  induction: { label: "induction", test: tactic("induction") },
  inductionWith: { label: "induction with named alternatives", test: /\binduction\b[^\n]*\bwith\b/ },
  caseTag: { label: "case tags", test: /^\s*case\s+[\w.]+/m },
  focusDot: { label: "focusing with ·", test: /^\s*[·.]\s+\S/m },
  seqAll: { label: "<;> combinator", test: /<;>/ },
  first: { label: "first | ...", test: /\bfirst\s*\|/ },
  repeat: { label: "repeat", test: tactic("repeat") },
  try: { label: "try", test: tactic("try") },
  allGoals: { label: "all_goals/any_goals", test: /\b(all_goals|any_goals)\b/ },
  assumption: { label: "assumption", test: tactic("assumption") },
  contradiction: { label: "contradiction/exfalso", test: /\b(contradiction|exfalso)\b/ },
  revert: { label: "revert/generalize", test: /\b(revert|generalize)\b/ },
  existsTac: { label: "exists", test: tactic("exists") },
  injection: { label: "injection", test: /\binjection\b/ },
  omega: { label: "omega/decide", test: /\b(omega|decide)\b/ },
  tacticHave: { label: "have/show in tactic mode", test: /^\s+(have|show)\b/m },
  conv: { label: "conv mode", test: /\bconv\b/ },
  convNav: { label: "navigating in conv mode", test: /\bconv\b[\s\S]*\b(lhs|rhs|arg|enter|pattern)\b/ },
  unfold: { label: "unfold", test: /\b(unfold|delta)\b/ },
  funInduction: { label: "functional induction", test: /\b(fun_induction|fun_cases)\b/ },
  funext: { label: "function extensionality", test: /\bfunext\b/ },
};

/** The features an example uses. */
export function featuresOf(code) {
  const c = codeOnly(code);
  return Object.keys(FEATURES).filter((id) => FEATURES[id].test.test(c));
}
