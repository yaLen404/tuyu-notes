/** 代码块：语言表 + 轻量语法高亮。
 *
 *  这里只做"看起来像代码"的着色，不追求编译器级准确：
 *  注释 / 字符串 / 数字 / 关键字 / 函数名 / 类型 / 标签属性这几类够用了。
 *  整个模块不碰 DOM，方便 Node 里直接单测；输出里的所有源码都已转义。
 */

/** Typora 支持的代码语言（小写，按字母序）。空字符串表示纯文本。 */
export const CODE_LANGUAGES = [
  'abap', 'apl', 'asn.1', 'asp', 'assembly', 'bhdl', 'c', 'c#', 'c++', 'ceylon',
  'clojure', 'cmake', 'cobol', 'coffeescript', 'commonlisp', 'cql', 'crystal',
  'css', 'cypher', 'cython', 'd', 'dart', 'diff', 'django', 'dockerfile', 'dtd',
  'dylan', 'elixir', 'elm', 'embeddedjs', 'erb', 'erlang', 'f#', 'forth',
  'fortran', 'gfm', 'gherkin', 'glsl', 'go', 'groovy', 'handlebars', 'haskell',
  'haxe', 'htaccess', 'hive', 'html', 'http', 'hxml', 'idl', 'jade', 'java',
  'javascript', 'jinja2', 'json', 'jsp', 'jsx', 'julia', 'kotlin', 'less',
  'livescript', 'lua', 'makefile', 'mariadb', 'markdown', 'mbox', 'mssql',
  'mysql', 'nginx', 'nim', 'nsis', 'objective-c', 'ocaml', 'octave', 'oz',
  'pascal', 'peg.js', 'perl', 'pgp', 'php', 'plsql', 'powershell', 'postgresql',
  'properties', 'protobuf', 'pseudocode', 'pug', 'python', 'q', 'r', 'rst',
  'ruby', 'rust', 'sas', 'scala', 'scheme', 'scss', 'shell', 'smalltalk',
  'smarty', 'solidity', 'spreadsheet', 'sql', 'squirrel', 'stata', 'stylus',
  'svelte', 'swift', 'systemverilog', 'tcl', 'tex', 'tiddlywiki', 'tiki',
  'toml', 'turtle', 'twig', 'typescript', 'v', 'vb', 'vbscript', 'velocity',
  'verilog', 'vue', 'web-idl', 'xml', 'xquery', 'yacas', 'yaml', 'yara',
];

/** 输入到代码围栏里的别名 → 上面的规范名。 */
const ALIASES = {
  js: 'javascript', 'text/javascript': 'javascript', node: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  react: 'jsx',
  py: 'python', python3: 'python',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', console: 'shell',
  htmlmixed: 'html', htm: 'html', xhtml: 'html',
  xml: 'xml', svg: 'xml', plist: 'xml',
  csharp: 'c#', cs: 'c#', 'c-sharp': 'c#',
  cpp: 'c++', cc: 'c++', cxx: 'c++', 'cplusplus': 'c++',
  objc: 'objective-c', 'obj-c': 'objective-c',
  yml: 'yaml',
  md: 'markdown',
  ini: 'properties', conf: 'properties',
  latex: 'tex', stex: 'tex',
  vuejs: 'vue', 'vue.js': 'vue', 'vue-template': 'vue',
  asm: 'assembly', nasm: 'assembly', gas: 'assembly',
  coffee: 'coffeescript',
  lisp: 'commonlisp',
  ps1: 'powershell', pwsh: 'powershell',
  postgres: 'postgresql', psql: 'postgresql',
  plain: '', plaintext: '', text: '', none: '', txt: '',
  'asciiarmor': 'pgp', 'pgp-keys': 'pgp',
  'restructuredtext': 'rst', 'wiki': 'tiddlywiki', 'tikiwiki': 'tiki', 'tiki-wiki': 'tiki',
  basic: 'vb', 'text/x-python': 'python',
};

/** 把代码围栏里的语言名归一化（高亮用；存盘仍保留用户写的原文）。 */
export function normalizeLang(lang) {
  const raw = String(lang == null ? '' : lang).trim().toLowerCase();
  if (!raw) return '';
  if (Object.prototype.hasOwnProperty.call(ALIASES, raw)) return ALIASES[raw];
  return raw;
}

