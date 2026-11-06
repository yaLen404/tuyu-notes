/** 右栏：标题 / 富文本块编辑 / 预览 / 连接区。
 *
 * 编辑模型（Notion 式）：
 *   - 正文按 markdown 块切分，每段一块，**单击就能在那一块里落光标**；
 *   - 块里显示的是排版后的样子（粗体就是粗体），一边打一边生效；
 *   - 代码 / 公式 / 表格 / 分割线是"源码块"，点开才用输入框改它的原文；
 *   - 源码仍然是同一个 markdown 字符串（note.content），块只是它的视图，
 *     所以画板卡片、双链、自动保存都不受影响。
 */

import {
  parseBlocks, blockToLines, blockToHtml, htmlToInline, escapeHtml,
} from './markdown.js';
import {
  INDENT_UNIT, TAB_CHAR, detectLanguage, highlight, normalizeLang, searchLanguages,
} from './code.js';

/** 这些块没有富文本编辑，点开是改源码。代码块单独走"原地编辑"，不在这里。 */
const SOURCE_BLOCKS = ['math', 'table', 'hr'];

/** 停手多久后自动猜代码语言 */
const AUTO_LANG_DELAY = 650;

/** 连续打字合并成一个撤销步骤的时间窗（越小撤销越细） */
const HISTORY_MERGE_MS = 300;