/** 语言下拉的搜索：规范名或别名命中都算。 */
export function searchLanguages(query) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return CODE_LANGUAGES.slice();
  const aliases = Object.keys(ALIASES);
  return CODE_LANGUAGES.filter((name) => name.includes(q)
    || aliases.some((alias) => ALIASES[alias] === name && alias.includes(q)));
}

/** Typora 默认：代码自动缩进 2 个空格；手按 Tab 就是一个制表符。 */
export const INDENT_UNIT = '  ';
export const TAB_CHAR = '\t';

const set = (text) => new Set(text.trim().split(/\s+/).filter(Boolean));

const JS = set(`
  as async await break case catch class const continue debugger default delete do
  else export extends finally for from function get if import in instanceof let new
  of return set static super switch this throw try typeof var void while with yield
`);
const TS = set(`
  abstract any as asserts boolean declare enum implements infer interface is keyof
  namespace never number object private protected public readonly satisfies string
  symbol type undefined unknown
`);
const PY = set(`
  and as assert async await break class continue def del elif else except finally
  for from global if import in is lambda match nonlocal not or pass raise return
  try while with yield case
`);
const SHELL = set(`
  if then else elif fi for while until do done case esac function in select time
  coproc return break continue local export readonly declare unset shift source
  alias echo cd pwd exit set trap
`);
const C = set(`
  auto break case char const continue default do double else enum extern float for
  goto if inline int long register restrict return short signed sizeof static
  struct switch typedef union unsigned void volatile while
`);
const CPP = set(`
  alignas alignof and and_eq asm auto bitand bitor bool break case catch char
  char16_t char32_t class compl const constexpr const_cast continue decltype
  default delete do double dynamic_cast else enum explicit export extern false
  float for friend goto if inline int long mutable namespace new noexcept not
  not_eq nullptr operator or or_eq private protected public register
  reinterpret_cast return short signed sizeof static static_assert static_cast
  struct switch template this throw true try typedef typeid typename union
  unsigned using virtual void volatile wchar_t while xor xor_eq
`);
const JAVA = set(`
  abstract assert boolean break byte case catch char class const continue default
  do double else enum extends final finally float for goto if implements import
  instanceof int interface long native new package private protected public return
  short static strictfp super switch synchronized this throw throws transient try
  void volatile while var record sealed permits yield
`);
const CSHARP = set(`
  abstract as base bool break byte case catch char checked class const continue
  decimal default delegate do double else enum event explicit extern false finally
  fixed float for foreach goto if implicit in int interface internal is lock long
  namespace new null object operator out override params private protected public
  readonly ref return sbyte sealed short sizeof stackalloc static string struct
  switch this throw true try typeof uint ulong unchecked unsafe ushort using
  virtual void volatile while async await var record init
`);
const GO = set(`
  break case chan const continue default defer else fallthrough for func go goto
  if import interface map package range return select struct switch type var
`);
const RUST = set(`
  as async await break const continue crate dyn else enum extern false fn for if
  impl in let loop match mod move mut pub ref return self Self static struct super
  trait true type unsafe use where while
`);
const PHP = set(`
  abstract and array as break callable case catch class clone const continue
  declare default die do echo else elseif empty enddeclare endfor endforeach endif
  endswitch endwhile eval exit extends final finally fn for foreach function global
  goto if implements include include_once instanceof insteadof interface isset
  list match namespace new or print private protected public readonly require
  require_once return static switch throw trait try unset use var while xor yield
`);
const RUBY = set(`
  alias and begin break case class def defined do else elsif end ensure false for
  if in module next nil not or redo rescue retry return self super then true undef
  unless until when while yield require attr_accessor puts
`);
const SQL = set(`
  add all alter and any as asc backup between by case check column constraint
  create database default delete desc distinct drop exec exists foreign from full
  group having in index inner insert into is join key left like limit not null
  offset on or order outer primary procedure right rownum select set table top
  truncate union unique update values view where with
`);
const SWIFT = set(`
  associatedtype class deinit enum extension fileprivate func import init inout
  internal let open operator private protocol public rethrows static struct
  subscript typealias var break case continue default defer do else fallthrough
  for guard if in repeat return switch where while as Any catch false is nil super
  self Self throw throws true try
`);
const KOTLIN = set(`
  as break class continue do else false for fun if in interface is null object
  package return super this throw true try typealias typeof val var when while by
  catch constructor delegate dynamic field file finally get import init param
  property receiver set setparam where actual abstract annotation companion const
  crossinline data enum expect external final infix inline inner internal lateinit
  noinline open operator out override private protected public reified sealed
  suspend tailrec vararg
`);
const LUA = set(`
  and break do else elseif end false for function goto if in local nil not or
  repeat return then true until while
`);
const POWERSHELL = set(`
  begin break catch class continue data define do dynamicparam else elseif end
  enum exit filter finally for foreach from function if in param process return
  switch throw trap try until using var while workflow
`);

/** 通用扫描器用到的语言参数。 */
const SPECS = {
  javascript: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'", '`'], multiline: true, keywords: JS },
  typescript: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'", '`'], multiline: true, keywords: new Set([...JS, ...TS]) },
  jsx: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'", '`'], multiline: true, keywords: JS },
  python: { line: ['#'], quotes: ['"', "'"], triple: ['"""', "'''"], multiline: true, keywords: PY },
  shell: { line: ['#'], quotes: ['"', "'"], keywords: SHELL, dollarVars: true },
  c: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], keywords: C },
  'c++': { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], keywords: CPP },
  'c#': { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], keywords: CSHARP },
  java: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], keywords: JAVA },
  go: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'", '`'], multiline: true, keywords: GO },
  rust: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], keywords: RUST },
  php: { line: ['//', '#'], block: [['/*', '*/']], quotes: ['"', "'"], keywords: PHP, dollarVars: true },
  ruby: { line: ['#'], quotes: ['"', "'"], keywords: RUBY },
  swift: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], keywords: SWIFT },
  kotlin: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], keywords: KOTLIN },
  lua: { line: ['--'], block: [['--[[', ']]']], quotes: ['"', "'"], keywords: LUA },
  sql: { line: ['--'], block: [['/*', '*/']], quotes: ["'", '"'], keywords: SQL, caseInsensitive: true },
  powershell: { line: ['#'], block: [['<#', '#>']], quotes: ['"', "'"], keywords: POWERSHELL, dollarVars: true },
  css: { line: [], block: [['/*', '*/']], quotes: ['"', "'"], atRules: true, keyed: true },
  scss: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], atRules: true, keyed: true },
  less: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], atRules: true, keyed: true },
  stylus: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], atRules: true, keyed: true },
  toml: { line: ['#'], quotes: ['"', "'"], keyed: true },
  properties: { line: ['#', ';'], quotes: ['"', "'"], keyed: true },
  dockerfile: { line: ['#'], quotes: ['"', "'"] },
  makefile: { line: ['#'], quotes: ['"', "'"] },
  nginx: { line: ['#'], quotes: ['"', "'"], keyed: true },
  perl: { line: ['#'], quotes: ['"', "'"], keywords: set('my our local sub use package require if else elsif while for foreach return last next') },
  r: { line: ['#'], quotes: ['"', "'"], keywords: set('if else repeat while function for in next break return true false null na nan') },
  julia: { line: ['#'], quotes: ['"', "'"], keywords: set('function end if else elseif for while begin let return using import export struct mutable where do try catch finally') },
  dart: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], keywords: set('class const final var void if else for while return import export extends implements mixin with static async await new this super true false null') },
  scala: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], keywords: set('class object trait def val var if else for while match case return import package extends with new this super true false null') },
  erlang: { line: ['%'], quotes: ['"', "'"], keywords: set('after begin case catch cond end fun if let of query receive try when') },
  haskell: { line: ['--'], block: [['{-', '-}']], quotes: ['"', "'"], keywords: set('case class data default deriving do else if import in infix infixl infixr instance let module newtype of then type where') },
  elixir: { line: ['#'], quotes: ['"', "'"], keywords: set('def defp defmodule do end fn case cond if else unless for with when import alias require use true false nil') },
  clojure: { line: [';'], quotes: ['"'], keywords: set('def defn fn let if do loop recur when cond case ns require import true false nil') },
};
// 语法接近的语言直接复用同一套规则
SPECS['objective-c'] = SPECS.c;
SPECS.groovy = SPECS.java;
SPECS.d = SPECS.c;

const CONSTANTS = new Set([
  'true', 'false', 'null', 'undefined', 'none', 'nil', 'nan', 'infinity',
  'yes', 'no', 'on', 'off', 'self',
]);

const EMPTY_SPEC = { line: [], block: [], quotes: [] };

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function span(cls, text) {
  return `<span class="${cls}">${esc(text)}</span>`;
}

const ID_START = /[A-Za-z_$\u00C0-\uFFFF]/;
const ID_PART = /[A-Za-z0-9_$\u00C0-\uFFFF]/;
const NUMBER = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)/;