export class NotePane {
  constructor(dom, ws, hooks = {}) {
    this.ws = ws;
    this.hooks = hooks;
    this.dom = dom;
    this.note = null;
    this.scale = 1;
    this._titleTimer = null;

    this._blocks = [];        // parseBlocks() 的结果
    this._focus = null;       // 光标所在的富文本块下标
    this._sel = new Set();    // 多选的块下标（Shift / Ctrl 点出来）
    this._sourceIndex = null; // 正在改源码的块下标（公式/表格/分割线）
    this._lastEdit = 0;       // 上次编辑过的块下标
    this._langMenu = null;    // 代码块的语言下拉
    this._langAnchor = null;  // 下拉挂在哪个语言框上
    this._langIndex = -1;     // 语言下拉里高亮的那一项
    this._langFiltered = [];
    this._langCaret = null;   // 改语言前代码块里的光标，选完语言要还回去
    this._autoLangTimers = new Map();   // 代码块自动识别语言的定时器
    this._windowBlurred = false;

    dom.title.addEventListener('input', () => this.onTitleInput());
    dom.title.addEventListener('blur', () => this.commitTitle());
    dom.title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // 回车是"我改完了"：标题空着就把原标题找回来
        this.commitTitle({ force: true });
        this.focusBlock(this._lastEdit || 0, 'end');
      }
    });

    // 块区：编辑相关的输入事件都委托到 #preview（块元素会被反复重建）
    this._closeMenuOnOutside = (ev) => {
      // 子菜单是独立的 DOM，点在它里面也算"菜单内"，否则按下就被关掉、click 永远到不了
      const inMenu = this._menuEl && this._menuEl.contains(ev.target);
      const inSub = this._subEl && this._subEl.contains(ev.target);
      if (!inMenu && !inSub) this.closeBlockMenu();
    };
    dom.preview.addEventListener('click', (e) => this.onBlockClick(e));
    dom.preview.addEventListener('focusin', (e) => this.onPreviewFocusIn(e));
    dom.preview.addEventListener('focusout', (e) => this.onPreviewFocusOut(e));
    dom.preview.addEventListener('input', (e) => this.onPreviewInput(e));
    dom.preview.addEventListener('keydown', (e) => this.onPreviewKey(e));
    dom.preview.addEventListener('contextmenu', (e) => this.onPreviewContextMenu(e));
    dom.preview.addEventListener('paste', (e) => this.onPreviewPaste(e));
    dom.preview.addEventListener('dragover', (e) => this.onPreviewDragOver(e));
    dom.preview.addEventListener('drop', (e) => this.onPreviewDrop(e));
    // 代码块的高亮层要和输入框一起横向滚动（scroll 不冒泡，只能在捕获阶段听）
    dom.preview.addEventListener('scroll', (e) => this.onCodeScroll(e), true);
    // 中文输入法组合期间不能重画高亮，否则候选字会闪
    dom.preview.addEventListener('compositionstart', (e) => this.onCodeComposition(e, true), true);
    dom.preview.addEventListener('compositionend', (e) => this.onCodeComposition(e, false), true);
    // 源码块（公式/表格）的输入框：blur 不冒泡，只能在捕获阶段听
    dom.preview.addEventListener('blur', (e) => {
      if (e.target && e.target.classList && e.target.classList.contains('blk-editor')) this.commitSource();
    }, true);

    if (dom.chips) dom.chips.addEventListener('click', (e) => this.onChipClick(e));

    // 光标离开笔记（点画布、点别的笔记、切窗口）→ 把正在改的源码块提交掉
    // 右栏宽度变了（拖分栏 / 拉窗口）：重新量代码块高度，别把最后一行切掉
    if (typeof ResizeObserver !== 'undefined') {
      this._codeRO = new ResizeObserver(() => {
        if (!this.note) return;
        for (let i = 0; i < this._blocks.length; i += 1) {
          if (this._blocks[i].type !== 'code') continue;
          const ta = this.codeInput(i);
          if (ta) {
            this.syncCodeHeight(ta);
            this.syncCodeScroll(ta);
          }
        }
      });
      this._codeRO.observe(dom.preview);
    }

    document.addEventListener('pointerdown', (e) => {
      const target = e.target;
      const outside = target && this.dom.preview && !this.dom.preview.contains(target);
      const menu = target && target.closest
        && (target.closest('.blk-menu') || target.closest('.code-lang-menu'));
      if (outside && !menu) {
        this.markCurrent(null);
        this.scheduleLeave(true);
      } else {
        if (!outside) this._windowBlurred = false;
        this.scheduleLeave();
      }
    }, true);
    document.addEventListener('selectionchange', () => this.paintCurrentBlock());
    document.addEventListener('focusin', (e) => {
      if (e.target && this.dom.root && !this.dom.root.contains(e.target)) this.scheduleLeave();
    });
    window.addEventListener('blur', () => {
      // 整个窗口失焦时 activeElement 还会停在 preview 里，必须主动收掉编辑底色
      this._windowBlurred = true;
      this.markCurrent(null);
      this.scheduleLeave(true);
    });
    window.addEventListener('focus', () => { this._windowBlurred = false; });
  }

  /** 焦点离开笔记区 → 提交源码块，并收掉块的编辑底色。force 用于窗口失焦。 */
  scheduleLeave(force = false) {
    clearTimeout(this._leaveTimer);
    this._leaveTimer = setTimeout(() => {
      if (!this.note) return;
      const active = document.activeElement;
      const inPreview = active && this.dom.preview && this.dom.preview.contains(active);
      // 还在块里（包括语言框 / 源码框）就不要把菜单收掉；force 是窗口失焦
      if (inPreview && !force) return;
      // 点标题 / 搜索 / 画布 / 别的笔记都算离开块编辑
      if (!inPreview) this.markCurrent(null);
      this.commitLangIfNeeded();
      this.commitSource();
      this.closeLangMenu();
    }, 0);
  }

  // ---------------------------------------------------------------- 显示
  show(note, mode) {
    this.clearAutoLangTimers();
    this.commitLangIfNeeded();                // 语言框里刚打的字别丢
    this.commitSource();                      // 先把上一篇里正在编辑的源码块提交掉
    this.closeLangMenu();
    this._langCaret = null;
    this.writeBack();
    this.note = note || null;
    this._focus = null;
    this._lastEdit = 0;
    // 换笔记就换一套撤销历史
    this._history = [];
    this._future = [];
    this._lastPush = 0;

    this.dom.empty.hidden = Boolean(note);
    this.dom.preview.hidden = !note;
    if (!note) {
      this.dom.title.value = '';
      this.dom.preview.innerHTML = '';
      this._blocks = [];
      this.dom.accent.style.background = 'var(--line)';
      this.renderMeta();
      return;
    }
    this.dom.title.value = note.title || '';
    this.dom.accent.style.background = note.color || 'var(--line)';
    this.renderBlocks({ restoreFocus: false });
    this.markTopHeading();
    this.renderMeta();
  }

  /** 兼容旧调用：现在没有"编辑 / 预览"两种状态了，笔记一直是可编辑的 */
  setMode() {}
  toggleMode() {}

  // ---------------------------------------------------------------- 块渲染
  /** 把 note.content 切成块并渲染。每块都是可直接打字的富文本块。 */
  renderBlocks(opts = {}) {
    const note = this.note;
    this._sourceIndex = null;
    this._curEl = null;
    this.clearAutoLangTimers();
    this.commitLangIfNeeded();
    this.closeLangMenu();
    this._langCaret = null;
    if (!note) {
      this._blocks = [];
      this.dom.preview.innerHTML = '';
      return;
    }
    const exists = (t) => Boolean(this.ws.findTitle(t, note.graph));
    let blocks = parseBlocks(note.content || '');
    if (!blocks.length) blocks = [{ type: 'empty', start: 0, end: 0, inline: '' }];
    // 重排前记住代码块里的光标：撤销 / 改块类型之后不把用户扔到别处。
    // 切笔记时不要恢复（否则会跑到新笔记同下标的代码块里）。
    const active = document.activeElement;
    const keep = opts.restoreFocus !== false
      && active && active.classList && active.classList.contains('code-input')
      ? {
        index: Number(active.closest('.blk').dataset.i),
        start: active.selectionStart,
        end: active.selectionEnd,
        left: active.scrollLeft,
      }
      : null;
    const scrollTop = this.dom.preview.scrollTop;
    this._blocks = blocks;
    this.renumber();
    const editable = true;
    const body = blocks.map((b, i) => this.blockHtml(b, i, editable, exists)).join('');
    this.dom.preview.innerHTML = body;
    this.syncScale();
    this.initCodeEditors();
    this.markTopHeading();
    this.dom.preview.scrollTop = scrollTop;
    if (keep && this._blocks[keep.index] && this._blocks[keep.index].type === 'code') {
      const ta = this.codeInput(keep.index);
      if (ta) {
        ta.focus();
        ta.setSelectionRange(keep.start, keep.end);
        ta.scrollLeft = keep.left;
        this.syncCodeScroll(ta);
      }
    }
  }

  /** 找出第一个有内容的块；如果它是标题，就把前面的空块收掉、标题贴顶 */
  markTopHeading() {
    const els = [...this.dom.preview.querySelectorAll(':scope > .blk')];
    for (const el of els) el.classList.remove('blk-leading-empty', 'blk-top-heading');
    const hasContent = (el) => {
      const txt = el.querySelector('.blk-txt');
      if (txt) return txt.textContent.trim() !== '' || Boolean(txt.querySelector('img'));
      if (el.dataset.kind === 'code') {
        const ta = el.querySelector('.code-input');
        return Boolean(ta && ta.value.trim());
      }
      return el.textContent.trim() !== '';
    };
    const first = els.findIndex(hasContent);
    if (first < 0) return;
    // 正在编辑的前置空块不能藏起来，否则在标题前回车后看不到新行
    const focusIndex = this._focus;
    const focusEmpty = focusIndex != null && focusIndex >= 0 && focusIndex < first
      && els[focusIndex] && !hasContent(els[focusIndex]);
    for (let i = 0; i < first; i += 1) {
      if (!hasContent(els[i]) && (!focusEmpty || i !== focusIndex)) {
        els[i].classList.add('blk-leading-empty');
      }
    }
    if (focusEmpty) return;
    const el = els[first];
    if (el.matches('.blk-h1, .blk-h2, .blk-h3')) el.classList.add('blk-top-heading');
  }

  /** 连续的有序列表块自己编号，插一块删一块都会自动重排 */
  renumber() {
    let run = 0;
    for (const b of this._blocks) {
      if (b.type === 'num') { run += 1; b._num = run; } else { run = 0; }
    }
  }

  blockHtml(block, i, editable, exists) {
    const cls = ['blk', 'blk-' + block.type];
    // 空笔记（只有一块空的）才给占位提示，正文里的空块保持干净
    if (block.type === 'empty' && this._blocks.length === 1) cls.push('is-only');
    if (this._sel && this._sel.has(i)) cls.push('sel');
    const pad = block.depth ? ` style="margin-left:${block.depth * 20}px"` : '';
    if (block.type === 'code') {
      return `<div class="${cls.join(' ')}" data-i="${i}" data-kind="code" data-lang="${escapeHtml(block.lang || '')}"${pad}>`
        + this.codeEditorHtml() + '</div>';
    }
    if (SOURCE_BLOCKS.includes(block.type)) {
      return `<div class="${cls.join(' ')}" data-i="${i}" data-kind="source"${pad}>`
        + blockToHtml(block, exists) + '</div>';
    }
    let marker = '';
    if (block.type === 'task') {
      marker = `<button class="blk-check${block.done ? ' done' : ''}" type="button" data-i="${i}"`
        + ` contenteditable="false" title="勾选">${block.done ? '✓' : ''}</button>`;
    } else if (block.type === 'bullet') {
      marker = '<span class="blk-dot" contenteditable="false">•</span>';
    } else if (block.type === 'num') {
      marker = `<span class="blk-mark-num" contenteditable="false">${block._num || 1}.</span>`;
    }
    const ce = '';   // 单宿主：可编辑性在 #preview 上，块内不再嵌套 contenteditable
    return `<div class="${cls.join(' ')}" data-i="${i}" data-kind="inline"${pad}>`
      + marker
      + `<div class="blk-txt"${ce}>${blockToHtml(block, exists)}</div></div>`;
  }

  /** 代码块：高亮层垫底 + 透明文字的 textarea 在上，看起来是"直接在代码上打字" */
  codeEditorHtml() {
    return '<div class="code-box">'
      + '<div class="code-gutter" aria-hidden="true" contenteditable="false"></div>'
      + '<div class="code-main">'
      + '<pre class="code-hl" aria-hidden="true"><code></code></pre>'
      + '<textarea class="code-input" wrap="off" spellcheck="false" autocapitalize="off"'
      + ' autocomplete="off" autocorrect="off" aria-label="代码"></textarea>'
      + '</div></div>'
      + '<div class="code-foot"><input class="code-lang" type="text" spellcheck="false"'
      + ' autocomplete="off" placeholder="纯文本" title="代码语言" aria-label="代码语言"></div>';
  }

  codeInput(index) {
    const el = this.blkEl(index);
    return el ? el.querySelector('.code-input') : null;
  }

  codeIndex(ta) {
    const el = ta && ta.closest ? ta.closest('.blk') : null;
    return el ? Number(el.dataset.i) : -1;
  }

  /** 渲染完后把每块代码的文本 / 语言 / 行号 / 高亮补上（textarea 的 value 只能这样设，才不丢开头空行） */
  initCodeEditors() {
    for (const el of this.dom.preview.querySelectorAll('.blk-code')) {
      el.addEventListener('pointermove', (e) => this.onCodePointerMove(e, el));
      el.addEventListener('pointerleave', () => el.classList.remove('lang-near'));
      const index = Number(el.dataset.i);
      const blk = this._blocks[index];
      if (!blk || blk.type !== 'code') continue;
      const ta = el.querySelector('.code-input');
      const lang = el.querySelector('.code-lang');
      if (ta) {
        ta.value = blk.src || '';
        if (!ta._scrollBound) {
          ta.addEventListener('scroll', () => this.syncCodeScroll(ta));
          ta._scrollBound = true;
        }
        if (!ta._codeBound) {
          ta._codeBound = true;
          const mark = () => {
            const own = ta.closest('.blk');
            if (!own) return;
            this._focus = Number(own.dataset.i);
            this._lastEdit = this._focus;
            this.markCurrent(own);
            const blk = this._blocks[this._focus];
            if (blk && blk.type === 'code' && !blk.lang && !blk.langTouched) {
              this.scheduleAutoLanguage(this._focus);
            }
          };
          ta.addEventListener('pointerdown', mark);
          ta.addEventListener('focus', mark);
        }
      }
      if (lang) {
        lang.value = blk.lang || '';
        if (!lang._langBound) {
          lang._langBound = true;
          // 这个输入框在 contenteditable 里，Chromium 不一定会派发 focus，
          // 所以鼠标按下时也主动开一次（onLangFocus 内部会去重）
          lang.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0) return;
            const own = lang.closest('.blk');
            if (own) this.onLangFocus(own, lang);
          });
          lang.addEventListener('focus', () => {
            const own = lang.closest('.blk');
            if (own) this.onLangFocus(own, lang);
          });
          lang.addEventListener('blur', () => {
            const own = lang.closest('.blk');
            if (own) this.onLangBlur(Number(own.dataset.i), lang);
          });
        }
      }
      this.refreshCode(index);
    }
  }

  /** 刷新代码块的行号、高亮、高度和横向滚动位置。不重排整个笔记。 */
  refreshCode(index, opts = {}) {
    const el = this.blkEl(index);
    const blk = this._blocks[index];
    if (!el || !blk || blk.type !== 'code') return;
    const ta = el.querySelector('.code-input');
    if (!ta) return;
    if (opts.read) blk.src = ta.value.replace(/\r\n?/g, '\n');
    const src = blk.src || '';
    const lang = blk.lang || '';
    el.dataset.lang = lang;

    const code = el.querySelector('.code-hl code');
    if (code) {
      try { code.innerHTML = highlight(src, lang); }
      catch (_e) { code.textContent = src; }   // 着色失败也要让代码看得见
    }

    this.updateGutter(el, src);

    const langInput = el.querySelector('.code-lang');
    if (langInput) {
      if (document.activeElement !== langInput) langInput.value = lang;
      langInput.title = lang
        ? (blk.langAuto ? '自动识别：' + lang + '（可点开修改）' : lang)
        : '代码语言';
    }

    this.syncCodeHeight(ta);
    this.syncCodeScroll(ta, el);
  }

  /** 行号只在行数变化时重画，打字时不反复造几百个 div */
  updateGutter(el, src) {
    const gutter = el && el.querySelector('.code-gutter');
    if (!gutter) return;
    const count = src ? src.split('\n').length : 1;
    if (gutter.dataset.count === String(count)) return;
    gutter.dataset.count = String(count);
    let html = '';
    for (let n = 1; n <= count; n += 1) html += `<div>${n}</div>`;
    gutter.innerHTML = html;
  }

  syncCodeHeight(ta) {
    ta.style.height = 'auto';
    const h = ta.scrollHeight;
    if (h > 0) ta.style.height = `${h}px`;
  }

  syncCodeScroll(ta, el = ta && ta.closest('.blk-code')) {
    if (!el) return;
    const pre = el.querySelector('.code-hl');
    if (pre) pre.style.transform = `translateX(${-ta.scrollLeft}px)`;
  }

  onCodeScroll(e) {
    const ta = e.target;
    if (!ta || !ta.classList || !ta.classList.contains('code-input')) return;
    this.syncCodeScroll(ta);
  }

  /** 编辑代码时语言框平时隐身；鼠标靠近右下角这一小块再露出来 */
  onCodePointerMove(e, el) {
    const box = el.querySelector('.code-box');
    if (!box) return;
    const r = box.getBoundingClientRect();
    const near = e.clientX >= r.right - 180 && e.clientY >= r.bottom - 36;
    el.classList.toggle('lang-near', near);
  }

  onCodeComposition(e, active) {
    const ta = e.target;
    if (!ta || !ta.classList || !ta.classList.contains('code-input')) return;
    const el = ta.closest('.blk-code');
    if (!el) return;
    el.classList.toggle('composing', active);
    if (!active) {
      const index = this.codeIndex(ta);
      this.refreshCode(index, { read: true });
      this.scheduleAutoLanguage(index);
    }
  }

  /** 代码块里每次输入：写回数据、刷新行号/高亮，不重排 DOM，光标不跳 */
  onCodeInput(ta) {
    const index = this.codeIndex(ta);
    const blk = this._blocks[index];
    if (!blk || blk.type !== 'code') return;
    blk.src = ta.value.replace(/\r\n?/g, '\n');
    const el = ta.closest('.blk-code');
    if (el && el.classList.contains('composing')) {
      // 组合期间只更新行号和高度，别动高亮层
      this.updateGutter(el, blk.src);
      this.syncCodeHeight(ta);
      this.syncCodeScroll(ta, el);
    } else {
      this.refreshCode(index);
    }
    this.writeBack();
    if (!el || !el.classList.contains('composing')) this.scheduleAutoLanguage(index);
  }

  blkEl(index) {
    return this.dom.preview.querySelector(`.blk[data-i="${index}"]`);
  }

  editableEl(index) {
    const el = this.blkEl(index);
    return el ? el.querySelector('.blk-txt') : null;
  }

  /** 当前选区落在哪一块（代码块是独立输入框，先看 activeElement） */
  currentBlockEl() {
    const active = document.activeElement;
    if (active && active.closest && this.dom.preview.contains(active)) {
      const own = active.closest('.blk');
      if (own) return own.querySelector('.blk-txt') || own;
    }
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return null;
    const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    const blk = node && node.closest ? node.closest('.blk') : null;
    if (!blk) return null;
    return blk.querySelector('.blk-txt') || blk;
  }

  currentIndex() {
    const el = this.currentBlockEl();
    const blk = el && el.closest ? el.closest('.blk') : null;
    if (blk) return Number(blk.dataset.i);
    return this._focus == null ? 0 : this._focus;
  }

  /** 空白点击的纵向位置落在哪一块上（用于左右留白） */
  blockAtY(y) {
    for (const el of this.dom.preview.querySelectorAll(':scope > .blk')) {
      const r = el.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) return el;
    }
    return null;
  }

  /** 点在块的左右留白：按点击的纵坐标把光标放到那一行，而不是跳到全文最后 */
  focusBlockAtPoint(index, x, y) {
    const el = this.blkEl(index);
    if (!el) return false;
    if (el.dataset.kind === 'source') { this.openSource(index); return true; }
    if (el.dataset.kind === 'code') { this.focusCode(index, 'end'); return true; }
    const r = el.getBoundingClientRect();
    const px = Math.min(Math.max(x, r.left + 1), r.right - 1);
    const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(px, y) : null;
    const sel = window.getSelection();
    if (range && el.contains(range.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(range);
      if (document.activeElement !== this.dom.preview) this.dom.preview.focus();
    } else {
      this.caretAt(index, x < r.left ? 'start' : 'end');
    }
    this.markCurrent(el);
    this._focus = index;
    this._lastEdit = index;
    return true;
  }

  /** 把光标放到第 index 块的 start/end */
  _blockOf(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return el && el.closest ? el.closest('.blk') : null;
  }

  /** 某个 (node, offset) 在块文本里的字符偏移 */
  _offIn(el, node, offset) {
    if (!el) return 0;
    const r = document.createRange();
    r.selectNodeContents(el);
    try { r.setEnd(node, offset); } catch { return 0; }
    return r.toString().length;
  }

  /** 从块内 DOM 区间取 Markdown 前缀 / 后缀，同时返回渲染文字长度 */
  inlineSlice(txt, node, offset, before) {
    if (!txt) return { md: '', textLen: 0 };
    const r = document.createRange();
    r.selectNodeContents(txt);
    try {
      if (before) r.setEnd(node, offset);
      else r.setStart(node, offset);
    } catch (_e) {
      return { md: '', textLen: 0 };
    }
    const host = document.createElement('div');
    host.appendChild(r.cloneContents());
    return { md: htmlToInline(host.innerHTML), textLen: host.textContent.length };
  }

  /** 把光标放到第 index 块的第 offset 个字符 */
  caretAtOffset(index, offset) {
    const txt = this.editableEl(index);
    if (!txt) return false;
    const walker = document.createTreeWalker(txt, NodeFilter.SHOW_TEXT);
    let pos = 0;
    let node = walker.nextNode();
    let target = null;
    let off = 0;
    while (node) {
      const len = node.nodeValue.length;
      if (offset <= pos + len) { target = node; off = Math.max(0, offset - pos); break; }
      pos += len;
      node = walker.nextNode();
    }
    const range = document.createRange();
    if (target) range.setStart(target, off);
    else range.selectNodeContents(txt);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    if (document.activeElement !== this.dom.preview) this.dom.preview.focus();
    const blk = txt.closest('.blk');
    if (blk) this.markCurrent(blk);
    this._focus = index;
    this._lastEdit = index;
    return true;
  }

  /** 删除"跨块的文字选区"覆盖的全部内容；返回 true 表示已经处理 */
  deleteSelectedContent(opts = {}) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    const r = sel.getRangeAt(0);
    // 选区端点可能直接落在宿主 #preview 上（例如 Ctrl+A 全选），要兜底到首/末块
    const host = this.dom.preview;
    const resolve = (node, offset, isStart) => {
      if (node === host) {
        const idx = isStart ? 0 : this._blocks.length - 1;
        const blk = this._blocks[idx];
        return { index: idx, offset: isStart ? 0 : (blk ? blockTextOf(blk).length : 0) };
      }
      const b = this._blockOf(node);
      if (!b) return { index: isStart ? 0 : this._blocks.length - 1, offset: 0 };
      const i = Number(b.dataset.i);
      const blk = this._blocks[i];
      // 代码块的文字在 textarea 里，外层选区最多碰到块的边界
      if (blk && blk.type === 'code') {
        return { index: i, offset: isStart ? 0 : blockTextOf(blk).length };
      }
      const txt = b.querySelector('.blk-txt');
      return { index: i, offset: txt ? this._offIn(txt, node, offset) : 0 };
    };
    const a = resolve(r.startContainer, r.startOffset, true);
    const b = resolve(r.endContainer, r.endOffset, false);
    const si = a.index;
    const ei = b.index;
    if (!Number.isFinite(si) || !Number.isFinite(ei)) return false;
    if (si === ei && !(r.startContainer === host)) return false;   // 单块内交给浏览器
    if (opts.copy) {
      const clip = window.tuyu && window.tuyu.clipboard;
      if (clip) clip.write(String(sel.toString() || ''));
    }
    const target = this._blocks[si];
    if (!target) return false;
    // 选区偏移是"渲染后的文字位置"，不能让带 ** / 链接的块直接按 Markdown
    // 源码长度切；优先从 DOM Range 取前缀 / 后缀，光标也用它计算。
    let headText = blockLen(target, a.offset);
    let tailText = '';
    let caretPos = headText.length;
    const targetTxt = this.editableEl(si);
    const tailBlk = this._blocks[ei];
    const tailTxt = this.editableEl(ei);
    const startInTarget = targetTxt && targetTxt.contains(r.startContainer);
    const endInTail = tailTxt && tailTxt.contains(r.endContainer);
    if (startInTarget && !SOURCE_BLOCKS.includes(target.type) && target.type !== 'code') {
      const slice = this.inlineSlice(targetTxt, r.startContainer, r.startOffset, true);
      headText = slice.md;
      caretPos = slice.textLen;
    }
    if (tailBlk) {
      tailText = blockLen(tailBlk, b.offset, true);
      if (endInTail && !SOURCE_BLOCKS.includes(tailBlk.type) && tailBlk.type !== 'code') {
        tailText = this.inlineSlice(tailTxt, r.endContainer, r.endOffset, false).md;
      }
    }
    if (SOURCE_BLOCKS.includes(target.type) || target.type === 'code') {
      // 选区从代码 / 公式 / 表格开头起：删完这一整块，按普通段落承接剩下的文字
      target.type = 'p';
      delete target.src;
      delete target.lang;
    }
    target.inline = headText + tailText;
    if (!target.inline) {
      // 整段删空后不能留下空的 "## " / "- " / 引用标记，回到普通空块
      target.type = 'empty';
      delete target.done;
      delete target.num;
      delete target.depth;
    } else if (target.type === 'empty') {
      target.type = 'p';
    }
    this._blocks.splice(si + 1, Math.max(0, ei - si));
    this.writeBack();
    this.renderBlocks();
    const first = this._blocks[si];
    if (first && first.type === 'code') this.focusCode(si, 'start');
    else this.caretAtOffset(si, caretPos);
    return true;
  }

  caretAt(index, where = 'end') {
    const blk = this._blocks[index];
    if (blk && blk.type === 'code') return this.focusCode(index, where);
    const txt = this.editableEl(index);
    if (!txt) return false;
    const range = document.createRange();
    range.selectNodeContents(txt);
    range.collapse(where === 'start');
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    if (document.activeElement !== this.dom.preview) this.dom.preview.focus();
    this.markCurrent(txt.closest('.blk'));
    this._focus = index;
    this._lastEdit = index;
    return true;
  }

  /** 这一块是不是只剩图片（没有文字） */
  isImageOnlyBlock(txt) {
    return Boolean(txt && txt.querySelector('img.note-img'))
      && !String(txt.textContent || '').replace(/\u200b/g, '').trim();
  }

  /** 光标紧挨着的前 / 后一张图片（只在光标收拢时判断） */
  adjacentImage(txt, dir) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const off = range.startOffset;
    const pick = (n) => (n && n.nodeName === 'IMG' && n.classList.contains('note-img') ? n : null);
    if (node === txt) {
      const child = txt.childNodes[dir < 0 ? off - 1 : off];
      return pick(child);
    }
    if (node.nodeType === 3) {
      if (dir < 0 && off === 0) {
        let prev = node.previousSibling;
        while (prev && prev.nodeType === 3 && !prev.nodeValue) prev = prev.previousSibling;
        return pick(prev);
      }
      if (dir > 0 && off === node.nodeValue.length) {
        let next = node.nextSibling;
        while (next && next.nodeType === 3 && !next.nodeValue) next = next.nextSibling;
        return pick(next);
      }
      return null;
    }
    if (node.nodeType === 1) {
      if (dir < 0 && off === 0) return pick(node.previousSibling);
      if (dir > 0 && off === node.childNodes.length) return pick(node.nextSibling);
    }
    return null;
  }

  /** 删掉图文混排里光标旁边的一张图片，光标尽量留在原处 */
  deleteInlineImage(index, img, txt) {
    const sel = window.getSelection();
    const offset = sel && sel.rangeCount ? this._offIn(txt, sel.anchorNode, sel.anchorOffset) : 0;
    img.remove();
    this.syncInline(index);
    this.caretAtOffset(index, Math.max(0, offset));
  }

  /** 点图片后把光标放到图片后面，退格就能删掉它 */
  caretAfterImage(index, img) {
    if (!img || !img.parentNode) return false;
    const range = document.createRange();
    range.setStartAfter(img);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    if (document.activeElement !== this.dom.preview) this.dom.preview.focus();
    const blk = img.closest('.blk');
    if (blk) this.markCurrent(blk);
    this._focus = index;
    this._lastEdit = index;
    return true;
  }

  /** 所有块 → note.content。改一个字就同步一次，自动保存拿到的永远是最新文本。 */
  writeBack(opts = {}) {
    if (!this.note) return;
    this.syncCodeFromDom();
    const sources = this._blocks.map((b) => blockToLines(b));
    const content = sources.map((lines) => lines.join('\n')).join('\n\n');
    let line = 0;
    this._blocks.forEach((b, i) => {
      b.start = line;
      b.end = line + sources[i].length;
      line = b.end + 1;
    });
    if (content === this.note.content) return;
    this.pushHistory(this.note.content, Boolean(opts.forceHistory));
    this.note.content = content;
    this.note.updated = Date.now();
    this.renderMeta();
    if (this.hooks.onEdit) this.hooks.onEdit(this.note.id);
  }

  /** 写回前兜底：只有当块里的代码莫名变空、而 DOM 里还看得见代码时，才从
   *  textarea 取回。正常非空内容不覆盖，避免重排/移动块时拿错块。 */
  syncCodeFromDom() {
    if (this._skipDomSync) return;
    const dom = this.dom.preview.querySelectorAll(':scope > .blk');
    if (dom.length !== this._blocks.length) return;
    for (let i = 0; i < dom.length; i += 1) {
      const el = dom[i];
      const blk = this._blocks[i];
      if (!blk || blk.type !== 'code' || blk.src || el.dataset.i !== String(i)
        || !el.classList.contains('blk-code')) continue;
      const ta = el.querySelector('.code-input');
      if (ta && ta.value) blk.src = ta.value.replace(/\r\n?/g, '\n');
    }
  }

  /** 笔记内容的撤销栈：每次真正改动前记一份，打字按 HISTORY_MERGE_MS 合并成一步 */
  pushHistory(prev, force = false) {
    if (prev == null) return;
    this._history = this._history || [];
    const now = Date.now();
    const last = this._history[this._history.length - 1];
    if (last === prev) return;
    if (!force && this._lastPush && now - this._lastPush < HISTORY_MERGE_MS && this._history.length) {
      // 连续打字：保留这一串开始前的那一版，不逐步记录
      this._lastPush = now;
      this._future = [];
      return;
    }
    this._history.push(prev);
    if (this._history.length > 100) this._history.shift();
    this._lastPush = now;
    this._future = [];
  }

  /** Ctrl+Z：撤销笔记内容（没有历史就返回 false，让浏览器自己来） */
  undoNote() {
    if (!this.note || !this._history || !this._history.length) return false;
    const prev = this._history.pop();
    this._future = this._future || [];
    this._future.push(this.note.content);
    this.note.content = prev;
    this._lastPush = 0;
    this.renderBlocks();
    this.focusBlock(Math.min(this._lastEdit || 0, this._blocks.length - 1), 'end');
    if (this.hooks.onEdit) this.hooks.onEdit(this.note.id);
    return true;
  }

  /** Ctrl+Y / Ctrl+Shift+Z：重做 */
  redoNote() {
    if (!this.note || !this._future || !this._future.length) return false;
    const next = this._future.pop();
    this._history = this._history || [];
    this._history.push(this.note.content);
    this.note.content = next;
    this._lastPush = 0;
    this.renderBlocks();
    this.focusBlock(Math.min(this._lastEdit || 0, this._blocks.length - 1), 'end');
    if (this.hooks.onEdit) this.hooks.onEdit(this.note.id);
    return true;
  }

  /** 把某一块的富文本内容读回 markdown（不重排 DOM，光标不会跳） */
  syncInline(index) {
    const txt = this.editableEl(index);
    const blk = this._blocks[index];
    if (!txt || !blk) return;
    blk.inline = htmlToInline(txt.innerHTML);
    // 往空块里打字 → 它就变成普通段落
    if (blk.type === 'empty' && blk.inline) blk.type = 'p';
    this.writeBack();
  }

  // ---------------------------------------------------------------- 编辑交互
  /** 光标落在哪一块，就给那一块加 .cur（替代原来的 :focus-within） */
  markCurrent(blk) {
    if (blk === this._curEl) return;
    if (this._curEl) this._curEl.classList.remove('cur');
    this._curEl = blk || null;
    if (blk) {
      this._windowBlurred = false;
      blk.classList.add('cur');
    }
  }

  paintCurrentBlock() {
    const active = document.activeElement;
    // 窗口失焦，或焦点在标题 / 搜索 / 画布 / 别的笔记上时，不要根据残留选区
    // 把刚收掉的 .cur 又画回来。
    if (this._windowBlurred
      || !active || !active.closest || !this.dom.preview.contains(active)) {
      this.markCurrent(null);
      return;
    }
    if (active.closest && this.dom.preview.contains(active)) {
      const own = active.closest('.blk');
      if (own) {
        this.markCurrent(own);
        this._focus = Number(own.dataset.i);
        this._lastEdit = this._focus;
        return;
      }
    }
    const el = this.currentBlockEl();
    const blk = el && el.closest ? el.closest('.blk') : null;
    if (!blk) { this.markCurrent(null); return; }
    this.markCurrent(blk);
    this._focus = Number(blk.dataset.i);
    this._lastEdit = this._focus;
  }

  onPreviewFocusIn(e) {
    const target = e.target;
    if (!target || !target.closest) return;
    this._windowBlurred = false;
    const blk = target.closest('.blk');
    if (!blk || !this.dom.preview.contains(blk)) return;
    this._focus = Number(blk.dataset.i);
    this._lastEdit = this._focus;
    this.markCurrent(blk);
  }

  onPreviewFocusOut(e) {
    const target = e.target;
    if (!target || !target.closest) return;
    if (target.classList && target.classList.contains('code-input')) {
      // 焦点离开笔记区才收掉落点底色；焦点只是挪到语言框上就保持
      setTimeout(() => {
        const now = document.activeElement;
        if (!now || !now.closest || !this.dom.preview.contains(now)) this.markCurrent(null);
      }, 0);
      return;
    }
    const txt = target.closest('.blk-txt');
    if (!txt) return;
    const blk = txt.closest('.blk');
    if (!blk) return;
    const index = Number(blk.dataset.i);
    this.syncInline(index);
    // 失焦后把这一块重新排版一次（`**粗**` 这种打进去的字就会变成真粗体）
    this.scheduleNormalize(index);
  }

  scheduleNormalize(index) {
    clearTimeout(this._normalizeTimer);
    this._normalizeTimer = setTimeout(() => {
      if (this._focus === index) return;          // 又点回来了，别动
      if (!this.note) return;
      const active = document.activeElement;
      // 焦点还在正文（包括代码块 / 语言框）里就别重排：重排会把输入框和语言下拉一起冲掉
      if (active && active.closest && (active.closest('.blk-txt') || active.closest('.blk-code'))) return;
      if (this._langMenu) return;
      // 正在选一段字：重排 DOM 会把选区弄没，先跳过
      const selNow = window.getSelection();
      if (selNow && !selNow.isCollapsed && selNow.toString()) return;
      this.renderBlocks();
    }, 120);
  }

  onPreviewInput(e) {
    const target = e.target;
    if (target && target.classList) {
      if (target.classList.contains('code-input')) { this.onCodeInput(target); return; }
      if (target.classList.contains('code-lang')) { this.filterLangMenu(target.value); return; }
    }
    // 单宿主下真实输入的 target 是 #preview，不是里面的 .blk-txt；
    // 合成事件 / 旧路径才直接落在 .blk-txt 上。
    let txt = target && target.closest ? target.closest('.blk-txt') : null;
    if (!txt && target === this.dom.preview) {
      const cur = this.currentBlockEl();
      if (cur && cur.classList && cur.classList.contains('blk-txt')) txt = cur;
      if (!txt && this._focus != null) txt = this.editableEl(this._focus);
    }
    if (!txt) return;
    const blk = txt.closest('.blk');
    if (!blk) return;
    const index = Number(blk.dataset.i);
    this.syncInline(index);
    // 输入即转换：块首打 "# "、"- "、"1. "、"[] "、"> " 直接变块类型
    // 代码围栏不在这里转：Typora 是敲 ```（可带语言）再按回车才变代码块
    this.autoFormat(index);
  }

  /** Notion 那种"打前缀自动变块" */
  autoFormat(index) {
    const blk = this._blocks[index];
    if (!blk || blk.type !== 'p') return;
    const text = String(blk.inline || '');
    const m = /^(#{1,3}|[-*+]|\d{1,2}[.)]|\[[ xX]?\]|>)(\s+)([\s\S]*)$/.exec(text);
    if (!m) return;
    const [, mark, , rest] = m;
    let type = 'p';
    if (mark[0] === '#') type = `h${mark.length}`;
    else if (mark === '>' ) type = 'quote';
    else if (/^\[[ xX]?\]$/.test(mark)) type = 'task';
    else if (/^\d/.test(mark)) type = 'num';
    else type = 'bullet';
    blk.type = type;
    blk.inline = rest;
    if (type === 'task') blk.done = /x/i.test(mark);
    this.writeBack();
    this.renderBlocks();
    this.focusBlock(index, 'end');
  }

  /** 段落里写着 ``` 或 ```js，按回车 → 变成代码块（Typora 的建法） */
  tryFenceConvert(txt) {
    if (!txt) return false;
    const blk = txt.closest('.blk');
    if (!blk) return false;
    const index = Number(blk.dataset.index || blk.dataset.i);
    const text = String(txt.textContent || '');
    const m = /^```\s*([^\s`]*)\s*$/.exec(text);
    if (!m) return false;
    this.makeCodeBlock(index, m[1] || '');
    return true;
  }

  /** 把某一块换成代码块（可带语言和初始内容），光标落到代码里 */
  makeCodeBlock(index, lang = '', src = '', where = 'start') {
    const blk = this._blocks[index];
    if (!blk) return;
    blk.type = 'code';
    blk.src = String(src == null ? '' : src);
    blk.lang = String(lang == null ? '' : lang).trim().replace(/[\s`]+/g, '');
    delete blk.inline;
    delete blk.done;
    delete blk.num;
    delete blk.depth;
    this.writeBack();
    this.renderBlocks();
    this.focusCode(index, where);
    const fresh = this._blocks[index];
    if (fresh && fresh.type === 'code' && !fresh.lang) this.scheduleAutoLanguage(index, 0);
  }

  /** 富文本块里插纯文本（粘贴、图片引用） */
  insertIntoEditable(text) {
    const el = this.activeEditor();
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') {
      const start = el.selectionStart == null ? el.value.length : el.selectionStart;
      el.value = el.value.slice(0, start) + text + el.value.slice(el.selectionEnd == null ? start : el.selectionEnd);
      el.selectionStart = el.selectionEnd = start + text.length;
      this.onSourceInput({ target: el });
      return true;
    }
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    const blk = el.closest('.blk');
    if (blk) this.syncInline(Number(blk.dataset.i));
    return true;
  }

  /** 光标在块首吗 */
  caretAtBlockStart(el) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const r = sel.getRangeAt(0);
    if (!r.collapsed) return false;
    const pre = r.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(r.startContainer, r.startOffset);
    return pre.toString().length === 0 && !pre.querySelector || pre.innerHTML === '';
  }

  /** 按回车：在光标处拆块 */
  splitAtCaret() {
    const index = this.currentIndex();
    if (index == null) return;
    const txt = this.editableEl(index);
    const sel = window.getSelection();
    if (!txt) return;
    const cur0 = this._blocks[index];
    if (!cur0) return;
    // 光标不在这块文本里（比如刚点击过宿主）：当成"在块尾回车"
    const r0 = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!r0 || !txt.contains(r0.startContainer)) {
      const t0 = ['h1', 'h2', 'h3'].includes(cur0.type) ? 'p' : cur0.type;
      this._blocks.splice(index + 1, 0, { type: t0, inline: '', depth: cur0.depth || 0, done: false });
      this.writeBack();
      this.renderBlocks();
      this.focusBlock(index + 1, 'start');
      return;
    }
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const before = document.createRange();
    before.selectNodeContents(txt);
    before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange();
    after.selectNodeContents(txt);
    after.setStart(range.endContainer, range.endOffset);
    const grab = (r) => {
      const box = document.createElement('div');
      box.appendChild(r.cloneContents());
      return htmlToInline(box.innerHTML);
    };
    const cur = this._blocks[index];
    if (!cur) return;
    // 标题块最前面按回车：不要在标题上面留一个空标题、把标题文字降成正文。
    // 正确做法是在标题前面插入一个空段落，标题原样留在下面。
    if (range.collapsed && grab(before) === '' && grab(after) !== ''
      && ['h1', 'h2', 'h3'].includes(cur.type)) {
      this._blocks.splice(index, 0, { type: 'p', inline: '', depth: 0, done: false });
      this.writeBack();
      this.renderBlocks();
      this.focusBlock(index, 'start');
      this.markTopHeading();
      return;
    }
    cur.inline = grab(before);
    const nextType = ['h1', 'h2', 'h3'].includes(cur.type) ? 'p' : cur.type;
    const created = { type: nextType, inline: grab(after), depth: cur.depth || 0, done: false };
    if (nextType === 'num' && cur._num) created.num = cur._num + 1;
    this._blocks.splice(index + 1, 0, created);
    this.writeBack();
    this.renderBlocks();
    this.focusBlock(index + 1, 'start');
  }

  /** 块首退格：空块删掉，非空块并进上一块 */
  mergeUp() {
    const index = this.currentIndex();
    if (index == null || index <= 0) return;
    const txt = this.editableEl(index);
    if (!txt) return;
    const empty = !htmlToInline(txt.innerHTML).trim();
    const cur = this._blocks[index];
    const prev = this._blocks[index - 1];
    if (!cur || !prev) return;
    if (empty) {
      this._blocks.splice(index, 1);
    } else {
      const text = htmlToInline(txt.innerHTML);
      if (prev.type === 'code') {
        // 上一块是代码：把这段文字接进代码末尾，绝不能写进不存在的 inline 里丢掉
        const join = String(prev.src || '').length;
        prev.src = (prev.src ? prev.src + '\n' : '') + text;
        this._blocks.splice(index, 1);
        this.writeBack();
        this.renderBlocks();
        this.focusCode(index - 1, 'end');
        const ta = this.codeInput(index - 1);
        if (ta) { ta.setSelectionRange(join, join); this.syncCodeScroll(ta); }
        return;
      }
      if (SOURCE_BLOCKS.includes(prev.type)) {
        // 公式 / 表格 / 分割线没有可拼接的文字；宁可不合，也别吞掉这一段
        return;
      }
      prev.inline = (prev.inline || '') + (prev.inline ? '\n' : '') + text;
      this._blocks.splice(index, 1);
    }
    this.writeBack();
    this.renderBlocks();
    this.focusBlock(Math.max(0, index - 1), 'end');
  }

  /** 光标放进代码块（start / end） */
  focusCode(index, where = 'end') {
    const ta = this.codeInput(index);
    if (!ta) return false;
    ta.focus();
    const pos = where === 'start' ? 0 : ta.value.length;
    try { ta.setSelectionRange(pos, pos); } catch (_e) { /* 元素可能刚被移走 */ }
    ta.scrollLeft = where === 'start' ? 0 : ta.scrollWidth;
    this.syncCodeScroll(ta);
    this._focus = index;
    this._lastEdit = index;
    this.markCurrent(ta.closest('.blk'));
    // 点进一个原来没语言的代码块，也给它一次自动识别的机会
    const blk = this._blocks[index];
    if (blk && blk.type === 'code' && !blk.lang && !blk.langTouched) this.scheduleAutoLanguage(index);
    return true;
  }

  focusBlock(index, where = 'end') {
    const blk = this._blocks[index];
    if (!blk) return;
    if (blk.type === 'code') {
      this.focusCode(index, where);
      return;
    }
    if (SOURCE_BLOCKS.includes(blk.type)) {
      this.openSource(index);
      return;
    }
    // 单宿主：光标用 Range 落，焦点给 #preview
    if (document.activeElement !== this.dom.preview) this.dom.preview.focus();
    if (!this.caretAt(index, where)) return;
  }

  // ---------------------------------------------------------------- 块结构操作
  removeBlock(index) {
    if (!this.note) return;
    const blk = this._blocks[index];
    if (!blk) return;
    this._blocks.splice(index, 1);
    if (!this._blocks.length) this._blocks.push({ type: 'empty', inline: '' });
    this.writeBack();
    this.renderBlocks();
    const target = Math.max(0, Math.min(index, this._blocks.length - 1));
    this.focusBlock(target, 'end');
  }

  /** 空代码块里按退格 / 删除：直接去掉整个块，别把用户困在空代码框里 */
  removeEmptyCodeBlock(index) {
    const blk = this._blocks[index];
    if (!blk || blk.type !== 'code') return;
    const hadPrev = index > 0;
    this._blocks.splice(index, 1);
    if (!this._blocks.length) this._blocks.push({ type: 'empty', inline: '' });
    this.writeBack({ forceHistory: true });
    this.renderBlocks();
    if (hadPrev) this.focusBlock(index - 1, 'end');
    else this.focusBlock(0, 'start');
  }

  appendBlock() {
    if (!this.note) return;
    this._blocks.push({ type: 'p', inline: '' });
    this.writeBack();
    this.renderBlocks();
    this.focusBlock(this._blocks.length - 1, 'end');
  }

  appendAfter(index) {
    const at = Math.min((index == null ? this._blocks.length : index) + 1, this._blocks.length);
    this._blocks.splice(at, 0, { type: 'p', inline: '' });
    this.writeBack();
    this.renderBlocks();
    this.focusBlock(at, 'end');
  }

  moveBlock(index, delta) {
    const j = index + delta;
    if (j < 0 || j >= this._blocks.length) return;
    const [blk] = this._blocks.splice(index, 1);
    this._blocks.splice(j, 0, blk);
    // 块顺序变了但 DOM 还是旧的：这时别从 DOM 兜代码，会拿错块
    this._skipDomSync = true;
    try { this.writeBack(); } finally { this._skipDomSync = false; }
    this.renderBlocks();
    this.focusBlock(j, 'end');
  }

  duplicateBlock(index) {
    const blk = this._blocks[index];
    if (!blk) return;
    this._blocks.splice(index + 1, 0, Object.assign({}, blk));
    this.writeBack();
    this.renderBlocks();
    this.focusBlock(index + 1, 'end');
  }

  toggleTask(index) {
    const blk = this._blocks[index];
    if (!blk || blk.type !== 'task') return;
    blk.done = !blk.done;
    this.writeBack();
    this.renderBlocks();
  }

  /** 换块类型（右键「转为」/ `/` 菜单），保留文字 */
  convertBlock(index, type) {
    const blk = this._blocks[index];
    if (!blk || !this.note) return;
    const wasCode = blk.type === 'code';
    const text = blk.type === 'code' || blk.type === 'math' || blk.type === 'table'
      ? String(blk.src || '')
      : String(blk.inline || '');

    if (type === 'code') {
      let lang = '';
      let src = text;
      const fence = /^```\s*([^\s`]*)\s*$/.exec(text.trim());
      if (fence) { lang = fence[1] || ''; src = ''; }
      this.makeCodeBlock(index, lang, src, src ? 'end' : 'start');
      return;
    }

    // 从代码块转成别的：把代码原文接过去，不然文字会丢
    if (wasCode) {
      blk.inline = text;
      delete blk.src;
      delete blk.lang;
    }
    blk.type = type;
    if (type === 'num') blk.num = 1;
    if (type !== 'task') blk.done = false;
    if (type === 'table') blk.src = '| 列 1 | 列 2 |\n| --- | --- |\n|  |  |';
    if (type === 'math') blk.src = text;
    this.writeBack();
    this.renderBlocks();
    if (SOURCE_BLOCKS.includes(type)) this.openSource(index);
    else this.focusBlock(index, 'end');
  }

  // ---------------------------------------------------------------- 源码块（代码/公式/表格）
  openSource(index) {
    const blk = this._blocks[index];
    const el = this.blkEl(index);
    if (!blk || !el) return;
    if (blk.type === 'code') { this.focusCode(index, 'end'); return; }
    if (this._sourceIndex === index) return;
    this.commitSource();
    this._sourceIndex = index;
    this._sourceEl = el;
    this._sourceValue = blk.src || '';
    el.classList.add('is-editing');
    el.innerHTML = '';
    const ta = document.createElement('textarea');
    ta.className = 'blk-editor';
    ta.spellcheck = false;
    ta.value = this._sourceValue;
    el.appendChild(ta);
    this.autosize(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  onSourceInput(e) {
    const ta = e.target;
    if (!ta.classList) return;
    if (ta.classList.contains('code-input')) { this.onCodeInput(ta); return; }
    if (!ta.classList.contains('blk-editor')) return;
    this.autosize(ta);
    const index = this._sourceIndex;
    const blk = index == null ? null : this._blocks[index];
    if (!blk) return;
    blk.src = ta.value;
    this.writeBack();
  }

  commitSource() {
    const index = this._sourceIndex;
    if (index == null) return;
    const ta = this.dom.preview.querySelector(`.blk[data-i="${index}"] .blk-editor`);
    const blk = this._blocks[index];
    if (ta && blk) blk.src = ta.value;
    this._sourceIndex = null;
    this._sourceEl = null;
    this.writeBack();
    this.renderBlocks();
  }

  autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }

  // ---------------------------------------------------------------- 点击 / 键盘
  onBlockClick(e) {
    if (this._justDragged) { this._justDragged = false; return; }
    const plainTarget = e.target;
    if (plainTarget && plainTarget.classList
      && (plainTarget.classList.contains('code-input') || plainTarget.classList.contains('code-lang'))) {
      // 代码块 / 语言框里的点击、Shift 扩选都交给浏览器，别被块级多选截走
      const own = plainTarget.closest('.blk');
      if (own) { this._focus = Number(own.dataset.i); this._lastEdit = this._focus; }
      if (this._sel && this._sel.size) { this._sel.clear(); this.repaintSelection(); }
      return;
    }
    // Shift / Ctrl + 点击：块级多选（不进编辑）
    const hitBlk = e.target.closest && e.target.closest('.blk');
    if (hitBlk && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      const idx = Number(hitBlk.dataset.i);
      if (e.shiftKey && this._lastEdit != null && this._lastEdit !== idx) {
        const a = Math.min(this._lastEdit, idx);
        const b = Math.max(this._lastEdit, idx);
        this._sel = new Set();
        for (let k = a; k <= b; k += 1) this._sel.add(k);
      } else if (e.ctrlKey || e.metaKey) {
        if (this._sel.has(idx)) this._sel.delete(idx);
        else this._sel.add(idx);
        this._lastEdit = idx;
      } else {
        this._sel = new Set([idx]);
        this._lastEdit = idx;
      }
      e.preventDefault();
      this.repaintSelection();
      return;
    }
    if (this._sel.size && !document.querySelector('.blk-menu')) {
      this._sel.clear();
      this.repaintSelection();
    }
    const check = e.target.closest('.blk-check');
    if (check) { this.toggleTask(Number(check.dataset.i)); return; }
    if (e.target.closest('textarea')) return;
    const link = e.target.closest('.wl');
    const blk = e.target.closest('.blk');
    const editingThis = blk && Number(blk.dataset.i) === this._focus;
    if (link && !editingThis) { if (this.hooks.onLink) this.hooks.onLink(link.dataset.title); return; }
    const tag = e.target.closest('.tag');
    if (tag && !editingThis) { if (this.hooks.onTag) this.hooks.onTag(tag.dataset.tag); return; }
    if (!blk) {
      // 刚拖选完、松手后的 click 落在空白处 → 不要动选区
      const selNow = window.getSelection();
      if (selNow && !selNow.isCollapsed && selNow.toString()) return;
      // 点在正文左侧 / 右侧的留白上：如果纵向正好落在某一块上，
      // 光标要落到那一块对应的行，而不是突然跳到全文最后。
      const edge = this.blockAtY(e.clientY);
      if (edge) {
        this.focusBlockAtPoint(Number(edge.dataset.i), e.clientX, e.clientY);
        return;
      }
      // 点到正文里的空白（最后一块下面）→ 直接续写：
      // 最后一块已经空着就聚焦它，否则新开一个空段落并跳过去。
      if (this._blocks.length) {
        const last = this._blocks.length - 1;
        const blk = this._blocks[last];
        const lastEl = this.blkEl(last);
        const belowLast = !lastEl || e.clientY >= lastEl.getBoundingClientRect().bottom - 1;
        const empty = blk && (blk.type === 'empty'
          || (blk.type === 'p' && !String(blk.inline || '').trim()));
        if (!belowLast) this.focusBlock(last, 'end');
        else if (empty) this.focusBlock(last, 'end');
        else this.appendBlock();
      } else {
        this.appendBlock();
      }
      return;
    }
    const index = Number(blk.dataset.i);
    const clickedImg = e.target.closest && e.target.closest('img.note-img');
    if (clickedImg) { this.caretAfterImage(index, clickedImg); return; }
    if (blk.dataset.kind === 'code') {
      // 语言框旁边那一整条也是 .blk-code 的一部分。点这条空白时用户其实想
      // 接着代码块往下写，应该把光标放到下一块，而不是又塞回代码末尾。
      if (e.target.closest('.code-foot') && !e.target.closest('.code-lang')) {
        const next = index + 1;
        if (this._blocks[next]) { this.focusBlock(next, 'start'); return; }
        // 后面还没有块：像 ↓ 一样补一个空段落，光标落过去
        this.exitCode(index, 1);
        return;
      }
      // 点在高亮层 / 行号 / 代码框空白上 → 光标放到代码末尾
      if (!e.target.closest('.code-input, .code-lang')) this.focusCode(index, 'end');
      return;
    }
    if (blk.dataset.kind === 'source') { this.openSource(index); return; }
    // 富文本块：把光标放进去（真实点击时浏览器已经放过，这里兜底）
    const txt = blk.querySelector('.blk-txt');
    if (txt) {
      // 已经有"选了一段字"的选区（刚拖选完）→ 别动它，
      // 否则拖选松手后浏览器补发的 click 会把选区收成一点
      const selNow = window.getSelection();
      const keepSelection = selNow && !selNow.isCollapsed && selNow.rangeCount
        && txt.contains(selNow.anchorNode);
      if (!keepSelection) {
        const range = document.caretRangeFromPoint
          ? document.caretRangeFromPoint(e.clientX || 0, e.clientY || 0)
          : null;
        const sel = window.getSelection();
        if (range && txt.contains(range.startContainer)) {
          sel.removeAllRanges();
          sel.addRange(range);
        } else if (!sel || !sel.rangeCount || !txt.contains(sel.anchorNode)) {
          this.caretAt(index, 'end');
        }
      }
      this._focus = index;
      this._lastEdit = index;
    }
  }

  onBlockDblClick() { /* 单击已经能进编辑，双击不再需要 */ }

  repaintSelection() {
    for (const el of this.dom.preview.querySelectorAll('.blk')) {
      el.classList.toggle('sel', this._sel.has(Number(el.dataset.i)));
    }
  }

  /** 块内 [from, to) 字符区间对应的 Range */
  _rangeInBlock(index, from, to) {
    const txt = this.editableEl(index);
    if (!txt) return null;
    const walker = document.createTreeWalker(txt, NodeFilter.SHOW_TEXT);
    let pos = 0;
    let startNode = null;
    let startOff = 0;
    let endNode = null;
    let endOff = 0;
    let node = walker.nextNode();
    while (node) {
      const len = node.nodeValue.length;
      if (!startNode && from <= pos + len) { startNode = node; startOff = Math.max(0, from - pos); }
      if (to <= pos + len && startNode) { endNode = node; endOff = Math.max(0, to - pos); break; }
      pos += len;
      node = walker.nextNode();
    }
    if (!startNode) return null;
    if (!endNode) { endNode = startNode; endOff = startNode.nodeValue.length; }
    try {
      const r = document.createRange();
      r.setStart(startNode, startOff);
      r.setEnd(endNode, endOff);
      return r;
    } catch { return null; }
  }

  clearPartialHighlight() {
    if (this._hlLayer) { this._hlLayer.remove(); this._hlLayer = null; }
  }

  paintPartialHighlight() {
    const p = this._partial;
    if (!p) return;
    const layer = document.createElement('div');
    layer.className = 'drag-layer';
    this.dom.preview.appendChild(layer);
    this._hlLayer = layer;
    const box = this.dom.preview.getBoundingClientRect();
    const put = (range) => {
      if (!range) return;
      for (const rc of range.getClientRects()) {
        if (rc.width < 1 || rc.height < 1) continue;
        const d = document.createElement('div');
        d.className = 'drag-hl';
        d.style.left = (rc.left - box.left) + 'px';
        d.style.top = (rc.top - box.top + this.dom.preview.scrollTop) + 'px';
        d.style.width = rc.width + 'px';
        d.style.height = rc.height + 'px';
        layer.appendChild(d);
      }
    };
    const down = p.toIndex >= p.fromIndex;
    const lo = down ? p.fromIndex : p.toIndex;
    const hi = down ? p.toIndex : p.fromIndex;
    const lenOf = (i) => (blockTextOf(this._blocks[i]) || '').length;
    // 逐块画：起点块从那个字、终点块到那个字、中间整块 —— 连起来就是"完整的选中内容"
    for (let i = lo; i <= hi; i += 1) {
      let from = 0;
      let to = lenOf(i);
      if (down) {
        if (i === p.fromIndex) from = p.fromOffset;
        if (i === p.toIndex) to = p.toOffset;
      } else {
        if (i === p.toIndex) from = p.toOffset;
        if (i === p.fromIndex) to = p.fromOffset;
      }
      put(this._rangeInBlock(i, from, to));
    }
  }

  /** 某个 Range 的起点落在第 index 块的"第几个字符" */
  _offsetInBlock(range, index) {
    const txt = this.editableEl(index);
    if (!txt || !range) return 0;
    try {
      const r = document.createRange();
      r.selectNodeContents(txt);
      r.setEnd(range.startContainer, range.startOffset);
      return r.toString().length;
    } catch { return 0; }
  }

  /** 按 `_partial` 拼出精确到字的文本（向下 / 向上都支持） */
  _partialText() {
    const p = this._partial;
    if (!p) return '';
    const text = (i) => (this._blocks[i] ? blockTextOf(this._blocks[i]) : '');
    const down = p.toIndex >= p.fromIndex;
    const lo = down ? p.fromIndex : p.toIndex;
    const hi = down ? p.toIndex : p.fromIndex;
    const out = [];
    for (let i = lo; i <= hi; i += 1) {
      let t = text(i);
      if (i === lo && down && i === p.fromIndex) t = t.slice(p.fromOffset);
      if (i === lo && !down && i === p.toIndex) t = t.slice(p.toOffset);
      if (i === hi && down && i === p.toIndex) t = t.slice(0, p.toOffset);
      if (i === hi && !down && i === p.fromIndex) t = t.slice(0, p.fromOffset);
      out.push(t);
    }
    return out.filter(Boolean).join('\n\n');
  }

  /** 选中块（>1 时才算多选）：返回下标数组（从大到小，方便删） */
  selectedIndexes() {
    return [...this._sel].sort((a, b) => a - b);
  }

  /** 用鼠标拖过多行文字时，按原生选区找出覆盖到的块（含首尾块） */
  selectionBlockIndexes() {
    const sel = window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return [];
    const range = sel.getRangeAt(0);
    if (!this.dom.preview.contains(range.commonAncestorContainer)) return [];
    const blocks = [...this.dom.preview.querySelectorAll(':scope > .blk')];
    if (!blocks.length) return [];
    const at = (node, offset, isStart) => {
      if (node === this.dom.preview) {
        if (isStart) return blocks[offset] || blocks[0];
        return blocks[Math.max(0, offset - 1)] || blocks[blocks.length - 1];
      }
      const el = node && (node.nodeType === 1 ? node : node.parentElement);
      return el && el.closest ? el.closest('.blk') : null;
    };
    const a = at(range.startContainer, range.startOffset, true);
    const b = at(range.endContainer, range.endOffset, false);
    if (!a || !b) return [];
    let ai = blocks.indexOf(a);
    let bi = blocks.indexOf(b);
    if (ai < 0 || bi < 0) return [];
    if (ai > bi) [ai, bi] = [bi, ai];
    return blocks.slice(ai, bi + 1)
      .map((el) => Number(el.dataset.i))
      .filter((i) => Number.isInteger(i) && this._blocks[i]);
  }

  /** 删掉选中的块（一块或多块） */
  deleteSelectedBlocks() {
    if (!this._sel.size) return false;
    const idxs = this.selectedIndexes().reverse();
    for (const i of idxs) this._blocks.splice(i, 1);
    if (!this._blocks.length) this._blocks.push({ type: 'empty', inline: '' });
    this._sel.clear();
    this.writeBack();
    this.renderBlocks();
    return true;
  }

  /** 选中块的文本（按顺序拼） */
  selectedText() {
    const precise = this._partialText();
    if (precise) return precise;
    const picked = window.getSelection ? String(window.getSelection() || '') : '';
    if (picked) return picked;
    return this.selectedIndexes()
      .map((i) => this._blocks[i] && blockTextOf(this._blocks[i]))
      .filter(Boolean)
      .join('\n\n');
  }

  /** 右键正文里的某一段 → 文本编辑菜单（里面再嵌「转为」块类型子菜单） */
  onPreviewContextMenu(e) {
    if (e.target.closest && e.target.closest('.code-lang')) return;   // 语言框交回系统
    const blk = e.target.closest && e.target.closest('.blk');
    if (!blk) return;
    e.preventDefault();
    const index = Number(blk.dataset.i);
    const image = e.target.closest && e.target.closest('img.note-img');
    this._focus = index;
    this._lastEdit = index;
    this.openBlockContextMenu(index, e.clientX, e.clientY, image);
  }

  /** 把 fixed 菜单放进视口；下方放不下就向上翻，右侧放不下就向左翻。 */
  placeMenu(el, x, y) {
    const margin = 6;
    el.style.visibility = 'hidden';
    el.style.left = `${margin}px`;
    el.style.top = `${margin}px`;
    document.body.appendChild(el);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = x;
    let top = y;
    if (left + w > window.innerWidth - margin) left = x - w;
    if (top + h > window.innerHeight - margin) top = y - h;
    left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - h - margin));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = '';
  }

  /** 子菜单贴着按钮：优先右侧，放不下换左侧；上下同样夹在视口内。 */
  placeSubMenu(el, anchor) {
    const margin = 6;
    el.style.visibility = 'hidden';
    el.style.left = `${margin}px`;
    el.style.top = `${margin}px`;
    document.body.appendChild(el);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const a = anchor.getBoundingClientRect();
    let left = a.right + 2;
    if (left + w > window.innerWidth - margin) left = a.left - w - 2;
    let top = a.top - 4;
    if (top + h > window.innerHeight - margin) top = window.innerHeight - h - margin;
    left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - h - margin));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = '';
  }

  /** 右键菜单：剪切 / 复制 / 粘贴 / 全选 + 转为 ▸ */
  openBlockContextMenu(index, x, y, image = null) {
    this.commitLangIfNeeded();
    this.closeLangMenu();
    this.closeBlockMenu();
    // 原生拖选跨了多块文字：右键时也给出批量属性入口，但不把整块当作块选中
    const textPicked = this.selectionBlockIndexes();
    if (!this._sel.size && textPicked.length > 1) {
      this.openTextSelectionMenu(textPicked, x, y);
      return;
    }
    // 只要有选中就按"选中"处理：不管右键落在哪一块，都不会把选中弄丢
    const multi = this._sel.size >= 1;
    if (multi) {
      const picked = this.selectedIndexes();
      const listLike = picked.some((i) => ['bullet', 'num', 'task'].includes(this._blocks[i] && this._blocks[i].type));
      const hasTask = picked.some((i) => this._blocks[i] && this._blocks[i].type === 'task');
      const m2 = document.createElement('div');
      m2.className = 'blk-menu';
      m2.innerHTML = [
        '<button data-act="copy">' + (this._sel.size > 1 ? '复制选中 ' + this._sel.size + ' 块' : '复制这一块') + '</button>',
        '<button data-act="cut">剪切选中</button>',
        '<button data-act="del" class="danger">删除选中</button>',
        '<div class="sep"></div>',
        '<button data-act="type" class="has-sub">' + (this._sel.size > 1 ? '转为选中 ' + this._sel.size + ' 块' : '转为这一块') + '<span class="sub-arrow">▸</span></button>',
        listLike ? '<button data-act="indent">缩进一级</button>' : '',
        listLike ? '<button data-act="outdent">减少缩进</button>' : '',
        hasTask ? '<button data-act="check">全部勾选</button>' : '',
        hasTask ? '<button data-act="uncheck">全部取消勾选</button>' : '',
      ].join('');
      this.placeMenu(m2, x, y);
      this._menuEl = m2;
      m2.addEventListener('mousedown', (ev) => ev.preventDefault());
      m2.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button');
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === 'type') { this.openTypeSubMenu(picked, btn); return; }
        this.closeBlockMenu();
        if (act === 'copy' || act === 'cut') {
          const clip = window.tuyu && window.tuyu.clipboard;
          if (clip) clip.write(this.selectedText());
        }
        if (act === 'del' || act === 'cut') this.deleteSelectedBlocks();
        else if (act === 'indent') this.indentBlocks(picked, 1);
        else if (act === 'outdent') this.indentBlocks(picked, -1);
        else if (act === 'check') this.setTasksDone(picked, true);
        else if (act === 'uncheck') this.setTasksDone(picked, false);
      });
      const typeBtn2 = m2.querySelector('[data-act="type"]');
      if (typeBtn2) typeBtn2.addEventListener('mouseenter', () => this.openTypeSubMenu(picked, typeBtn2));
      setTimeout(() => window.addEventListener('pointerdown', this._closeMenuOnOutside, true), 0);
      return;
    }
    const isCodeBlock = Boolean(this._blocks[index] && this._blocks[index].type === 'code');
    const menu = document.createElement('div');
    menu.className = 'blk-menu';
    menu.innerHTML = [
      '<button data-act="cut">剪切</button>',
      image
        ? '<button data-act="copy-image">复制图片</button><button data-act="copy-ref">复制图片引用</button>'
        : '<button data-act="copy">复制</button>',
      '<button data-act="paste">粘贴</button>',
      '<button data-act="select">全选</button>',
      isCodeBlock ? '<button data-act="copy-code">复制代码</button>' : '',
      '<div class="sep"></div>',
      '<button data-act="type" class="has-sub">转为<span class="sub-arrow">▸</span></button>',
      '<button data-act="del">删除这一块</button>',
    ].join('');
    this.placeMenu(menu, x, y);
    this._menuEl = menu;

    menu.addEventListener('mousedown', (ev) => ev.preventDefault());
    menu.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'type') { this.openTypeSubMenu(index, btn); return; }
      this.closeBlockMenu();
      if (act === 'cut') this.cutBlock(index);
      else if (act === 'copy') this.copyBlock(index);
      else if (act === 'copy-image') this.copyImageElement(image, index);
      else if (act === 'copy-ref') {
        const clip = window.tuyu && window.tuyu.clipboard;
        if (clip) clip.write(this.blockText(index));
      } else if (act === 'copy-code') {
        const clip = window.tuyu && window.tuyu.clipboard;
        if (clip) clip.write(this.blockText(index));
      } else if (act === 'paste') this.pasteBlock(index);
      else if (act === 'select') this.selectBlock(index);
      else if (act === 'del') this.removeBlock(index);
    });
    const typeBtn = menu.querySelector('[data-act="type"]');
    typeBtn.addEventListener('mouseenter', () => this.openTypeSubMenu(index, typeBtn));

    setTimeout(() => {
      window.addEventListener('pointerdown', this._closeMenuOnOutside, true);
    }, 0);
  }

  /** 拖选多行文字后的右键菜单：可批量转类型 / 缩进 / 勾选，不提供"删除整块" */
  openTextSelectionMenu(picked, x, y) {
    const listLike = picked.some((i) => ['bullet', 'num', 'task'].includes(this._blocks[i] && this._blocks[i].type));
    const hasTask = picked.some((i) => this._blocks[i] && this._blocks[i].type === 'task');
    const menu = document.createElement('div');
    menu.className = 'blk-menu';
    menu.innerHTML = [
      '<button data-act="copy-text">复制所选文字</button>',
      '<div class="sep"></div>',
      '<button data-act="type" class="has-sub">转为选中 ' + picked.length + ' 块<span class="sub-arrow">▸</span></button>',
      listLike ? '<button data-act="indent">缩进一级</button>' : '',
      listLike ? '<button data-act="outdent">减少缩进</button>' : '',
      hasTask ? '<button data-act="check">全部勾选</button>' : '',
      hasTask ? '<button data-act="uncheck">全部取消勾选</button>' : '',
    ].join('');
    this.placeMenu(menu, x, y);
    this._menuEl = menu;
    menu.addEventListener('mousedown', (ev) => ev.preventDefault());
    menu.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'type') { this.openTypeSubMenu(picked, btn); return; }
      this.closeBlockMenu();
      if (act === 'copy-text') {
        const clip = window.tuyu && window.tuyu.clipboard;
        if (clip) clip.write(this.selectedText());
      } else if (act === 'indent') this.indentBlocks(picked, 1);
      else if (act === 'outdent') this.indentBlocks(picked, -1);
      else if (act === 'check') this.setTasksDone(picked, true);
      else if (act === 'uncheck') this.setTasksDone(picked, false);
    });
    const typeBtn = menu.querySelector('[data-act="type"]');
    if (typeBtn) typeBtn.addEventListener('mouseenter', () => this.openTypeSubMenu(picked, typeBtn));
    setTimeout(() => window.addEventListener('pointerdown', this._closeMenuOnOutside, true), 0);
  }

  /** 「转为」子菜单：跟在右键菜单右边。target 可以是单块下标，也可以是选中块数组。 */
  openTypeSubMenu(target, anchor) {
    if (this._subEl) { this._subEl.remove(); this._subEl = null; }
    const items = [
      ['p', '正文'], ['h1', '标题 1'], ['h2', '标题 2'], ['h3', '标题 3'],
      ['bullet', '无序列表'], ['num', '有序列表'], ['task', '待办'],
      ['quote', '引用'], ['code', '代码块'], ['math', '公式'], ['hr', '分割线'],
    ];
    const sub = document.createElement('div');
    sub.className = 'blk-menu slash sub';
    if (Array.isArray(target) && target.length > 1) sub.dataset.batch = '1';
    sub.innerHTML = items.map(([t, label]) => '<button data-type="' + t + '">' + label + '</button>').join('');
    this.placeSubMenu(sub, anchor);
    this._subEl = sub;
    sub.addEventListener('mousedown', (ev) => ev.preventDefault());
    sub.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      const type = btn.dataset.type;
      this.closeBlockMenu();
      if (Array.isArray(target)) this.convertBlocks(target, type);
      else this.convertBlock(target, type);
    });
  }

  /** 多块一起改类型：先把每块原文取出来，再统一落数据、一次写回 */
  convertBlocks(indexes, type) {
    if (!this.note) return;
    const idxs = [...new Set(indexes)]
      .filter((i) => Number.isInteger(i) && this._blocks[i])
      .sort((a, b) => a - b);
    if (!idxs.length) return;
    const textOf = (b) => (['code', 'math', 'table'].includes(b.type)
      ? String(b.src || '')
      : String(b.inline || ''));
    const tableDefault = '| 列 1 | 列 2 |\n| --- | --- |\n|  |  |';

    for (const i of idxs) {
      const b = this._blocks[i];
      if (!b) continue;
      const text = textOf(b);
      const wasCode = b.type === 'code';
      const wasTable = b.type === 'table';
      if (type === 'code') {
        b.type = 'code';
        b.src = text;
        if (!wasCode) b.lang = '';
        delete b.inline; delete b.done; delete b.num; delete b.depth;
        continue;
      }
      if (type === 'math') {
        b.type = 'math';
        b.src = text;
        delete b.inline; delete b.done; delete b.num; delete b.depth;
        continue;
      }
      if (type === 'table') {
        b.type = 'table';
        b.src = (wasTable && b.src) ? b.src : (text.includes('|') ? text : tableDefault);
        delete b.inline; delete b.done; delete b.num; delete b.depth;
        continue;
      }
      if (type === 'hr') {
        b.type = 'hr';
        delete b.inline; delete b.src; delete b.lang; delete b.done; delete b.num; delete b.depth;
        continue;
      }
      b.type = type;
      b.inline = text;
      delete b.src; delete b.lang;
      if (type === 'num') b.num = 1; else delete b.num;
      if (type === 'task') b.done = false; else delete b.done;
      if (['bullet', 'num', 'task'].includes(type)) b.depth = b.depth || 0;
      else delete b.depth;
    }
    this.writeBack();
    this.renderBlocks();
    this._lastEdit = idxs[0];
    for (const i of idxs) {
      const b = this._blocks[i];
      if (b && b.type === 'code' && !b.lang) this.scheduleAutoLanguage(i, 0);
    }
  }

  /** 多块一起缩进 / 反缩进（只作用于列表类块） */
  indentBlocks(indexes, delta) {
    const idxs = [...new Set(indexes)].filter((i) => this._blocks[i]);
    let changed = false;
    for (const i of idxs) {
      const b = this._blocks[i];
      if (!b || !['bullet', 'num', 'task'].includes(b.type)) continue;
      const next = Math.max(0, Math.min(6, (b.depth || 0) + delta));
      if (next === (b.depth || 0)) continue;
      b.depth = next;
      changed = true;
    }
    if (!changed) return;
    this.writeBack();
    this.renderBlocks();
    this._lastEdit = idxs[0];
  }

  /** 多块一起勾选 / 取消勾选（只作用于待办块） */
  setTasksDone(indexes, done) {
    const idxs = [...new Set(indexes)].filter((i) => this._blocks[i]);
    let changed = false;
    for (const i of idxs) {
      const b = this._blocks[i];
      if (!b || b.type !== 'task' || Boolean(b.done) === done) continue;
      b.done = done;
      changed = true;
    }
    if (!changed) return;
    this.writeBack();
    this.renderBlocks();
    this._lastEdit = idxs[0];
  }

  /** 这一块的纯文本（没选区时当作"整块"） */
  blockText(index) {
    const blk = this._blocks[index];
    if (!blk) return '';
    if (blk.type === 'code') return blk.src || '';
    const txt = this.editableEl(index);
    return txt ? htmlToInline(txt.innerHTML) : '';
  }

  selectBlock(index) {
    const blk = this._blocks[index];
    if (blk && blk.type === 'code') {
      const ta = this.codeInput(index);
      if (!ta) return;
      this.focusCode(index, 'end');
      ta.select();
      this._focus = index;
      return;
    }
    const txt = this.editableEl(index);
    if (!txt) return;
    txt.focus();
    const range = document.createRange();
    range.selectNodeContents(txt);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    this._focus = index;
  }

  /** 代码块里没拖动选区时，复制 / 剪切按"整块"处理 */
  codePicked(index) {
    const ta = this.codeInput(index);
    if (!ta || document.activeElement !== ta) return '';
    if (ta.selectionStart === ta.selectionEnd) return '';
    return ta.value.slice(ta.selectionStart, ta.selectionEnd);
  }

  async copyBlock(index) {
    const pickedCode = this.codePicked(index);
    const sel = window.getSelection();
    const picked = pickedCode || (sel && !sel.isCollapsed ? sel.toString() : '');
    const clip = window.tuyu && window.tuyu.clipboard;
    if (clip) await clip.write(picked || this.blockText(index));
  }

  /** 复制图片本身到系统剪贴板；失败时退回复制 ![[文件名]] 引用 */
  async copyImageElement(img, index) {
    const clip = window.tuyu && window.tuyu.clipboard;
    if (!clip) return false;
    let ok = false;
    try {
      if (img && typeof clip.copyImageAt === 'function') {
        const r = img.getBoundingClientRect();
        ok = await clip.copyImageAt(
          Math.round(r.left + r.width / 2),
          Math.round(r.top + r.height / 2),
        );
        if (ok && typeof clip.hasImage === 'function') ok = await clip.hasImage();
      }
    } catch (_e) { /* 剪贴板不支持图片时退回文本 */ }
    if (!ok && typeof clip.write === 'function') {
      await clip.write(this.blockText(Number.isInteger(index) ? index : this._focus));
    }
    return ok;
  }

  async cutBlock(index) {
    const pickedCode = this.codePicked(index);
    const sel = window.getSelection();
    const picked = pickedCode || (sel && !sel.isCollapsed ? sel.toString() : '');
    const clip = window.tuyu && window.tuyu.clipboard;
    if (clip) await clip.write(picked || this.blockText(index));
    const blk = this._blocks[index];
    if (blk && blk.type === 'code') {
      const ta = this.codeInput(index);
      if (!ta) return;
      if (pickedCode) {
        ta.setRangeText('', ta.selectionStart, ta.selectionEnd, 'end');
        this.onCodeInput(ta);
      } else {
        ta.value = '';
        this.onCodeInput(ta);
      }
      return;
    }
    const txt = this.editableEl(index);
    if (!txt) return;
    if (picked) {
      document.execCommand('delete');
    } else {
      txt.textContent = '';
      this.writeBack();
      this.renderBlocks();
    }
    this.syncInline(index);
  }

  async pasteBlock(index) {
    const clip = window.tuyu && window.tuyu.clipboard;
    if (!clip) return;
    const text = await clip.read();
    if (!text) return;
    this.focusBlock(index, 'end');
    this.insertIntoEditable(text);
    const blk = this._blocks[index];
    if (blk && blk.type !== 'code') this.syncInline(index);
  }

  onPreviewKey(e) {
    const source = e.target;
    if (source && source.classList && source.classList.contains('code-input')) {
      this.onCodeKey(e, source);
      return;
    }
    if (source && source.classList && source.classList.contains('code-lang')) {
      this.onLangKey(e, source);
      return;
    }
    const txt = (e.target.closest && e.target.closest('.blk-txt'))
      || this.currentBlockEl()
      || (this._focus != null ? this.editableEl(this._focus) : null);
    const ta = e.target;
    if (ta.classList && ta.classList.contains('blk-editor')) {
      // 源码块（代码/公式/表格）里回车是换行；Ctrl+回车才在下面另起一块
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const at = this._sourceIndex;
        this.commitSource();
        this.appendAfter(at);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); this.commitSource(); }
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = ta.selectionStart;
        ta.value = ta.value.slice(0, start) + '  ' + ta.value.slice(ta.selectionEnd);
        ta.selectionStart = ta.selectionEnd = start + 2;
        this.onSourceInput({ target: ta });
      }
      return;
    }
    if (!txt) {
      // 选区端点直接落在宿主上（Ctrl+A 全选 / 从块外拖进来）：这种也要能删、能剪
      if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'X') && this.deleteSelectedContent({ copy: true })) {
        e.preventDefault();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.deleteSelectedContent()) {
        e.preventDefault();
        return;
      }
      return;
    }
    const index = Number(txt.closest('.blk').dataset.i);
    // 图片是 contenteditable 里的"原子"，浏览器默认的退格/删除经常不动它，
    // 所以这里自己处理：图片块直接清掉图片，图文混排就删光标旁边那张。
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const dir = e.key === 'Backspace' ? -1 : 1;
      // 整段选中 / 拖选到图片时，浏览器经常只删文字不删图片；自己删。
      const picked = window.getSelection();
      if (picked && !picked.isCollapsed && picked.rangeCount) {
        const range = picked.getRangeAt(0);
        if (txt.contains(range.startContainer) && txt.contains(range.endContainer)) {
          const frag = range.cloneContents();
          if (frag.querySelector && frag.querySelector('img.note-img')) {
            e.preventDefault();
            const offset = this._offIn(txt, range.startContainer, range.startOffset);
            range.deleteContents();
            this.syncInline(index);
            this.caretAtOffset(index, Math.max(0, offset));
            return;
          }
        }
      }
      if (this.isImageOnlyBlock(txt)) {
        e.preventDefault();
        const imgs = [...txt.querySelectorAll('img.note-img')];
        if (imgs.length) {
          for (const img of imgs) img.remove();
          this.syncInline(index);
          this.caretAt(index, 'start');
        }
        return;
      }
      const img = this.adjacentImage(txt, dir);
      if (img) {
        e.preventDefault();
        this.deleteInlineImage(index, img, txt);
        return;
      }
    }
    // Ctrl+Shift+K：当前段变成代码块（Typora 的「代码围栏」快捷键）
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.convertBlock(index, 'code');
      return;
    }
    // 回车 = 拆块；Shift+回车 = 同一块内软换行
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // 段首只写了 ``` / ```js：回车变代码块，光标进代码里
      if (this.tryFenceConvert(txt)) { e.preventDefault(); return; }
      e.preventDefault();
      this.splitAtCaret();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'X')) {
      if (this.deleteSelectedContent({ copy: true })) { e.preventDefault(); return; }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.shiftKey && this.deleteSelectedContent()) {
      e.preventDefault();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this._sel.size > 1) {
      e.preventDefault();
      this.deleteSelectedBlocks();
      return;
    }
    if (e.key === 'Backspace' && this.caretAtBlockStart(txt)) {
      e.preventDefault();
      this.mergeUp();
      return;
    }
    // Tab / Shift+Tab：列表缩进、反缩进（Notion 的子项）
    if (e.key === 'Tab') {
      e.preventDefault();
      this.indentBlock(index, e.shiftKey ? -1 : 1);
      return;
    }
    // ↑ / ↓ 在块边界上跨块移动光标
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && sel.isCollapsed) {
        const r = sel.getRangeAt(0);
        const before = r.cloneRange();
        before.selectNodeContents(txt);
        before.setEnd(r.startContainer, r.startOffset);
        const atStart = before.toString().length === 0;
        const after = r.cloneRange();
        after.selectNodeContents(txt);
        after.setStart(r.endContainer, r.endOffset);
        const atEnd = after.toString().length === 0;
        if (e.key === 'ArrowUp' && atStart && index > 0) {
          e.preventDefault();
          this.focusBlock(index - 1, 'end');
          return;
        }
        if (e.key === 'ArrowDown' && atEnd && index < this._blocks.length - 1) {
          e.preventDefault();
          this.focusBlock(index + 1, 'start');
          return;
        }
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      this.flush();
      if (this.hooks.onEscape) this.hooks.onEscape();
    }
  }

  // ---------------------------------------------------------------- 代码块按键（对齐 Typora）
  /** 光标在第几行（选区非空时不判断首/末行） */
  codeCaretLine(ta) {
    const value = ta.value;
    const count = value.split('\n').length;
    if (ta.selectionStart !== ta.selectionEnd) return { line: 0, count, first: false, last: false };
    const line = value.slice(0, ta.selectionStart).split('\n').length - 1;
    return { line, count, first: line === 0, last: line === count - 1 };
  }

  /** 在 textarea 里替换一段文字；优先用 execCommand，保住浏览器原生撤销 */
  replaceCodeRange(ta, start, end, text) {
    ta.focus();
    ta.setSelectionRange(start, end);
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (_e) { ok = false; }
    if (!ok) {
      ta.setRangeText(text, start, end, 'end');
      this.onCodeInput(ta);
    }
    ta.scrollLeft = Math.max(0, Math.min(ta.scrollLeft, ta.scrollWidth));
    this.syncCodeScroll(ta);
  }

  /** 代码里回车：换行 + 自动缩进（2 个空格；开头是 { [ ( : 时多缩一级） */
  codeNewline(ta) {
    const value = ta.value;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const before = value.slice(lineStart, start);
    const lead = (/^[ \t]*/.exec(before) || [''])[0];
    const lineEnd = value.indexOf('\n', end);
    const rest = value.slice(end, lineEnd < 0 ? value.length : lineEnd);
    const trimmed = before.replace(/[ \t]+$/, '');
    const closes = /^[ \t]*[}\])]/.test(rest);
    const opens = /[{[(]$/.test(trimmed) || /:$/.test(trimmed);
    const extra = opens && !closes ? INDENT_UNIT : '';
    // 同一行光标后面就是 } / ) / ]：把它的缩进一起收回来，和上一行对齐
    const closeLead = closes ? (/^[ \t]*/.exec(rest) || [''])[0].length : 0;
    this.replaceCodeRange(ta, start, end + closeLead, '\n' + lead + extra);
  }

  /** Tab：手按一下就是一个制表符；有选区时给每一行加一个；Shift+Tab 退一级 */
  codeIndent(ta, forward) {
    const value = ta.value;
    let start = ta.selectionStart;
    let end = ta.selectionEnd;

    if (start === end) {
      if (forward) { this.replaceCodeRange(ta, start, end, TAB_CHAR); return; }
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const lead = value.slice(lineStart);
      const tabRun = /^\t+/.exec(lead);
      let remove = 0;
      if (tabRun) remove = 1;
      else remove = Math.min(INDENT_UNIT.length, (/^ +/.exec(lead) || [''])[0].length);
      if (!remove) return;
      this.replaceCodeRange(ta, lineStart, lineStart + remove, '');
      const pos = Math.max(lineStart, start - remove);
      ta.setSelectionRange(pos, pos);
      return;
    }

    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = value.indexOf('\n', end);
    if (lineEnd < 0) lineEnd = value.length;
    // 选区正好停在下一行行首：不要把那一行也缩进
    if (end > lineStart && value[end - 1] === '\n') lineEnd = end - 1;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    let changed = 0;
    let firstDelta = 0;
    const next = lines.map((line, i) => {
      if (forward) {
        const d = TAB_CHAR.length;
        changed += d;
        if (i === 0) firstDelta = d;
        return TAB_CHAR + line;
      }
      const tab = /^\t/.exec(line);
      const spaces = tab ? null : (/^ +/.exec(line) || [''])[0];
      const d = tab ? 1 : Math.min(INDENT_UNIT.length, spaces.length);
      changed += d;
      if (i === 0) firstDelta = d;
      if (!d) return line;
      return line.slice(d);
    });
    if (!changed) return;
    this.replaceCodeRange(ta, lineStart, lineEnd, next.join('\n'));
    const newStart = Math.max(lineStart, start + (forward ? firstDelta : -firstDelta));
    const newEnd = Math.max(newStart, end + (forward ? changed : -changed));
    ta.setSelectionRange(newStart, newEnd);
  }

  /** ↑ / ↓ 在首行 / 末行时离开代码块。Typora 会补一个空段落，这里照做。 */
  exitCode(index, dir) {
    const at = index + dir;
    const neighbor = this._blocks[at];
    const atomic = neighbor && (neighbor.type === 'code' || SOURCE_BLOCKS.includes(neighbor.type));
    if (neighbor && !atomic) {
      this.focusBlock(at, dir > 0 ? 'start' : 'end');
      return;
    }
    const insertAt = dir > 0 ? index + 1 : index;
    this._blocks.splice(insertAt, 0, { type: 'p', inline: '', depth: 0 });
    this.writeBack();
    this.renderBlocks();
    this.focusBlock(insertAt, dir > 0 ? 'start' : 'end');
  }

  /** Ctrl+Enter：在代码块下面另起一个普通段落 */
  exitCodeToParagraph(index) {
    this._blocks.splice(index + 1, 0, { type: 'p', inline: '', depth: 0 });
    this.writeBack();
    this.renderBlocks();
    this.focusBlock(index + 1, 'start');
  }

  /** 代码块行首退格：拆掉代码围栏 */
  removeCodeFence(index) {
    const blk = this._blocks[index];
    if (!blk || blk.type !== 'code') return;
    const src = String(blk.src || '');
    if (!src) {
      this._blocks.splice(index, 1);
      if (!this._blocks.length) this._blocks.push({ type: 'empty', inline: '' });
      this.writeBack({ forceHistory: true });
      this.renderBlocks();
      this.focusBlock(Math.max(0, Math.min(index - 1, this._blocks.length - 1)), 'end');
      return;
    }
    // 并进上一块：代码文字变成上一块的软换行
    if (index > 0 && !SOURCE_BLOCKS.includes(this._blocks[index - 1].type)) {
      const prev = this._blocks[index - 1];
      if (prev.type === 'code') {
        const join = String(prev.src || '').length;
        prev.src = (prev.src ? prev.src + '\n' : '') + src;
        this._blocks.splice(index, 1);
        this.writeBack({ forceHistory: true });
        this.renderBlocks();
        this.focusCode(index - 1, 'end');
        const ta = this.codeInput(index - 1);
        if (ta) { ta.setSelectionRange(join, join); this.syncCodeScroll(ta); }
        return;
      }
      if (prev.type === 'empty') { prev.type = 'p'; prev.inline = ''; }
      const join = String(prev.inline || '').length;
      prev.inline = (prev.inline ? prev.inline + '\n' : '') + src;
      this._blocks.splice(index, 1);
      this.writeBack({ forceHistory: true });
      this.renderBlocks();
      this.caretAtOffset(index - 1, join);
      return;
    }
    // 没有可并的上一块：代码块就地变成普通段落
    blk.type = 'p';
    blk.inline = src;
    delete blk.src;
    delete blk.lang;
    this.writeBack({ forceHistory: true });
    this.renderBlocks();
    this.caretAtOffset(index, 0);
  }

  onCodeKey(e, ta) {
    if (e.isComposing || e.keyCode === 229) return;   // 输入法组合中不抢键
    const index = this.codeIndex(ta);
    if (index < 0) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;

    if (key === 'Enter') {
      if (ctrl) { e.preventDefault(); this.exitCodeToParagraph(index); return; }
      if (e.altKey) return;
      // 已经在「末尾空行」上再按回车：说明用户想离开代码块往下写，
      // 而不是继续堆空行（Typora 用 ↓，这里给 Enter 一个直觉出口）。
      const info = this.codeCaretLine(ta);
      const lastLine = ta.value.split('\n')[info.count - 1] || '';
      if (!e.shiftKey && info.last && !lastLine.trim() && ta.value.trim()
        && ta.selectionStart === ta.selectionEnd) {
        e.preventDefault();
        this.exitCode(index, 1);
        return;
      }
      e.preventDefault();
      this.codeNewline(ta);
      return;
    }
    if (key === 'Tab') {
      // Ctrl+Tab 留给应用切图；只有裸 Tab / Shift+Tab 才是缩进
      if (ctrl || e.altKey) return;
      e.preventDefault();
      this.codeIndent(ta, !e.shiftKey);
      return;
    }
    // Typora：Ctrl+[ 缩进、Ctrl+] 反缩进
    if (ctrl && (key === '[' || key === ']')) {
      e.preventDefault();
      this.codeIndent(ta, key === '[');
      return;
    }
    if (!ctrl && !e.altKey && !e.shiftKey) {
      const info = this.codeCaretLine(ta);
      if (key === 'ArrowUp' && info.first) { e.preventDefault(); this.exitCode(index, -1); return; }
      if (key === 'ArrowDown' && info.last) { e.preventDefault(); this.exitCode(index, 1); return; }
    }
    if ((key === 'Backspace' || key === 'Delete')
      && ta.selectionStart === 0 && ta.selectionEnd === 0
      && !ta.value.trim()) {
      e.preventDefault();
      this.removeEmptyCodeBlock(index);
      return;
    }
    if (key === 'Backspace' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      // 非空代码块的块首退格不拆围栏
      e.preventDefault();
    }
  }

  // ---------------------------------------------------------------- 自动识别代码语言
  clearAutoLangTimers() {
    for (const timer of this._autoLangTimers.values()) clearTimeout(timer);
    this._autoLangTimers.clear();
  }

  /** 停手 650ms 后按内容猜语言；只猜空语言或上一次自动猜出来的语言，
   *  用户手动选过的语言绝不覆盖。 */
  scheduleAutoLanguage(index, delay = AUTO_LANG_DELAY) {
    const blk = this._blocks[index];
    if (!blk || blk.type !== 'code' || blk.langTouched) return;
    if (blk.lang && !blk.langAuto) return;
    const old = this._autoLangTimers.get(index);
    if (old) clearTimeout(old);
    const timer = setTimeout(() => {
      this._autoLangTimers.delete(index);
      const cur = this._blocks[index];
      if (cur !== blk || !cur || cur.type !== 'code' || cur.langTouched) return;
      if (this._langMenu) return;                       // 用户正在语言列表里挑
      const active = document.activeElement;
      if (active && active.classList && active.classList.contains('code-lang')) return;
      if (cur.lang && !cur.langAuto) return;
      const src = String(cur.src || '');
      if (src.trim().length < 8) return;
      const lang = detectLanguage(src);
      if (!lang || lang === cur.lang) return;
      cur.lang = lang;
      cur.langAuto = true;
      this.writeBack();
      this.refreshCode(index);
    }, delay);
    this._autoLangTimers.set(index, timer);
  }

  // ---------------------------------------------------------------- 代码语言（Typora 右下角的小输入框）
  onLangFocus(blkEl, input) {
    if (this._langMenu && this._langAnchor === input) return;
    this.closeBlockMenu();
    const index = Number(blkEl.dataset.i);
    this._focus = index;
    this._lastEdit = index;
    this.markCurrent(blkEl);
    const ta = this.codeInput(index);
    this._langCaret = ta
      ? { index, start: ta.selectionStart, end: ta.selectionEnd, left: ta.scrollLeft }
      : null;
    input.select();
    // 鼠标按下时浏览器随后还会把光标落到点击处，下一拍再全选一次
    setTimeout(() => {
      if (document.activeElement === input) input.select();
    }, 0);
    this.openLangMenu(index, input, '');
  }

  onLangBlur(index, input) {
    if (!input.isConnected) return;
    this.commitLang(index, input.value, false);
  }

  onLangKey(e, input) {
    const index = this.codeIndex(input);
    if (index < 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this._langMenu) this.openLangMenu(index, input, '');
      const count = this._langFiltered.length;
      if (!count) return;
      if (e.key === 'ArrowDown') this._langIndex = Math.min(count - 1, this._langIndex + 1);
      else this._langIndex = this._langIndex <= 0 ? count - 1 : this._langIndex - 1;
      this.paintLangMenu();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = this._langIndex >= 0 && this._langFiltered[this._langIndex] != null
        ? this._langFiltered[this._langIndex]
        : input.value;
      this.commitLang(index, value, true);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      const blk = this._blocks[index];
      input.value = blk ? (blk.lang || '') : '';
      this.closeLangMenu();
      this.restoreCodeCaret(index);
      return;
    }
    if (e.key === 'Tab') {
      // 焦点要移走：先把输入框里的语言落下去
      this.commitLang(index, input.value, false);
    }
  }

  openLangMenu(index, anchor, query = '') {
    this.closeLangMenu();
    const codeTa = this.codeInput(index);
    if (codeTa) {
      this._langCaret = {
        index, start: codeTa.selectionStart, end: codeTa.selectionEnd, left: codeTa.scrollLeft,
      };
    }
    this._langFiltered = this.filteredLanguages(query);
    // 打开时先停在当前语言上；按 ↓ / ↑ 再移动
    this._langIndex = -1;
    const raw = (this._blocks[index] && this._blocks[index].lang) || '';
    const current = normalizeLang(raw) || raw;
    if (current) {
      const at = this._langFiltered.indexOf(current);
      if (at >= 0) this._langIndex = at;
    }
    const menu = document.createElement('div');
    menu.className = 'blk-menu code-lang-menu';
    document.body.appendChild(menu);
    this._langMenu = menu;
    this._langAnchor = anchor;
    menu.addEventListener('mousedown', (ev) => ev.preventDefault());
    menu.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      this.commitLang(index, btn.dataset.lang, true);
    });
    const rect = anchor.getBoundingClientRect();
    const width = 190;
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(6, Math.min(window.innerWidth - width - 6, rect.left))}px`;
    menu.style.top = `${Math.min(window.innerHeight - 40, rect.bottom + 2)}px`;
    this.paintLangMenu();
    const h = menu.offsetHeight;
    if (rect.bottom + 2 + h > window.innerHeight - 6) {
      menu.style.top = `${Math.max(6, rect.top - h - 2)}px`;
    }
    const outside = (ev) => {
      if (menu.contains(ev.target) || ev.target === anchor) return;
      const own = anchor.closest && anchor.closest('.blk');
      const idx = own ? Number(own.dataset.i) : -1;
      const value = anchor.value;
      this.closeLangMenu();
      if (idx >= 0) this.commitLang(idx, value, false);
    };
    this._langOutside = outside;
    setTimeout(() => {
      if (this._langMenu === menu) window.addEventListener('pointerdown', outside, true);
    }, 0);
  }

  filteredLanguages(query) {
    const q = String(query == null ? '' : query).trim().toLowerCase();
    const list = searchLanguages(q);
    const out = [''].concat(list);
    // 输入了一个列表里完全没有的语言：允许直接用它
    if (q && !list.length) out.push(q);
    return out;
  }

  paintLangMenu() {
    const menu = this._langMenu;
    if (!menu) return;
    menu.innerHTML = this._langFiltered.map((lang, i) => {
      const label = lang || '纯文本';
      const cls = [i === this._langIndex ? 'active' : '', lang ? '' : 'lang-none']
        .filter(Boolean).join(' ');
      return `<button data-lang="${escapeHtml(lang)}" class="${cls}">${escapeHtml(label)}</button>`;
    }).join('') || '<button class="lang-none" disabled>没有匹配的语言</button>';
    const active = menu.querySelector('button.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  filterLangMenu(query) {
    if (!this._langMenu) {
      const input = document.activeElement;
      const blk = input && input.closest ? input.closest('.blk') : null;
      if (blk) this.openLangMenu(Number(blk.dataset.i), input, query);
      return;
    }
    this._langFiltered = this.filteredLanguages(query);
    const q = String(query || '').trim().toLowerCase();
    const exact = q ? this._langFiltered.indexOf(q) : -1;
    const firstReal = this._langFiltered.findIndex((x) => x);
    this._langIndex = exact >= 0 ? exact : (q ? firstReal : -1);
    this.paintLangMenu();
  }

  restoreCodeCaret(index) {
    const caret = this._langCaret;
    if (!caret || caret.index !== index) return;
    const ta = this.codeInput(index);
    if (!ta) return;
    ta.focus();
    try { ta.setSelectionRange(caret.start, caret.end); } catch (_e) { /* ignore */ }
    ta.scrollLeft = caret.left;
    this.syncCodeScroll(ta);
    this._focus = index;
    this._lastEdit = index;
  }

  commitLang(index, value, refocus) {
    this.closeLangMenu();
    const blk = this._blocks[index];
    if (!blk || blk.type !== 'code') return;
    // 手动改过语言之后，就不再自动覆盖（哪怕用户手动清空）
    blk.langTouched = true;
    blk.langAuto = false;
    const pending = this._autoLangTimers.get(index);
    if (pending) { clearTimeout(pending); this._autoLangTimers.delete(index); }
    const lang = String(value == null ? '' : value).trim().replace(/[\s`]+/g, '');
    const changed = lang !== (blk.lang || '');
    blk.lang = lang;
    const el = this.blkEl(index);
    if (el) {
      el.dataset.lang = lang;
      const input = el.querySelector('.code-lang');
      if (input) input.value = lang;
    }
    if (changed) {
      this.writeBack();
      this.refreshCode(index);
    }
    if (refocus) this.restoreCodeCaret(index);
  }

  closeLangMenu() {
    if (this._langMenu) { this._langMenu.remove(); this._langMenu = null; }
    if (this._langOutside) {
      window.removeEventListener('pointerdown', this._langOutside, true);
      this._langOutside = null;
    }
    this._langAnchor = null;
    this._langFiltered = [];
    this._langIndex = -1;
  }

  /** 剪贴板里是否带 Markdown 的块结构；有就走 parseBlocks，别逐行拆段。 */
  looksLikeMarkdownPaste(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;
    let fence = 0;
    let hasBlock = false;
    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i];
      const line = raw.trim();
      if (fence) {
        const close = /^(`{3,})\s*$/.exec(line);
        if (close && close[1].length >= fence) fence = 0;
        continue;
      }
      const open = /^(`{3,})([^`]*)$/.exec(line);
      if (open) {
        fence = open[1].length;
        hasBlock = true;
        continue;
      }
      if (/^#{1,6}\s/.test(line)) { hasBlock = true; continue; }
      if (/^>\s?/.test(line)) { hasBlock = true; continue; }
      if (/^([-*+]|\d+\.)\s/.test(line)) { hasBlock = true; continue; }
      if (/^([-*_])(?:\s*\1){2,}\s*$/.test(line)) { hasBlock = true; continue; }
      if (/^\$\$/.test(line)) { hasBlock = true; continue; }
      if (line.includes('|') && TABLE_SEP.test(lines[i + 1] || '')) hasBlock = true;
    }
    return hasBlock;
  }

  /** 没有围栏、但明显是缩进代码的纯文本；粘到正文时不要当普通段落 trim。 */
  looksLikeCodePaste(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const nonblank = lines.filter((l) => l.trim());
    if (nonblank.length < 2) return false;
    const indented = nonblank.filter((l) => /^(?: {2,}|\t)\S/.test(l));
    if (!indented.length) return false;
    const signals = nonblank.filter((l) => /[{}();=]/.test(l)
      || /^\s*(?:#include|class|struct|public:|private:|protected:|virtual|void|int|return|if|for|while|def|function|const|let|var|import|package)\b/.test(l));
    return signals.length >= 2 || (indented.length >= 2 && /[{}]/.test(text));
  }

  /** 纯代码粘贴：整段收进一个代码块，保留所有行首空格和空行。 */
  pasteCode(text, index) {
    const blk = this._blocks[index];
    if (!blk) return;
    const block = { type: 'code', src: text, lang: detectLanguage(text) || '' };
    const replace = !String(blk.inline || '').trim();
    if (replace) this._blocks.splice(index, 1, block);
    else this._blocks.splice(index + 1, 0, block);
    this.writeBack({ forceHistory: true });
    this.renderBlocks();
    this.focusBlock(replace ? index : index + 1, 'end');
  }

  /** Markdown-aware 粘贴：保留代码围栏、表格、标题和围栏内部的空行。 */
  pasteMarkdown(text, index) {
    const blk = this._blocks[index];
    if (!blk) return;
    const blocks = parseBlocks(text);
    while (blocks.length && blocks[0].type === 'empty') blocks.shift();
    while (blocks.length && blocks[blocks.length - 1].type === 'empty') blocks.pop();
    if (!blocks.length) return;
    const replace = !String(blk.inline || '').trim();
    if (replace) this._blocks.splice(index, 1, ...blocks);
    else this._blocks.splice(index + 1, 0, ...blocks);
    this.writeBack({ forceHistory: true });
    this.renderBlocks();
    this.focusBlock(replace ? index + blocks.length - 1 : index + blocks.length, 'end');
  }

  onPreviewPaste(e) {
    if (!this.note) return;
    const file = this.imageFileOf(e.clipboardData);
    if (file) { e.preventDefault(); this.attachImage(file); return; }
    // 富文本块里只接受纯文本，别把外部的花样式带进来
    let txt = e.target.closest && e.target.closest('.blk-txt');
    if (!txt && e.target === this.dom.preview) {
      const cur = this.currentBlockEl();
      if (cur && cur.classList && cur.classList.contains('blk-txt')) txt = cur;
      if (!txt && this._focus != null) txt = this.editableEl(this._focus);
    }
    if (!txt) return;
    e.preventDefault();
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (!text) return;
    const index = Number(txt.closest('.blk').dataset.i);
    // 带 Markdown 结构的整段内容：交给 parseBlocks，别按行拆成 p
    if (text.includes('\n') && this.looksLikeMarkdownPaste(text)) {
      this.pasteMarkdown(text, index);
      return;
    }
    // 没有围栏的纯代码：整段建代码块，避免段落 parse 时 trim 掉行首空格
    if (text.includes('\n') && this.looksLikeCodePaste(text)) {
      this.pasteCode(text, index);
      return;
    }
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    // 普通多行文本 → 照旧逐行拆成多个块
    if (lines.length > 1) {
      const blk = this._blocks[index];
      if (!blk) return;
      const rest = lines.filter((l) => l.trim() !== '');
      if (rest.length) {
        blk.inline = [blk.inline, rest[0]].filter(Boolean).join(' ');
        const created = rest.slice(1).map((l) => ({ type: 'p', inline: l, depth: 0 }));
        this._blocks.splice(index + 1, 0, ...created);
        this.writeBack();
        this.renderBlocks();
        this.focusBlock(index + created.length, 'end');
        return;
      }
    }
    this.insertIntoEditable(text);
  }

  /** Tab / Shift+Tab：列表块缩进 / 反缩进 */
  indentBlock(index, delta) {
    const blk = this._blocks[index];
    if (!blk) return;
    const listLike = ['bullet', 'num', 'task'].includes(blk.type);
    if (!listLike) return;                 // 普通段落不缩进（保持行为可预期）
    const next = Math.max(0, Math.min(6, (blk.depth || 0) + delta));
    if (next === (blk.depth || 0)) return;
    blk.depth = next;
    this.writeBack();
    this.renderBlocks();
    this.focusBlock(index, 'end');
  }

  onPreviewDragOver(e) {
    if (this.imageFileOf(e.dataTransfer)) e.preventDefault();
  }

  onPreviewDrop(e) {
    if (!this.note) return;
    const file = this.imageFileOf(e.dataTransfer);
    if (!file) return;
    e.preventDefault();
    this.attachImage(file);
  }

  // ---------------------------------------------------------------- 手柄 / 菜单
  openBlockMenu(index, anchor) {
    this.closeBlockMenu();
    const rect = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'blk-menu';
    menu.innerHTML = [
      '<button data-act="up">上移一块</button>',
      '<button data-act="down">下移一块</button>',
      '<button data-act="dup">复制一块</button>',
      '<button data-act="del">删除这一块</button>',
    ].join('');
    this.placeMenu(menu, rect.left - 120, rect.top);
    this._menuEl = menu;
    menu.addEventListener('mousedown', (ev) => ev.preventDefault());
    menu.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      const act = btn.dataset.act;
      this.closeBlockMenu();
      if (act === 'up') this.moveBlock(index, -1);
      else if (act === 'down') this.moveBlock(index, 1);
      else if (act === 'dup') this.duplicateBlock(index);
      else if (act === 'del') this.removeBlock(index);
    });
    setTimeout(() => {
      window.addEventListener('pointerdown', this._closeMenuOnOutside, true);
    }, 0);
  }

  closeBlockMenu() {
    if (this._subEl) { this._subEl.remove(); this._subEl = null; }
    if (this._menuEl) { this._menuEl.remove(); this._menuEl = null; }
    if (this._closeMenuOnOutside) {
      window.removeEventListener('pointerdown', this._closeMenuOnOutside, true);
    }
  }

  openSlashMenu(index, anchorRect) {
    this.closeBlockMenu();
    const items = [
      ['p', '正文'], ['h1', '标题 1'], ['h2', '标题 2'], ['h3', '标题 3'],
      ['bullet', '无序列表'], ['num', '有序列表'], ['task', '待办'],
      ['quote', '引用'], ['code', '代码块'], ['math', '公式'], ['hr', '分割线'],
    ];
    const menu = document.createElement('div');
    menu.className = 'blk-menu slash';
    menu.innerHTML = items.map(([t, label]) => `<button data-type="${t}">${label}</button>`).join('');
    this.placeMenu(menu, anchorRect.left, anchorRect.bottom + 4);
    this._menuEl = menu;
    menu.addEventListener('mousedown', (ev) => ev.preventDefault());
    menu.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      this.closeBlockMenu();
      this.convertBlock(index, btn.dataset.type);
    });
    setTimeout(() => {
      window.addEventListener('pointerdown', this._closeMenuOnOutside, true);
    }, 0);
  }

  // ---------------------------------------------------------------- 编辑
  onTitleInput() {
    if (!this.note) return;
    clearTimeout(this._titleTimer);
    // 空着就什么都别做：既不改笔记，也别把旧标题写回输入框。
    // （以前这里 500ms 后跑 commitTitle，见空就恢复旧标题，删字删到空就"弹回来"）
    if (!this.dom.title.value.trim()) return;
    this._titleTimer = setTimeout(() => this.commitTitle(), 500);
  }

  commitTitle({ force = false } = {}) {
    clearTimeout(this._titleTimer);
    if (!this.note) return;
    const next = this.dom.title.value.trim();
    if (!next) {
      // 只在离开输入框（或按回车）时才把原标题找回来；正在输入时绝不动输入框
      const editing = document.activeElement === this.dom.title;
      if (force || !editing) this.dom.title.value = this.note.title;
      return;
    }
    if (next === this.note.title) return;
    if (this.hooks.onRename) this.hooks.onRename(this.note.id, next);
  }

  /** 切换 / 保存前调用：提交源码块和语言框，把块内容写回笔记 */
  flush() {
    this.commitLangIfNeeded();
    this.commitSource();
    this.writeBack();
  }

  /** 语言下拉开着的时候，把输入框里的语言落到代码块上 */
  commitLangIfNeeded() {
    const input = this._langAnchor;
    if (!input || !input.isConnected) return;
    const own = input.closest('.blk');
    if (!own) return;
    const index = Number(own.dataset.i);
    if (this._blocks[index] && this._blocks[index].type === 'code') {
      this.commitLang(index, input.value, false);
    }
  }

  /** 当前正在打字的元素（富文本块 / 代码块 / 源码块输入框） */
  activeEditor() {
    const active = document.activeElement;
    if (active && active.classList && active.classList.contains('code-input')) return active;
    if (active && active.classList && active.classList.contains('code-lang')) {
      const idx = this.codeIndex(active);
      return idx >= 0 ? this.codeInput(idx) : null;
    }
    if (this._sourceIndex != null) {
      return this.dom.preview.querySelector(`.blk[data-i="${this._sourceIndex}"] .blk-editor`);
    }
    // 单宿主：输入焦点在 #preview 上，具体块由选区决定
    const cur = this.currentBlockEl();
    if (cur) return cur.querySelector && cur.classList.contains('blk-code')
      ? cur.querySelector('.code-input')
      : cur;
    if (this._focus != null) {
      const blk = this._blocks[this._focus];
      if (blk && blk.type === 'code') return this.codeInput(this._focus);
      return this.editableEl(this._focus);
    }
    return null;
  }

  // ---------------------------------------------------------------- 图片
  /** 从剪贴板/拖放里挑出第一张图片文件 */
  imageFileOf(data) {
    if (!data) return null;
    const files = [...(data.files || [])].filter((f) => f.type && f.type.startsWith('image/'));
    if (files.length) return files[0];
    const items = [...(data.items || [])];
    const hit = items.find((i) => i.kind === 'file' && i.type && i.type.startsWith('image/'));
    return hit ? hit.getAsFile() : null;
  }

  onPaste(e) {
    if (!this.note) return;
    const file = this.imageFileOf(e.clipboardData);
    if (!file) return;          // 普通文字粘贴走浏览器默认行为
    e.preventDefault();
    this.attachImage(file);
  }

  onDrop(e) {
    if (!this.note) return;
    const file = this.imageFileOf(e.dataTransfer);
    if (!file) return;
    e.preventDefault();
    this.attachImage(file);
  }

  /** 存进库里的 image 目录，正文里只写文件名（界面上不出现任何路径） */
  async attachImage(file) {
    const api = window.tuyu && window.tuyu.images;
    if (!api) return;
    // 没有正在编辑的块时，先落到最后编辑过的那一块
    if (this._focus == null && this._sourceIndex == null) {
      this.focusBlock(this._lastEdit || 0, 'end');
    }
    const ext = (String(file.type || 'image/png').split('/')[1] || 'png')
      .replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const buffer = new Uint8Array(await file.arrayBuffer());
    const res = await api.save(buffer, ext);
    const name = res && res.name;
    if (!name) return;
    this.insertText(`![[${name}]]`);
    if (this.hooks.onImage) this.hooks.onImage(name);
  }

  /** 在当前光标处插入一段文本（图片引用等）。富文本块里插的是 markdown 片段。 */
  insertText(text) {
    const el = this.activeEditor();
    if (!el) return;
    if (el.tagName === 'TEXTAREA') {
      const start = el.selectionStart == null ? el.value.length : el.selectionStart;
      const end = el.selectionEnd == null ? start : el.selectionEnd;
      const before = el.value.slice(0, start);
      const lead = before && !before.endsWith('\n') ? '\n' : '';
      el.value = before + lead + text + '\n' + el.value.slice(end);
      const pos = (before + lead + text + '\n').length;
      el.selectionStart = pos;
      el.selectionEnd = pos;
      this.onSourceInput({ target: el });
      return;
    }
    this.insertIntoEditable(text);
    const blk = el.closest('.blk');
    const index = blk ? Number(blk.dataset.i) : null;
    if (index != null) {
      this.syncInline(index);
      // 图片要真正渲染出来：写回后重排这一块
      this.writeBack();
      this.renderBlocks();
      this.focusBlock(index, 'end');
    }
  }

  // ---------------------------------------------------------------- 缩放
  syncScale() {
    const px = (base) => Math.round(base * this.scale);
    this.dom.preview.style.fontSize = px(15) + 'px';
    // 标题固定 120% 基准字号（15 × 1.2 = 18px），不随正文字号缩放
    this.dom.title.style.fontSize = Math.round(15 * 1.2) + 'px';
    // 竖条也固定，不跟着正文字号缩放
    this.dom.accent.style.height = '26px';
  }

  setScale(scale) {
    this.scale = Math.max(0.7, Math.min(2.4, scale));
    this.syncScale();
    // 字号变了，代码块的 textarea 高度要重新量
    this._blocks.forEach((b, i) => { if (b.type === 'code') this.refreshCode(i); });
    const ta = this.activeEditor();
    if (ta && ta.classList && ta.classList.contains('blk-editor')) this.autosize(ta);
    if (this.hooks.onScale) this.hooks.onScale(this.scale);
  }

  // ---------------------------------------------------------------- 预览
  onChipClick(e) {
    const el = e.target.closest('.chip');
    if (!el) return;
    if (e.target.closest('.x')) {
      if (el.dataset.unlink) {
        if (this.hooks.onUnlink) this.hooks.onUnlink(this.note.id, el.dataset.unlink);
      } else if (el.dataset.unlinktext) {
        if (this.hooks.onUnlinkText) this.hooks.onUnlinkText(this.note.id, el.dataset.unlinktext);
      }
      return;
    }
    if (el.dataset.open && this.hooks.onOpenNote) this.hooks.onOpenNote(el.dataset.open);
    else if (el.dataset.create && this.hooks.onCreateMissing) this.hooks.onCreateMissing(el.dataset.create);
    else if (el.dataset.tag && this.hooks.onTag) this.hooks.onTag(el.dataset.tag);
  }

  // ---------------------------------------------------------------- 连接区
  renderMeta() {
    // 字数交给窗口底部状态栏显示（和「字号」合并在一起）
    const n = this.note ? Number(this.wordCount(this.note).replace(/,/g, '')) : 0;
    if (this.hooks.onWordCount) this.hooks.onWordCount(n);
  }

  /** 字数：去掉 markdown 符号、围栏和空白之后剩下的字符（中文按字、英文按词） */
  wordCount(note) {
    const raw = String((note && note.content) || '')
      .replace(/`{3,}[\s\S]*?`{3,}/g, ' ')
      .replace(/!\[\[[^\]]*\]\]/g, ' ')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      .replace(/[#*`>~|]/g, ' ');
    const cjk = (raw.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const words = (raw.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
    return (cjk + words).toLocaleString('en-US');
  }

  /** 双击卡片时调用：直接进编辑态，光标落在块末 */
  focusEditor() {
    if (!this.note) return;
    // 走 setMode（内部会重画），否则预览态下的块没有 contenteditable，focus 不进去
    this.setMode('edit');
    const index = Math.min(this._lastEdit, this._blocks.length - 1);
    this.focusBlock(index < 0 ? 0 : index, 'end');
  }

  /** 兼容旧调用：进入第 index 块的编辑 */
  enterBlock(index) { this.focusBlock(index || 0, 'end'); }

  focusTitle() {
    this.dom.title.focus();
    this.dom.title.select();
  }
}

function blockTextOf(block) {
  if (!block) return '';
  if (block.type === 'empty') return '';
  if (block.type === 'code' || block.type === 'math' || block.type === 'table') return block.src || '';
  return block.inline || '';
}

/** 块纯文本：head=前 N 个字符，tail=true 时取第 N 个之后 */
function blockLen(block, n, tail = false) {
  const text = block ? blockTextOf(block) : '';
  if (n == null) return tail ? text : text;
  return tail ? text.slice(n) : text.slice(0, n);
}

function chip(text, open, unlink, title, extraClass = '', extraAttr = '') {
  const cls = ['chip', extraClass].filter(Boolean).join(' ');
  const openAttr = open ? ` ${open}` : '';
  const x = unlink ? `<span class="x" data-x="1">✕</span>` : '';
  return `<span class="${cls}"${openAttr} ${extraAttr} ${title || ''}>` +
    `<span class="text">${escapeHtml(text)}</span>${x}</span>`;
}