/** 通用语言扫描：注释、字符串、数字、标识符。 */
function scanGeneric(src, spec) {
  const kw = spec.keywords || null;
  const quotes = spec.quotes || [];
  const lineComments = spec.line || [];
  let out = '';
  let plain = '';
  let i = 0;
  const flush = () => {
    if (plain) { out += esc(plain); plain = ''; }
  };

  while (i < src.length) {
    const c = src[i];

    // 块注释
    let block = null;
    for (const pair of (spec.block || [])) {
      if (src.startsWith(pair[0], i)) { block = pair; break; }
    }
    if (block) {
      flush();
      const end = src.indexOf(block[1], i + block[0].length);
      const stop = end < 0 ? src.length : end + block[1].length;
      out += span('tok-com', src.slice(i, stop));
      i = stop;
      continue;
    }

    // Python 的三引号
    if (spec.triple) {
      const triple = spec.triple.find((q) => src.startsWith(q, i));
      if (triple) {
        flush();
        const end = src.indexOf(triple, i + triple.length);
        const stop = end < 0 ? src.length : end + triple.length;
        out += span('tok-str', src.slice(i, stop));
        i = stop;
        continue;
      }
    }

    // 行注释
    const lineComment = lineComments.find((p) => src.startsWith(p, i));
    if (lineComment) {
      flush();
      let end = src.indexOf('\n', i);
      if (end < 0) end = src.length;
      out += span('tok-com', src.slice(i, end));
      i = end;
      continue;
    }

    // 字符串
    if (quotes.includes(c)) {
      flush();
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) { j += 1; break; }
        if (!spec.multiline && src[j] === '\n') break;
        j += 1;
      }
      out += span('tok-str', src.slice(i, j));
      i = j;
      continue;
    }

    // CSS 之类的 @media / @import
    if (c === '@' && spec.atRules) {
      flush();
      let j = i + 1;
      while (j < src.length && /[A-Za-z-]/.test(src[j])) j += 1;
      out += span('tok-meta', src.slice(i, j));
      i = j;
      continue;
    }

    // 数字
    if (/[0-9]/.test(c) && !ID_PART.test(src[i - 1] || '')) {
      const m = NUMBER.exec(src.slice(i));
      if (m && m[0]) {
        flush();
        out += span('tok-num', m[0]);
        i += m[0].length;
        continue;
      }
    }

    // 标识符 / 关键字 / 函数
    if (ID_START.test(c)) {
      flush();
      let j = i + 1;
      while (j < src.length && ID_PART.test(src[j])) j += 1;
      const word = src.slice(i, j);
      const lower = word.toLowerCase();
      let cls = '';
      if (kw && kw.has(spec.caseInsensitive ? lower : word)) cls = 'tok-kw';
      else if (CONSTANTS.has(lower)) cls = 'tok-const';
      else if (spec.dollarVars && word[0] === '$' && word.length > 1) cls = 'tok-var';
      else if (/^[A-Z]/.test(word) && word.length > 1 && !/^[A-Z0-9_]+$/.test(word)) cls = 'tok-type';
      else if (/^\s*\(/.test(src.slice(j))) cls = 'tok-fn';
      else if (spec.keyed && /^\s*:/.test(src.slice(j))) cls = 'tok-key';
      if (cls) out += span(cls, word);
      else out += esc(word);
      i = j;
      continue;
    }

    plain += c;
    i += 1;
  }
  flush();
  return out;
}

/** JSON：键名、字符串、数字、布尔。 */
function scanJson(src) {
  let out = '';
  let plain = '';
  let i = 0;
  const flush = () => { if (plain) { out += esc(plain); plain = ''; } };
  while (i < src.length) {
    const c = src[i];
    if (c === '"') {
      flush();
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '"') { j += 1; break; }
        j += 1;
      }
      const text = src.slice(i, j);
      const after = src.slice(j);
      out += span(/^\s*:/.test(after) ? 'tok-key' : 'tok-str', text);
      i = j;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      flush();
      let end = src.indexOf('\n', i);
      if (end < 0) end = src.length;
      out += span('tok-com', src.slice(i, end));
      i = end;
      continue;
    }
    const m = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(src.slice(i));
    if (m && /[0-9-]/.test(c) && !ID_PART.test(src[i - 1] || '')) {
      flush();
      out += span('tok-num', m[0]);
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      flush();
      let j = i + 1;
      while (j < src.length && ID_PART.test(src[j])) j += 1;
      const word = src.slice(i, j);
      out += CONSTANTS.has(word.toLowerCase()) ? span('tok-const', word) : esc(word);
      i = j;
      continue;
    }
    plain += c;
    i += 1;
  }
  flush();
  return out;
}

/** HTML / XML / Vue / Svelte：标签名、属性名、属性值。 */
function scanMarkup(src) {
  let out = '';
  let plain = '';
  let i = 0;
  const flush = () => { if (plain) { out += esc(plain); plain = ''; } };
  while (i < src.length) {
    if (src.startsWith('<!--', i)) {
      flush();
      const end = src.indexOf('-->', i + 4);
      const stop = end < 0 ? src.length : end + 3;
      out += span('tok-com', src.slice(i, stop));
      i = stop;
      continue;
    }
    if (src[i] === '<') {
      flush();
      let j = i + 1;
      let quote = '';
      while (j < src.length) {
        const ch = src[j];
        if (quote) {
          if (ch === '\\') { j += 2; continue; }
          if (ch === quote) quote = '';
        } else if (ch === '"' || ch === "'") {
          quote = ch;
        } else if (ch === '>') {
          j += 1;
          break;
        }
        j += 1;
      }
      out += scanTag(src.slice(i, j));
      i = j;
      continue;
    }
    plain += src[i];
    i += 1;
  }
  flush();
  return out;
}

function scanTag(tag) {
  if (/^<[!?]/.test(tag)) return span('tok-meta', tag);
  const m = /^(<\/?)([A-Za-z][\w:.-]*)([\s\S]*?)(\/?>)$/.exec(tag);
  if (!m) return esc(tag);
  const [, open, name, attrs, close] = m;
  return esc(open) + span('tok-tag', name) + scanAttrs(attrs) + esc(close);
}

function scanAttrs(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) { out += text[i]; i += 1; continue; }
    const name = /^([^\s=/>]+)/.exec(text.slice(i));
    if (!name) { out += esc(text[i]); i += 1; continue; }
    out += span('tok-attr', name[1]);
    i += name[1].length;
    if (text[i] === '=') {
      out += '=';
      i += 1;
      const q = text[i];
      if (q === '"' || q === "'") {
        let j = i + 1;
        while (j < text.length && text[j] !== q) j += 1;
        if (j < text.length) j += 1;
        out += span('tok-str', text.slice(i, j));
        i = j;
      } else {
        const val = /^[^\s>]+/.exec(text.slice(i));
        if (val) { out += span('tok-str', val[0]); i += val[0].length; }
      }
    }
  }
  return out;
}

/** YAML：行首的 key、注释、值里的字符串 / 数字。 */
function scanYaml(src) {
  return src.split('\n').map((line) => {
    if (/^\s*#/.test(line)) return span('tok-com', line);
    const m = /^(\s*(?:-\s+)?)([^#:\n]+?)(\s*:)([\s\S]*)$/.exec(line);
    if (!m) return scanGeneric(line, { line: ['#'], quotes: ['"', "'"] });
    return esc(m[1]) + span('tok-key', m[2]) + esc(m[3])
      + scanGeneric(m[4], { line: ['#'], quotes: ['"', "'"] });
  }).join('\n');
}

/** diff：增行、删行、hunk。 */
function scanDiff(src) {
  return src.split('\n').map((line) => {
    if (line.startsWith('@@')) return span('tok-meta', line);
    if (line.startsWith('+')) return span('tok-add', line);
    if (line.startsWith('-')) return span('tok-del', line);
    return esc(line);
  }).join('\n');
}

/** 源码 → 带 <span class="tok-..."> 的 HTML。所有字符都保留。 */
export function highlight(code, lang) {
  const src = String(code == null ? '' : code);
  const key = normalizeLang(lang);
  if (!key) return esc(src);
  if (key === 'json') return scanJson(src);
  if (['html', 'xml', 'vue', 'svelte', 'dtd', 'jsp', 'asp'].includes(key)) return scanMarkup(src);
  if (key === 'yaml') return scanYaml(src);
  if (key === 'diff') return scanDiff(src);
  if (key === 'markdown' || key === 'gfm' || key === 'rst' || key === 'http' || key === 'mbox') return esc(src);
  const spec = SPECS[key];
  if (!spec) return esc(src);
  return scanGeneric(src, spec);
}

/** 从代码内容猜语言。只在有把握时返回规范语言名，否则返回空字符串。
 *  识别不了不写围栏，用户仍可手动选语言。 */
export function detectLanguage(code) {
  const src = String(code == null ? '' : code).replace(/\r\n?/g, '\n').trim();
  if (src.length < 3) return '';
  const s = src.slice(0, 20000);

  // 脚本头 / 标记性开头
  const shebang = /^#!\s*([^\n]+)/.exec(s);
  if (shebang) {
    const cmd = shebang[1].toLowerCase();
    if (/(python|pypy)/.test(cmd)) return 'python';
    if (/(node|deno|bun)/.test(cmd)) return 'javascript';
    if (/(bash|zsh|fish|\bsh\b)/.test(cmd)) return 'shell';
    if (/ruby/.test(cmd)) return 'ruby';
    if (/perl/.test(cmd)) return 'perl';
    if (/php/.test(cmd)) return 'php';
  }
  if (/^<\?php\b|<\?=/.test(s)) return 'php';
  if (/^<\?xml\b/.test(s)) return 'xml';
  if (/(^|\n)\s*<!doctype\s+html|(^|\n)\s*<html[\s>]/i.test(s)) return 'html';
  if (/^<svg[\s>]/i.test(s)) return 'xml';

  // JSON 先试严格解析，避免把 JS 对象认成 JSON
  if (/^[\[{]/.test(s) && /[\]}]\s*$/.test(s)) {
    try {
      const value = JSON.parse(s);
      if (value && typeof value === 'object') return 'json';
    } catch (_e) { /* 不是 JSON */ }
  }

  if (/^@@ .+ @@/m.test(s) && /^[+-][^+-]/m.test(s)) return 'diff';

  if (/^FROM\s+\S+/m.test(s)
    && /^(RUN|COPY|ADD|CMD|ENTRYPOINT|WORKDIR|EXPOSE|ENV|ARG|VOLUME)\b/m.test(s)) return 'dockerfile';

  if (/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i.test(s)
    && /\b(FROM|WHERE|VALUES|SET|JOIN|GROUP\s+BY|ORDER\s+BY|INTO)\b/i.test(s)) return 'sql';

  // Python：缩进块 + def/import/self 这些强特征
  const pySignals = [
    /^\s*(def|class)\s+[A-Za-z_]\w*.*:\s*$/m,
    /^\s*(from\s+\S+\s+import|import\s+\S+)/m,
    /^\s*(if|elif|for|while|try|except|finally|with)\b.*:\s*$/m,
    /\bself\./,
    /^\s*if\s+__name__\s*==/m,
    /\bprint\s*\(/,
  ].filter((re) => re.test(s)).length;
  if (pySignals >= 2) return 'python';
  if (/^\s*(def|class)\s+[A-Za-z_]\w*.*:\s*$/m.test(s)) return 'python';
  if (/^\s*from\s+\S+\s+import\b/m.test(s)) return 'python';
  if (/^\s*import\s+[A-Za-z_][\w.]*(\s+as\s+\w+)?\s*$/m.test(s)
    && !/\bfrom\s+['"]/.test(s)) return 'python';
  if (pySignals >= 1 && /\b(None|True|False)\b/.test(s) && /:\s*$/m.test(s)) return 'python';

  // C++ 的 `public:` + 下一行 `void` 很容易被 TS 的 `: void` 类型标注抢走
  if (/\bstd::|\bcout\b|\bcin\b|#include\s*<iostream>|\bnullptr\b|\btemplate\s*</.test(s)
    || /\bvirtual\s+[\w:<>,*&\s]+\w+\s*\(/.test(s)
    || /\bclass\s+\w+[\s\S]*?\b(?:public|private|protected)\s*:/.test(s)) return 'c++';

  // YAML 的 key: value 也可能撞上 TS 的 `: string`，先看有没有成片的 key
  const yamlPairs = s.split('\n').filter((line) => /^\s*[A-Za-z0-9_.-]+\s*:\s*\S/.test(line)).length;
  if (yamlPairs >= 2 && !/[{};]/.test(s.replace(/#.*/g, ''))
    && !/^\s*(def|class)\s/m.test(s)) return 'yaml';

  // TypeScript 的 interface / 类型标注要抢在 CSS 前面：`interface X { a: string; }`
  // 的形状和一条 CSS 规则很像。C# / Java 的 interface 走下面的专用分支。
  if (!/\b(using\s+System|Console\.|public\s+(class|interface)|System\.out|package\s+java)\b/.test(s)
    && !/\b(fun|func)\s+\w+/.test(s)
    && (/\b(interface|type)\s+[A-Z]\w*\s*(=|\{)/.test(s)
      || /:\s*(string|number|boolean|any|void|unknown|never)\b/.test(s))) return 'typescript';

  const looksCss = /(^|\n)\s*[.#]?[A-Za-z][\w-]*(?:[\s>+~]+[.#]?[\w-]+)*\s*\{[^}]*:[^}]*;[^}]*\}/.test(s)
    || /@(media|import|keyframes|font-face|supports)\b/.test(s)
    || /(^|\n)\s*--[\w-]+\s*:/.test(s);
  if (looksCss && !/\b(function|const|let|var|class|def|return)\b/.test(s)) return 'css';

  // HTML 标签（JSX 带 const/function 的不算，留给下面 JS 家族）
  if (/(^|\n)\s*<([a-z][\w:-]*)(\s[^>]*)?>[\s\S]*?<\/\2>/i.test(s)
    && !/\b(const|let|var|function|class|def)\b/.test(s)) return 'html';

  // Rust 的 let mut / println! 要抢在 JS 的 let 前面
  if (/\bfn\s+main\s*\(|\blet\s+mut\b|\bprintln!\s*\(|^\s*use\s+std::/m.test(s)) return 'rust';
  // Kotlin / Swift / Go 的 fun(c) 也可能带 let/val，同样先于 JS 判断
  if (/^\s*fun\s+\w+/m.test(s)) return 'kotlin';
  if (/\bfunc\s+\w+\s*\(/.test(s)
    && /\b(let|var|guard\s+let|if\s+let)\b/.test(s)) return 'swift';
  if (/^\s*package\s+\w+/m.test(s) && /\bfunc\s+/.test(s)) return 'go';

  // JS / TS / JSX
  const jsSignals = [
    /\b(const|let|var)\s+[A-Za-z_$]/,
    /\bfunction\s+[A-Za-z_$]*\s*\(/,
    /=>/,
    /\b(console\.(log|error|warn)|document\.|window\.)/,
    /\b(require\s*\(|module\.exports)/,
    /\bexport\s+(default|const|function|class)\b/,
    /\bimport\s+.*\bfrom\s+['"]/,
    /\b(async|await)\b/,
  ].filter((re) => re.test(s)).length;
  const jsx = jsSignals >= 1
    && /<[A-Za-z][\w.:-]*(\s[^>]*)?(\/>|>[\s\S]*?<\/[A-Za-z][\w.:-]*>)/.test(s);
  const ts = /\b(interface|type)\s+[A-Z]\w*\s*(=|\{)/.test(s)
    || /:\s*(string|number|boolean|any|void|unknown|never)\b/.test(s)
    || /\b(enum|implements|declare|namespace)\b/.test(s)
    || /<[A-Z]\w*(,\s*[A-Z]\w*)*>/.test(s);
  if (jsSignals >= 1) {
    if (jsx) return 'jsx';
    if (ts) return 'typescript';
    return 'javascript';
  }

  // JVM / .NET / 苹果系
  if (/\bpublic\s+static\s+void\s+main\b|\bSystem\.out\.print|\bpublic\s+(final\s+)?class\b/.test(s)
    || /^\s*(package|import)\s+java\./m.test(s)) return 'java';
  if (/\busing\s+System(\.\w+)*\s*;|\bConsole\.(Write|Read)/.test(s)
    || /^\s*namespace\s+[\w.]+/m.test(s)) return 'c#';
  if (/#import\s*<(Foundation|UIKit)\/|@(interface|implementation|property|end)\b/.test(s)) return 'objective-c';

  // C / C++
  if (/\bstd::|\bcout\b|\bcin\b|#include\s*<iostream>|\bnullptr\b|\btemplate\s*</.test(s)
    || /\bvirtual\s+[\w:<>,*&\s]+\w+\s*\(/.test(s)
    || /\bclass\s+\w+[\s\S]*?\b(?:public|private|protected)\s*:/.test(s)) return 'c++';
  if (/#include\s*[<"]|\bint\s+main\s*\(|\bprintf\s*\(/.test(s)) return 'c';
  if (/\b(const\s+)?(int|char|float|double|long|short|unsigned)\s+\w+\s*[=;]/m.test(s)
    && !/\b(let|var|function)\b/.test(s)) return 'c';

  // 系统 / 脚本语言
  if (/^\s*package\s+\w+/m.test(s) && /\bfunc\s+/.test(s)) return 'go';
  if (/\bfn\s+main\s*\(|\blet\s+mut\b|\bprintln!\s*\(|^\s*use\s+std::/m.test(s)) return 'rust';
  if (/^\s*fun\s+\w+/m.test(s) || (/^\s*import\s+kotlin\./m.test(s) && /\b(val|var)\s+/.test(s))) return 'kotlin';
  if (/^\s*import\s+(UIKit|Foundation|SwiftUI)\b/m.test(s)
    || (/\bfunc\s+\w+/m.test(s) && (/\b(guard\s+let|if\s+let)\b/.test(s) || /\b(let|var)\b/.test(s)))) return 'swift';
  if (/^\s*def\s+[A-Za-z_]\w*[?!]?\s*(\(|$)/m.test(s) && /^\s*end\s*$/m.test(s)) return 'ruby';
  if (/\$[A-Za-z_]\w*\s*=/.test(s) && /(function\s+\w+|echo\s+|->)/.test(s)) return 'php';
  if (/\b(Write-Host|Get-ChildItem|Get-Item|Set-Item|New-Item)\b/.test(s)
    || /^\s*param\s*\(/m.test(s)) return 'powershell';
  if (/^\s*(fi|done|esac)\s*$/m.test(s)
    || (/^\s*(echo|export|cd|chmod|sudo|grep|sed|awk|mkdir|rm|cp|mv)\b/m.test(s) && /\$\w+|\|\s*\w+/.test(s))
    || (/^\s*for\s+\w+\s+in\b/m.test(s) && /^\s*done\s*$/m.test(s))) return 'shell';
  if (/^\s*local\s+\w+/m.test(s) && /\bend\b/.test(s)) return 'lua';
  if (/^\s*function\s+\w+\s*\(/m.test(s) && /\bend\b/.test(s)) return 'lua';
  if (/<-\s*/.test(s)) return 'r';
  if (/^\s*void\s+main\s*\(/m.test(s) && /\bprint\s*\(/.test(s)) return 'dart';
  if (/^\s*use\s+(strict|warnings)\b/m.test(s) && /\bmy\s+[$@%]/.test(s)) return 'perl';
  if (/^\s*object\s+[A-Z]\w*\s*\{/m.test(s) || /\bcase\s+class\b/.test(s)) return 'scala';
  if (/^\s*main\s*::\s*IO/m.test(s) || /^\s*module\s+[A-Z][\w.]*\s+where/m.test(s)) return 'haskell';
  if (/^\s*defmodule\s+[A-Z]/m.test(s) || /^\s*defp\s+\w+/m.test(s)) return 'elixir';
  if (/^-module\(/m.test(s) && /^-export\(/m.test(s)) return 'erlang';
  if (/\(defn?\s+/.test(s) && /\(ns\s+/.test(s)) return 'clojure';
  if (/^\s*import\s+['"]package:/m.test(s) || /\b(StatelessWidget|StatefulWidget)\b/.test(s)) return 'dart';
  if (/^\s*\.(text|data|bss)\b/m.test(s) && /^\s*(mov|push|pop|call|ret|add|sub)\s+/m.test(s)) return 'assembly';

  // 配置类
  if (/^\s*\[[\w.-]+\]\s*$/m.test(s) && /^\s*[\w.-]+\s*=\s*.+$/m.test(s)) return 'toml';
  const yamlLines = s.split('\n').filter((line) => /^\s*[A-Za-z0-9_.-]+\s*:\s*\S/.test(line) || /^\s*-\s+\S/.test(line)).length;
  if (yamlLines >= 2 && !/[{};]/.test(s.replace(/#.*/g, ''))) return 'yaml';
  if (/^\s*\[[\w.-]+\]\s*$/m.test(s) && /^\s*[\w.-]+\s*=/.test(s)) return 'properties';

  return '';
}

/** 块里最长的一行以反引号开头时，需要更长的围栏才不会提前闭合。 */
export function fenceFor(src, lang) {
  const body = String(src == null ? '' : src);
  let max = 0;
  for (const line of body.split('\n')) {
    const m = /^`{3,}/.exec(line.replace(/^\s+/, ''));
    if (m) max = Math.max(max, m[0].length);
  }
  const fence = '`'.repeat(Math.max(3, max + 1));
  // 反引号 / 换行会把围栏本身解析坏；中间的空格是合法的 info string，保留
  const info = String(lang == null ? '' : lang).replace(/[`\r\n]+/g, '').trim();
  return fence + info;
}
