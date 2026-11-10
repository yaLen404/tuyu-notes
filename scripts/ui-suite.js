// 界面自检（在渲染进程里跑）：返回 [[name, ok, detail], ...]
(async () => {
  const out = [];
  const f = window.__fyn;
  const ws = f.ws;
  const c = f.canvas;
  const G = f.geometry;
  const $ = (s) => document.querySelector(s);
  const canvasEl = document.getElementById('canvas');
  const preview = document.getElementById('preview');
  // 富文本块编辑：正文切成 .blk，编辑中的块里是 contenteditable 的 .blk-txt
  const anyEditing = () => document.querySelectorAll('#preview .blk.is-editing');
  /** 当前"能打字的东西"：源码块是 textarea，富文本块是聚焦的 .blk-txt */
  const activeEditor = () => {
    const ta = document.querySelector('#preview .blk.is-editing textarea');
    if (ta) return ta;
    // 单宿主：焦点在 #preview，当前块由选区决定
    const sel = window.getSelection();
    const node = sel && sel.anchorNode;
    const el = node ? (node.nodeType === 1 ? node : node.parentElement) : null;
    const blk = el && el.closest ? el.closest('.blk') : null;
    return blk ? blk.querySelector('.blk-txt') : null;
  };
  const activeTA = activeEditor;   // 老名字，保留给已有用例
  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  /** 往"当前编辑的东西"里写一段纯文本（textarea 和富文本块都支持） */
  const setBlockText = (el, text) => {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') el.value = text;
    else el.innerHTML = esc(text).replace(/\n/g, '<br>');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };
  // 真实点击：点一下某一块就应该能在里面落光标
  const clickBlock = async (i = 0) => {
    const el = document.querySelector(`#preview .blk[data-i="${i}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    pointer(el, 'pointerdown', r.left + 12, r.top + 6);
    el.dispatchEvent(new MouseEvent('click', {
      bubbles: true, clientX: r.left + 12, clientY: r.top + 6,
    }));
    await wait(180);
    return activeEditor();
  };
  /** 只单击一次（现在单击就该进编辑） */
  const singleClickBlock = clickBlock;
  // 其它用例只需要"某一块在编辑"，直接走公开 API
  const openBlock = async (i = 0) => {
    if (f.pane.mode !== 'edit') f.pane.setMode('edit');
    f.pane.focusBlock(i, 'end');
    await wait(140);
    return activeEditor();
  };
  const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));
  const run = async (name, fn) => {
    try { const d = await fn(); out.push([name, true, d == null ? '' : String(d)]); }
    catch (e) { out.push([name, false, e && e.message ? e.message : String(e)]); }
  };
  const fail = (msg) => { throw new Error(msg); };
  const placeToolbarForTest = () => f.setFocusOnly(false);
  /** 真实鼠标路径的点击：pointdown → pointerup → click（能暴露"指针被抢走"的问题） */
  const realClick = (el) => {
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const target = document.elementFromPoint(x, y) || el;
    pointer(target, 'pointerdown', x, y);
    pointer(window, 'pointerup', x, y);
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
  };
  const closePopoverForTest = () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  const pointer = (el, type, x, y, extra = {}) => el.dispatchEvent(new PointerEvent(type, Object.assign({
    bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, isPrimary: true,
  }, extra)));
  const center = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const cardOf = (id) => document.querySelector(`.card[data-id="${id}"]`);

  await wait(200);

  await run('默认左右等宽', async () => {
    const body = document.getElementById('body').clientWidth;
    const left = document.getElementById('leftPane').clientWidth;
    if (Math.abs(left / body - 0.5) > 0.03) fail(`${left}/${body}`);
    return `${left}/${body} = ${(left / body).toFixed(3)}`;
  });

  await run('分隔条和其他分界线同色', async () => {
    const st = getComputedStyle($('.splitter-line'));
    const chrome = getComputedStyle(document.querySelector('.titlebar')).borderBottomColor;
    if (st.width !== '1px' || st.backgroundColor !== chrome) {
      fail(`${st.width} ${st.backgroundColor} vs ${chrome}`);
    }
    return `1px ${st.backgroundColor}`;
  });

  await run('单击卡片：选中但不夺走笔记焦点', async () => {
    f.pane.focusBlock(0, 'end');
    await wait(80);
    const card = $('.card');
    const id = card.dataset.id;
    const [x, y] = center(card);
    pointer(card, 'pointerdown', x, y);
    pointer(window, 'pointerup', x, y);
    await wait();
    if (c.selected !== id) fail('没有选中');
    if (anyEditing().length) fail('笔记还停在编辑态');
    return '选中且焦点在画布';
  });

  await run('双击卡片：焦点交给笔记', async () => {
    // 先把可能残留的焦点清掉，模拟"用户在画布上"的状态
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    await wait(80);
    const card = $('.card');
    const [x, y] = center(card);
    card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: x, clientY: y }));
    await wait(250);
    const ae = document.activeElement;
    const inNote = Boolean(ae && (ae === preview || preview.contains(ae)));
    if (!inNote) fail('焦点没进笔记区');
    return '焦点在笔记区';
  });

  await run('点空白：焦点收回画布', async () => {
    f.pane.focusBlock(0, 'end');
    await wait(80);
    pointer(canvasEl, 'pointerdown', 6, 6);
    pointer(window, 'pointerup', 6, 6);
    await wait();
    if (anyEditing().length) fail('正文还停在编辑态');
    return '焦点已收回';
  });

  await run('笔记字号只放大右栏', async () => {
    const card = $('.card');
    const id = card.dataset.id;
    const z0 = c.zoom;
    const w0 = card.getBoundingClientRect().width;
    const fs0 = getComputedStyle(preview).fontSize;
    f.zoomNote(1.5);
    await wait();
    const w1 = cardOf(id).getBoundingClientRect().width;
    const fs1 = getComputedStyle(preview).fontSize;
    f.zoomNote(0);
    await wait();
    if (Math.abs(c.zoom - z0) > 1e-9) fail('画布缩放变了');
    if (Math.abs(w1 - w0) > 1) fail(`卡片尺寸变了 ${w0} -> ${w1}`);
    if (fs0 === fs1) fail('字号没变');
    return `${fs0} -> ${fs1}`;
  });

  await run('Ctrl+滚轮只改字号', async () => {
    const z0 = c.zoom;
    const s0 = f.pane.scale;
    window.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true,
    }));
    await wait();
    const ok = Math.abs(c.zoom - z0) < 1e-9 && f.pane.scale > s0;
    f.zoomNote(0);
    await wait();
    if (!ok) fail(`zoom ${z0} -> ${c.zoom}, scale ${s0} -> ${f.pane.scale}`);
    return '画布不动，右栏变大';
  });

  await run('滚轮以光标为焦点不漂移', async () => {
    c.setZoom(1);
    await wait();
    const r = canvasEl.getBoundingClientRect();
    const px = r.left + r.width * 0.42;
    const py = r.top + r.height * 0.38;
    const before = c.toWorld(px - r.left, py - r.top);
    canvasEl.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -120, bubbles: true, cancelable: true, clientX: px, clientY: py,
    }));
    await wait();
    const after = c.toWorld(px - r.left, py - r.top);
    const drift = Math.hypot(after[0] - before[0], after[1] - before[1]);
    if (drift > 0.2) fail(`漂移 ${drift.toFixed(3)}`);
    return `漂移 ${drift.toFixed(4)}`;
  });

  await run('缩放后箭头仍然贴边', async () => {
    c.setZoom(1.8);
    await wait();
    let checked = 0;
    for (const { src, dst, link } of c.allLinks()) {
      const a = c.records.get(src);
      const b = c.records.get(dst);
      const ra = { x: a.x, y: a.y, w: a.w, h: a.h };
      const rb = { x: b.x, y: b.y, w: b.w, h: b.h };
      const path = G.linkPath(ra, rb, link.shape);
      if (!G.isSideMidpoint(ra, path.start)) fail('起点不在中点');
      if (!G.isSideMidpoint(rb, path.end)) fail('终点不在中点');
      const sa = c.toScreen(path.start);
      const sb = c.toScreen(path.end);
      const pa = c.toScreen([ra.x, ra.y]);
      const pb = c.toScreen([rb.x, rb.y]);
      const sra = { x: pa[0], y: pa[1], w: ra.w * c.zoom, h: ra.h * c.zoom };
      const srb = { x: pb[0], y: pb[1], w: rb.w * c.zoom, h: rb.h * c.zoom };
      if (!G.onBorder(sra, sa, 0.6)) fail('起点没贴边');
      if (!G.onBorder(srb, sb, 0.6)) fail('终点没贴边');
      checked += 1;
    }
    c.setZoom(1);
    await wait();
    if (checked < 3) fail(`只检查了 ${checked} 条`);
    return `${checked} 条连线`;
  });

  await run('整理布局可复现且不重叠', async () => {
    f.tidy();
    await wait();
    const p1 = c.positions();
    f.tidy();
    await wait();
    const p2 = c.positions();
    let worst = 0;
    for (const k of Object.keys(p1)) {
      worst = Math.max(worst, Math.abs(p1[k][0] - p2[k][0]) + Math.abs(p1[k][1] - p2[k][1]));
    }
    if (worst > 0.02) fail(`两次布局差 ${worst}`);
    let overlaps = 0;
    const recs = [...c.records.values()];
    for (let i = 0; i < recs.length; i += 1) {
      for (let j = i + 1; j < recs.length; j += 1) {
        const a = recs[i];
        const b = recs[j];
        const ox = (a.w + b.w) / 2 - Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
        const oy = (a.h + b.h) / 2 - Math.abs(a.y + a.h / 2 - (b.y + b.h / 2));
        if (ox > 1 && oy > 1) overlaps += 1;
      }
    }
    if (overlaps) fail(`还有 ${overlaps} 对重叠`);
    return `${recs.length} 个节点，两次一致，无重叠`;
  });

  await run('撤销 / 重做', async () => {
    const n0 = ws.notesOf().length;
    f.newNote();
    await wait();
    if (ws.notesOf().length !== n0 + 1) fail('新建没生效');
    f.undo();
    await wait();
    if (ws.notesOf().length !== n0) fail(`撤销后 ${ws.notesOf().length}`);
    f.redo();
    await wait();
    if (ws.notesOf().length !== n0 + 1) fail('重做没生效');
    f.undo();
    await wait();
    return '新建 -> 撤销 -> 重做 -> 撤销';
  });

  await run('多图隔离', async () => {
    const g1 = ws.graphId;
    const count = ws.notesOf().length;
    f.newGraph();
    await wait();
    const empty = ws.notesOf().length === 0;
    f.switchGraph(g1);
    await wait();
    const back = ws.notesOf().length === count;
    if (!empty) fail('新图带了笔记');
    if (!back) fail('切回来笔记数不对');
    return `两张图 ${count} / 0`;
  });

  await run('图菜单能切到别的图', async () => {
    const g1 = ws.graphId;
    const notes1 = ws.notesOf().length;
    f.newGraph();
    await wait(200);
    const g2 = ws.graphId;
    if (g1 === g2) fail('新建图后没有切过去');
    if (ws.notesOf().length !== 0) fail('新图不该有旧笔记');
    const btn = document.getElementById('graphBtn');
    const idxOf = (gid) => ws.graphs().findIndex((g) => g.id === gid);
    const clickGraph = async (gid) => {
      btn.click();
      await wait(150);
      const rows = [...document.getElementById('popover').querySelectorAll('.item')];
      const row = rows[idxOf(gid)];
      if (!row) fail(`菜单里找不到第 ${idxOf(gid) + 1} 张图`);
      row.click();
      await wait(220);
    };
    await clickGraph(g1);
    if (ws.graphId !== g1) fail('点原有的图没切回去');
    if (ws.notesOf().length !== notes1) fail('切回去笔记数不对');
    await clickGraph(g2);
    if (ws.graphId !== g2) fail('点新图没切过去');
    await clickGraph(g1); // 收尾：回到有笔记的那张
    if (ws.graphId !== g1) fail('收尾没切回原图');
    return `${ws.graphs().length} 张图，来回切换正常`;
  });

  await run('菜单点击命中正确的项', async () => {
    const before = ws.notesOf().length;
    document.querySelector('.menubar-btn[data-menu="file"]').click();
    await wait(140);
    const rows = [...document.getElementById('popover').querySelectorAll('.item')];
    const target = rows.find((r) => r.textContent.includes('立即保存'));
    if (!target) fail('文件菜单里找不到「立即保存」');
    target.click();
    await wait(180);
    if (ws.notesOf().length !== before) fail('点「立即保存」却新建了笔记 —— 菜单派发跑到第一项去了');
    return '点哪项执行哪项';
  });

  await run('文件菜单里有「重启」，就在「退出」上面', async () => {
    const items = f.menuSpec('file');
    const labels = items.filter((it) => !it.sep).map((it) => it.label);
    const iRestart = labels.indexOf('重启');
    const iQuit = labels.indexOf('退出');
    if (iRestart < 0) fail('文件菜单里没有「重启」：' + labels.join(' / '));
    if (iQuit < 0) fail('文件菜单里没有「退出」');
    if (iRestart !== iQuit - 1) fail(`「重启」应该紧挨在「退出」上面：${labels.join(' / ')}`);
    if (typeof window.tuyu.win.relaunch !== 'function') fail('主进程没暴露 win.relaunch');
    // 菜单里这一项必须真的指向重启，而不是别的动作
    const item = items.find((it) => it.label === '重启');
    if (item.accel) fail('「重启」不该占用快捷键：' + item.accel);
    return labels.slice(iRestart - 1).join(' → ');
  });

  await run('图片：存进库里，正文只留文件名', async () => {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const res = await window.tuyu.images.save(bytes, 'png');
    if (!res || !res.name) fail('保存图片失败');
    const name = res.name;
    if (!/^img-.*\.png$/.test(name)) fail('文件名不对: ' + name);
    const note = ws.notesOf()[0];
    f.selectNote(note.id);
    await wait(150);
    if (!(await openBlock(0))) fail('没有进入块编辑');
    f.pane.insertText(`![[${name}]]`);
    await wait(200);
    const content = ws.note(note.id).content;
    if (!content.includes(`![[${name}]]`)) fail('正文里没插入图片引用');
    if (content.includes('image/')) fail('正文里不该出现存放路径');
    f.pane.setMode('view');
    let img = null;
    for (let i = 0; i < 20; i += 1) {
      img = document.querySelector('#preview img.note-img');
      if (img && img.complete && img.naturalWidth > 0) break;
      await wait(100);
    }
    if (!img) fail('预览里没有图片元素');
    if (!img.complete || img.naturalWidth !== 1) fail(`图片没加载（w=${img.naturalWidth}）`);
    if (!img.src.startsWith('fyn-img://')) fail('src 不是私有协议: ' + img.src);
    return `${name} 已渲染，正文无路径`;
  });

  await run('粘贴事件：真的按 Ctrl+V 也能插进来', async () => {
    const note = ws.notesOf()[0];
    f.selectNote(note.id);
    await wait(150);
    await openBlock(0);
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    const before = ws.note(note.id).content;
    const taPaste = activeTA();
    if (!taPaste) fail('没有进入块编辑');
    taPaste.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dt, bubbles: true, cancelable: true,
    }));
    let after = before;
    for (let i = 0; i < 30; i += 1) {
      after = ws.note(note.id).content;
      if (after.length > before.length && after.includes('![[img-')) break;
      await wait(100);
    }
    if (!after.includes('![[img-')) fail('粘贴没有插入图片');
    if (after.includes('image/')) fail('正文里出现了路径');
    return '剪贴板图片已落到库里的 image 目录';
  });

  await run('图片块可以退格删掉（纯图片 / 图文混排）', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    const press = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', {
      key, bubbles: true, cancelable: true,
    }));
    f.selectNote(note.id);
    await wait(180);
    try {
      // 只有一张图
      note.content = '![[img-del-test.png]]';
      f.pane.renderBlocks();
      await wait(180);
      f.pane.focusBlock(0, 'end');
      await wait(100);
      let txt = document.querySelector('#preview .blk-txt');
      press(txt, 'Backspace');
      await wait(220);
      if (document.querySelector('#preview img.note-img')) fail('纯图片块退格后图片还在');
      if (ws.note(note.id).content.includes('img-del-test')) fail('纯图片块退格后内容里还有图片引用');

      // 图文混排：点图片 → 光标在图片后 → 退格
      note.content = '前文 ![[img-inline-test.png]] 后文';
      f.pane.renderBlocks();
      await wait(180);
      const img = document.querySelector('#preview img.note-img');
      if (!img) fail('图文块里的图片没渲染');
      const r = img.getBoundingClientRect();
      img.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true,
        clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
      }));
      await wait(100);
      txt = document.querySelector('#preview .blk-txt');
      press(txt, 'Backspace');
      await wait(220);
      if (document.querySelector('#preview img.note-img')) fail('图文块退格后图片还在');
      const content = ws.note(note.id).content;
      if (!content.includes('前文') || !content.includes('后文')) fail('删图片把前后文字弄丢了');
      if (content.includes('img-inline-test')) fail('图文块退格后内容里还有图片引用');

      // 整段选中再删：不能只删文字、把图片留下
      note.content = '前文 ![[img-select-test.png]] 后文';
      f.pane.renderBlocks();
      await wait(160);
      txt = document.querySelector('#preview .blk-txt');
      const range = document.createRange();
      range.selectNodeContents(txt);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      press(txt, 'Delete');
      await wait(220);
      if (document.querySelector('#preview img.note-img')) fail('整段删除后图片还在');
      if (ws.note(note.id).content.includes('img-select-test')) fail('整段删除后内容里还有图片引用');
      return '纯图片 / 图文混排 / 整段选中 都能删掉图片';
    } finally {
      note.content = original;
      f.pane.renderBlocks();
      await wait(140);
    }
  });

  await run('右键图片：复制图片写入系统剪贴板', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    f.selectNote(note.id);
    await wait(180);
    try {
      const m = String(original).match(/!\[\[(img-[^\]]+\.(?:png|jpe?g|gif|webp|bmp|svg|avif))\]\]/i);
      if (!m) fail('前面没有可用的图片引用');
      note.content = `![[${m[1]}]]`;
      f.pane.renderBlocks();
      await wait(260);
      const img = document.querySelector('#preview img.note-img');
      if (!img) fail('图片没渲染出来');
      img.style.width = '48px';
      img.style.height = '48px';
      await wait(80);
      const r = img.getBoundingClientRect();
      img.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
      }));
      await wait(240);
      const menu = document.querySelector('.blk-menu');
      if (!menu) fail('右键图片没有菜单');
      const btn = [...menu.querySelectorAll('button')].find((b) => b.dataset.act === 'copy-image');
      if (!btn) fail('图片菜单里没有「复制图片」');
      realClick(btn);
      await wait(700);
      const hasImage = await window.tuyu.clipboard.hasImage();
      if (!hasImage) fail('系统剪贴板里没有图片');
      if (!f.pane.blockText(0).includes(`![[${m[1]}]]`)) fail('复制图片引用兜底丢了文件名');
      return '右键图片 → 复制图片，剪贴板里有 image/png';
    } finally {
      note.content = original;
      f.pane.renderBlocks();
      await wait(140);
    }
  });

  await run('清理图片：不算正在用的那张', async () => {
    const res = await window.tuyu.images.cleanup(ws.notes);
    if (res.removed > 0) fail(`误删了 ${res.removed} 张正在用的图片`);
    if (res.kept < 1) fail('没有被保留的图片');
    return `保留 ${res.kept} 张，删除 ${res.removed} 张`;
  });

  await run('公式：LaTeX 渲染成排版结果', async () => {
    const note = ws.notesOf()[0];
    f.selectNote(note.id);
    await wait(160);
    // 公式是独立块，直接写进笔记内容再看渲染结果
    const original = ws.note(note.id).content;
    ws.note(note.id).content = [
      '算力公式 $CI = \\text{FLOPs} / \\text{Bytes}$ 到此结束。',
      '',
      '$$',
      '\\int_0^1 x^2 \\, dx = \\frac{1}{3}',
      '$$',
    ].join('\n');
    f.pane.renderBlocks();
    await wait(400);
    const nodes = document.querySelectorAll('#preview .katex');
    if (!nodes.length) fail('没有渲染出 KaTeX 节点');
    const bad = document.querySelector('#preview .katex-error');
    if (bad) fail('公式报错：' + bad.textContent.slice(0, 60));
    const box = nodes[0].getBoundingClientRect();
    if (box.width < 5) fail('公式宽度异常 ' + box.width);
    const block = document.querySelector('#preview .math-block .katex-display');
    if (!block) fail('独立公式块没按 display 模式渲染');
    ws.note(note.id).content = original;
    f.pane.renderBlocks();
    await wait(150);
    return `${nodes.length} 个公式（含一个独行公式）`;
  });

  await run('公式：KaTeX 字体是本地加载的', async () => {
    const sheet = [...document.styleSheets].find((s) => (s.href || '').includes('katex'));
    if (!sheet) fail('没加载 katex 样式表');
    // 自己造一段公式，别依赖上一个用例的现场
    const note = ws.notesOf()[0];
    const original = ws.note(note.id).content;
    ws.note(note.id).content = '行内公式 $a^2 + b^2 = c^2$ 结束。';
    f.pane.renderBlocks();
    await wait(300);
    const probe = document.querySelector('#preview .katex .mathnormal, #preview .katex .mord');
    if (!probe) fail('找不到公式内部节点');
    const fam = getComputedStyle(probe).fontFamily || '';
    ws.note(note.id).content = original;
    f.pane.renderBlocks();
    if (!/KaTeX/i.test(fam)) fail('公式没用到 KaTeX 字体：' + fam);
    return fam.split(',')[0];
  });

  await run('一直按回车会一直加空块', async () => {
    const note = ws.notesOf().find((n) => (n.content || '').length > 20);
    f.selectNote(note.id);
    await wait(240);
    const count = () => document.querySelectorAll('#preview .blk').length;
    const base = count();
    const original = ws.note(note.id).content;
    // 光标放到最后一块的末尾
    f.pane.focusBlock(f.pane._blocks.length - 1, 'end');
    await wait(220);
    for (let i = 0; i < 3; i += 1) {
      const ed = activeEditor();
      if (!ed) fail(`第 ${i + 1} 次回车前没有光标`);
      ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await wait(240);
    }
    const after = count();
    if (after !== base + 3) fail(`回车 3 次后块数 ${base} → ${after}`);
    // 存回去再解析一遍也不能把空块压掉（round-trip）
    f.pane.renderBlocks();
    await wait(240);
    const again = count();
    if (again !== after) fail(`重新渲染后空块被压掉了：${after} → ${again}`);
    // 收尾：还原
    ws.note(note.id).content = original;
    f.pane.renderBlocks();
    await wait(150);
    return `回车 3 次 → ${after} 块，重渲染仍是 ${again} 块`;
  });

  await run('块可以新增、删除、拆分', async () => {
    const note = ws.notesOf().find((n) => (n.content || '').split('\n\n').length >= 2);
    if (!note) fail('找不到多段落的样例笔记');
    f.selectNote(note.id);
    await wait(260);
    f.pane.setMode('edit');
    await wait(220);
    const blkCount = () => document.querySelectorAll('#preview .blk').length;
    const content = () => ws.note(note.id).content;
    const base = blkCount();
    const originalContent = content();
    if (base < 2) fail('样例笔记块数太少：' + base);

    // ① 在最后一块按回车，加一块并写字
    f.pane.focusBlock(f.pane._blocks.length - 1, 'end');
    await wait(220);
    let ed = activeEditor();
    if (!ed) fail('最后一块没有光标');
    ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(320);
    ed = activeEditor();
    if (!ed) fail('回车后没有进入新块');
    if (blkCount() !== base + 1) fail(`新增块后块数 ${base} → ${blkCount()}`);
    setBlockText(ed, '新加的一块');
    await wait(220);
    if (!content().includes('新加的一块')) fail('新增块的内容没有写进笔记');

    // ② 删空这一块 → 空块要留下来
    ed = activeEditor();
    if (!ed) fail('空块没有光标');
    setBlockText(ed, '');
    await wait(200);
    if (content().includes('新加的一块')) fail('删空后文字还在');
    if (blkCount() !== base + 1) fail(`删空后空块应该还在：块数 ${blkCount()}，应为 ${base + 1}`);

    // ③ 空块开头退格 → 这一块才真的消失
    f.pane.focusBlock(blkCount() - 1, 'start');
    await wait(220);
    ed = activeEditor();
    if (!ed) fail('空块没有光标');
    ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    await wait(320);
    if (blkCount() !== base) fail(`空块退格后块数 ${blkCount()}，应为 ${base}`);

    // ④ 块尾回车 → 拆出一块空的
    f.pane.focusBlock(0, 'end');
    await wait(220);
    ed = activeEditor();
    if (!ed) fail('没进第一块');
    const beforeSplit = blkCount();
    ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(320);
    if (blkCount() !== beforeSplit + 1) fail(`回车后块数 ${beforeSplit} → ${blkCount()}`);
    const ed2 = activeEditor();
    if (!ed2) fail('回车后没有进入新块');
    if (String(ed2.textContent || '').trim() !== '') {
      fail('回车拆出的新块不是空的：' + JSON.stringify(ed2.textContent));
    }

    // 还原成一开始的内容（不动撤销栈）
    ws.note(note.id).content = originalContent;
    f.pane.renderBlocks();
    await wait(150);
    return `新增/删除/拆分/退格删块都正常（${base} 块）`;
  });

  await run('单击块就地编辑，失焦回预览', async () => {
    const note = ws.notesOf().find((n) => (n.content || '').length > 20);
    f.selectNote(note.id);
    await wait(220);

    // 1) 编辑态下每块都是富文本，但还没有光标落在任何块里
    if (f.pane.mode !== 'edit') f.pane.setMode('edit');
    await wait(200);
    if (f.pane._focus != null) fail('没点就聚焦了某一块');

    // 2) 单击一次 → 光标落在被点的那一块里
    const single = await singleClickBlock(0);
    if (!single) fail('单击块没有进入编辑');
    if (!single.classList.contains('blk-txt')) fail('聚焦的不是块文本');
    const blk = single.closest('.blk');
    if (!blk || Number(blk.dataset.i) !== 0) fail('进的不是被点的那一块');

    // 3) 打字 → 内容进笔记
    const marker = '块编辑写入 ' + Date.now();
    setBlockText(single, (single.textContent || '') + ' ' + marker);
    await wait(200);
    if (!ws.note(note.id).content.includes(marker)) fail('输入没有写回笔记');

    // 4) 焦点离开笔记（像用户那样点到左栏搜索框）→ 回到全预览，且内容已提交
    //    注意：必须真的派发 pointerdown。离屏窗口没有焦点时 Chromium 不派发
    //    blur/focusin，靠 focus() 是测不出来的（真实窗口里 blur 会正常触发）。
    const search = document.getElementById('searchInput');
    const sr = search.getBoundingClientRect();
    pointer(search, 'pointerdown', sr.left + 12, sr.top + 6);
    pointer(window, 'pointerup', sr.left + 12, sr.top + 6);
    search.focus();
    await wait(420);
    if (anyEditing().length) fail('失焦后还有块停在编辑态');
    if (!document.getElementById('preview').innerHTML.includes(marker)) fail('预览没更新');
    if (!ws.note(note.id).content.includes(marker)) fail('内容没写回笔记');
    return '预览 → 单击某块就地编辑 → 失焦回预览';
  });

  await run('块左侧没有手柄了，加块靠回车', async () => {
    const note = ws.notesOf().find((n) => (n.content || '').split('\n\n').length >= 2);
    f.selectNote(note.id);
    await wait(250);
    if (document.querySelector('#preview .blk-ctl')) fail('块左侧还挂着手柄');
    if (document.querySelector('#preview .blk-plus')) fail('还有 ＋ 手柄');
    // 回车仍然能在块尾加一块
    const before = document.querySelectorAll('#preview .blk').length;
    f.pane.focusBlock(f.pane._blocks.length - 1, 'end');
    await wait(220);
    const ed = activeEditor();
    if (!ed) fail('最后一块没有光标');
    ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(300);
    const after = document.querySelectorAll('#preview .blk').length;
    if (after !== before + 1) fail(`回车后块数 ${before} → ${after}`);
    if (!activeEditor()) fail('回车后没有进入新块');
    return '没有手柄，回车照常加块';
  });

  await run('使用说明 / 关于 里不提别的软件，也不讲已经删掉的操作', async () => {
    const closeAll = () => {
      document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());
    };
    closeAll();
    f.showHelp();
    await wait(300);
    const helpEl = document.querySelector('.modal-overlay .modal-body');
    if (!helpEl) fail('使用说明没打开');
    const help = helpEl.textContent.replace(/\s+/g, ' ');
    if (/Notion|Obsidian|VSCode|Electron|Chromium|Tkinter/i.test(help)) {
      fail('使用说明里提到了别的软件');
    }
    if (help.includes('⋮⋮') || help.includes('＋ 新段落')) fail('使用说明还在讲已经删掉的按钮');
    if (!help.includes('/')) fail('使用说明没讲 / 菜单');
    if (!help.includes('Tab')) fail('使用说明没讲 Tab 缩进');
    closeAll();
    await wait(120);

    f.showAbout();
    await wait(300);
    const aboutEl = document.querySelector('.modal-overlay .modal-body');
    if (!aboutEl) fail('关于没打开');
    const about = aboutEl.textContent.replace(/\s+/g, ' ');
    if (/Obsidian|Notion|VSCode|Electron|Chromium|Tkinter/i.test(about)) {
      fail('关于里提到了别的软件');
    }
    if (!about.includes('图屿笔记')) fail('关于里没有名字');
    if (!about.includes('本机') && !about.includes('不联网')) fail('关于没讲数据在本机');
    closeAll();
    await wait(120);
    return '说明 ' + help.length + ' 字 / 关于 ' + about.length + ' 字，均未提别的软件';
  });

  await run('右键图名按钮改名：原地在按钮上编辑，不打开列表', async () => {
    const gid = ws.graphId;
    const before = ws.graph().name;
    const btn = document.getElementById('graphBtn');
    const r = btn.getBoundingClientRect();
    btn.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + 10), clientY: Math.round(r.bottom + 4),
    }));
    await wait(240);
    const pop = document.getElementById('popover');
    const rename = [...pop.querySelectorAll('.item')].find((el) => el.textContent.includes('重命名'));
    if (!rename) fail('右键菜单里没有重命名');
    rename.click();
    await wait(280);
    const input = document.querySelector('.inline-edit');
    if (!input) fail('没有出现原地编辑框');
    if (!pop.hidden) fail('不该弹出图列表');
    const ir = input.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    if (Math.abs(ir.left - br.left) > 6 || Math.abs(ir.top - br.top) > 6) fail('编辑框没盖在按钮上');
    input.value = '按钮自检';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(320);
    if (ws.graphs().find((g) => g.id === gid).name !== '按钮自检') fail('改名没生效');
    if (document.querySelector('.inline-edit')) fail('提交后编辑框没消失');
    ws.renameGraph(gid, before);
    await f.saveNow();
    await wait(150);
    return before + ' → 按钮自检（盖在按钮上改）';
  });

  await run('图重命名就在原地改，不弹窗', async () => {
    const gid = ws.graphId;
    const before = ws.graph().name;
    document.getElementById('graphBtn').click();
    await wait(240);
    const pop = document.getElementById('popover');
    const first = pop.querySelector('.item');
    const fr = first.getBoundingClientRect();
    first.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(fr.left + 8), clientY: Math.round(fr.top + 8),
    }));
    await wait(240);
    const sub = document.getElementById('submenu');
    const rename = [...sub.querySelectorAll('.item')].find((el) => el.textContent.includes('重命名'));
    if (!rename) fail('没有重命名这一项');
    rename.click();
    await wait(280);
    const input = document.querySelector('.inline-edit');
    if (!input) fail('没有出现原地编辑框');
    if (document.activeElement !== input) fail('编辑框没有拿到焦点');
    if (input.value !== before) fail('编辑框里不是现在的名字：' + input.value);
    if (document.querySelector('.overlay:not([hidden])')) fail('还是弹了模态框');
    input.value = '自检改名';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(320);
    if (ws.graphs().find((g) => g.id === gid).name !== '自检改名') fail('改名没生效');
    if (document.querySelector('.inline-edit')) fail('提交后编辑框没消失');
    // 还原
    ws.renameGraph(gid, before);
    await f.saveNow();
    await wait(150);
    return before + ' → 自检改名（原地）';
  });

  await run('右键图列表里的某一项：主菜单不消失，旁边弹出这张图的菜单', async () => {
    const btn = document.getElementById('graphBtn');
    btn.click();                       // 左键打开图列表
    await wait(240);
    const pop = document.getElementById('popover');
    if (!pop || pop.hidden) fail('图列表没打开');
    const labels = [...pop.querySelectorAll('.item')].map((el) => el.textContent.trim());
    if (labels.some((t) => t.includes('重命名这张图'))) fail('列表底部还留着「重命名这张图」');
    if (labels.some((t) => t.includes('删除这张图'))) fail('列表底部还留着「删除这张图」');
    const first = pop.querySelector('.item');
    const fr = first.getBoundingClientRect();
    first.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(fr.left + 10), clientY: Math.round(fr.top + 10),
    }));
    await wait(260);
    // 主菜单必须还在
    if (pop.hidden) fail('弹出二级菜单时主菜单消失了');
    if (!pop.querySelector('.item')) fail('主菜单内容被清空了');
    // 二级菜单：正好两项
    const sub = document.getElementById('submenu');
    if (!sub || sub.hidden) fail('右键没有弹出这张图的菜单');
    const ctx = [...sub.querySelectorAll('.item')].map((el) => el.textContent.trim());
    if (ctx.length !== 2) fail('右键菜单项不对：' + ctx.join(' / '));
    if (!ctx[0].includes('重命名')) fail('第一项不是重命名：' + ctx[0]);
    if (!ctx[1].includes('删除')) fail('第二项不是删除：' + ctx[1]);
    // 二级菜单在主菜单右边
    if (sub.getBoundingClientRect().left < pop.getBoundingClientRect().right - 2) {
      fail('二级菜单没在主菜单旁边');
    }
    closePopoverForTest();
    await wait(150);
    if (!sub.hidden) fail('点外面后二级菜单没关掉');
    return '列表 ' + labels.length + ' 项仍在，右键菜单：' + ctx.join(' / ');
  });

  await run('右键图的按钮弹出「重命名 / 删除」菜单', async () => {
    const btn = document.getElementById('graphBtn');
    if (!btn) fail('找不到图的按钮');
    const r = btn.getBoundingClientRect();
    btn.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + 20), clientY: Math.round(r.bottom + 6),
    }));
    await wait(240);
    const pop = document.getElementById('popover');
    if (!pop || pop.hidden) fail('右键没有弹出菜单');
    const items = [...pop.querySelectorAll('.item')].map((el) => el.textContent.trim());
    if (items.length !== 2) fail('菜单项数量不对：' + items.join(' / '));
    if (!items[0].includes('重命名')) fail('第一项不是重命名：' + items[0]);
    if (!items[1].includes('删除')) fail('第二项不是删除：' + items[1]);
    closePopoverForTest();
    await wait(150);
    return items.join(' / ');
  });

  await run('长笔记全选删除：不残留、不留下空标题', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    try {
      f.selectNote(note.id);
      await wait(220);
      const parts = [];
      for (let i = 0; i < 24; i += 1) {
        parts.push((i % 6 === 0 ? '### ' : '') + '第 ' + i + ' 段：' + '内容'.repeat(10));
      }
      note.content = parts.join('\n\n');
      f.pane.renderBlocks();
      await wait(180);
      const preview = document.getElementById('preview');
      const range = document.createRange();
      range.selectNodeContents(preview);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      await wait(80);
      preview.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Delete', bubbles: true, cancelable: true,
      }));
      await wait(360);
      if (note.content !== '') fail('全选删除后还残留内容：' + JSON.stringify(note.content.slice(0, 40)));
      if (f.pane._blocks.length !== 1 || f.pane._blocks[0].type !== 'empty') {
        fail('全选删除后不是单个空块：' + JSON.stringify(f.pane._blocks.map((b) => b.type)));
      }
      if (f.pane._focus !== 0) fail('删除后光标没落到唯一的空块');
    } finally {
      note.content = original;
      f.pane.renderBlocks();
      await wait(140);
    }
    return '全选 24 块后删空，只剩一个空块';
  });

  await run('跨块删除带粗体的内容，合并位置不跑偏', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    try {
      f.selectNote(note.id);
      await wait(220);
      note.content = '**AAAA**\n\n**BBBB**\n\n**CCCC**';
      f.pane.renderBlocks();
      await wait(180);
      const txts = [...document.querySelectorAll('#preview .blk-txt')];
      const nodeAt = (txt, offset) => {
        const w = document.createTreeWalker(txt, NodeFilter.SHOW_TEXT);
        let pos = 0;
        let node = w.nextNode();
        while (node) {
          if (offset <= pos + node.nodeValue.length) return { node, off: offset - pos };
          pos += node.nodeValue.length;
          node = w.nextNode();
        }
        return { node: txt, off: 0 };
      };
      const a = nodeAt(txts[0], 2);
      const b = nodeAt(txts[2], 2);
      const range = document.createRange();
      range.setStart(a.node, a.off);
      range.setEnd(b.node, b.off);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      await wait(100);
      preview.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Delete', bubbles: true, cancelable: true,
      }));
      await wait(300);
      const first = f.pane._blocks[0];
      if (!first || first.inline.includes('BBBB')) fail('中间块没删干净：' + (first && first.inline));
      if (!first.inline.includes('AA') || !first.inline.includes('CC')) {
        fail('前后缀合并错了：' + first.inline);
      }
      if (f.pane._focus !== 0) fail('删除后光标没落在合并块');
      const cur = window.getSelection().getRangeAt(0);
      if (cur.startOffset !== 2) fail('光标位置偏移：' + cur.startOffset);
    } finally {
      note.content = original;
      f.pane.renderBlocks();
      await wait(140);
    }
    return '粗体跨块删除后前后缀和光标位置正确';
  });

  await run('跨块选中后按 Delete，删掉的是全部选中内容且不会复活', async () => {
    const note = ws.notesOf().find((n) => (n.content || '').split('\n\n').length >= 5);
    f.selectNote(note.id);
    await wait(360);
    const txts = [...document.querySelectorAll('#preview .blk-txt')].filter((t) => (t.textContent || '').trim());
    if (txts.length < 3) fail('块不够');
    const before = { blocks: f.pane._blocks.length, len: ws.note(note.id).content.length };
    const a = txts[0].firstChild || txts[0];
    const c = txts[2].firstChild || txts[2];
    const range = document.createRange();
    range.setStart(a, 2);
    range.setEnd(c, Math.max(1, (c.nodeValue || '').length - 2));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    await wait(150);
    const picked = sel.toString().length;
    if (!picked) fail('没有选区');

    txts[0].closest('.blk').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await wait(360);
    const after = { blocks: f.pane._blocks.length, len: ws.note(note.id).content.length };
    if (after.len >= before.len) fail('内容没有变少：' + before.len + ' → ' + after.len);
    if (after.blocks !== before.blocks - 2) fail('块数不对：' + before.blocks + ' → ' + after.blocks);

    // 切走再切回：删掉的内容不能复活
    const other = ws.notesOf().find((n) => n.id !== note.id);
    f.selectNote(other.id);
    await wait(200);
    f.selectNote(note.id);
    await wait(300);
    if (ws.note(note.id).content.length !== after.len) fail('删掉的内容又回来了');
    // 收尾：撤销回去，别影响后面的用例
    f.pane.undoNote();
    await wait(200);
    return '选中 ' + picked + ' 字 → 删除：' + before.len + ' → ' + after.len + ' 字，' + before.blocks + ' → ' + after.blocks + ' 块';
  });

  await run('选完之后不会被"松手后的 click"清掉', async () => {
    const note = ws.notesOf().find((n) => (n.content || '').split('\n\n').length >= 4);
    f.selectNote(note.id);
    await wait(320);
    const txts = [...document.querySelectorAll('#preview .blk-txt')].filter((t) => (t.textContent || '').trim());
    const a = txts[0].firstChild || txts[0];
    const c = txts[2].firstChild || txts[2];
    const range = document.createRange();
    range.setStart(a, 3);
    range.setEnd(c, 5);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const before = sel.toString().length;
    if (!before) fail('没有选区');

    // 1) 松手后的 click 落在某一块上
    const blk = txts[0].closest('.blk');
    const r = blk.getBoundingClientRect();
    blk.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: Math.round(r.left + 16), clientY: Math.round(r.top + 8) }));

    // 2) 松手后的 click 落在正文空白处（#preview 本身）
    const prev = document.getElementById('preview');
    const pr = prev.getBoundingClientRect();
    prev.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: Math.round(pr.left + pr.width / 2),
      clientY: Math.round(pr.bottom - 6),
    }));
    await wait(260);
    const after = window.getSelection().toString().length;
    if (after !== before) fail('选区被清掉了：' + before + ' → ' + after);
    return '两种落点都不影响：仍选中 ' + after + ' 字';
  });

  await run('跨块拖拽 = 原生选区，复制拿到完整内容', async () => {
    const note = ws.notesOf().find((n) => (n.content || '').split('\n\n').length >= 4);
    f.selectNote(note.id);
    await wait(320);
    const txts = [...document.querySelectorAll('#preview .blk-txt')].filter((t) => (t.textContent || '').trim());
    if (txts.length < 3) fail('块不够');
    const first = txts[0].firstChild || txts[0];
    const third = txts[2].firstChild || txts[2];
    const range = document.createRange();
    range.setStart(first, Math.min(5, (first.nodeValue || '').length));
    range.setEnd(third, Math.min(6, (third.nodeValue || '').length));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    await wait(150);
    const picked = sel.toString();
    if (!picked || !picked.includes('\n')) fail('原生选区没跨块');
    const copied = f.pane.selectedText();
    if (!copied) fail('复制内容为空');
    if (copied.length < picked.length) fail('复制内容和选区不一致');
    return '原生选区 ' + picked.length + ' 字，复制得 ' + copied.length + ' 字';
  });

await run('只选一块也能右键（选中不会被清掉）', async () => {
    const note = ws.notesOf().find((n) => (n.content || '').split('\n\n').length >= 4);
    f.selectNote(note.id);
    await wait(320);
    const blk = document.querySelector('#preview .blk[data-i="2"]');
    const r = blk.getBoundingClientRect();
    const x = Math.round(r.left + 12);
    const y = Math.round(r.top + 8);
    blk.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0, shiftKey: true }));
    blk.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 1, shiftKey: true }));
    blk.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y, shiftKey: true }));
    await wait(260);
    if (!f.pane._sel.size) fail('Shift 点击没有选中');

    // 真实右键：pointerdown(右键) → pointerup → contextmenu
    blk.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 2, buttons: 2 }));
    blk.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 2 }));
    blk.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    await wait(280);
    if (!f.pane._sel.size) fail('右键之后选中被清掉了');
    if (!document.querySelector('#preview .blk.sel')) fail('选中高亮没了');
    const menu = document.querySelector('.blk-menu');
    if (!menu) fail('右键没有菜单');
    const del = [...menu.querySelectorAll('button')].find((b) => b.dataset.act === 'del');
    if (!del) fail('菜单里没有"删除选中"');
    return '单选 → 右键 → 仍可删除，选中数 ' + f.pane._sel.size;
  });

  await run('Shift 点块可以多选，右键整体删除', async () => {
    const note = ws.notesOf().find((n) => (n.content || '').split('\n\n').length >= 4);
    f.selectNote(note.id);
    await wait(320);
    const blockOf = (i) => document.querySelector('#preview .blk[data-i="' + i + '"]');
    const click = (i, mods = {}) => {
      const blk = blockOf(i);
      const r = blk.getBoundingClientRect();
      blk.dispatchEvent(new MouseEvent('click', Object.assign({
        bubbles: true, cancelable: true,
        clientX: Math.round(r.left + 12), clientY: Math.round(r.top + 8),
      }, mods)));
    };
    click(1);
    await wait(200);
    click(3, { shiftKey: true });
    await wait(260);
    const sel = [...f.pane._sel].sort((a, b) => a - b);
    if (sel.join(',') !== '1,2,3') fail('Shift 选区间不对：' + sel.join(','));
    if (document.querySelectorAll('#preview .blk.sel').length !== 3) fail('选中高亮数量不对');

    const before = f.pane._blocks.length;
    const blk = blockOf(2);
    const r = blk.getBoundingClientRect();
    blk.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + 10), clientY: Math.round(r.top + 8),
    }));
    await wait(260);
    const menu = document.querySelector('.blk-menu');
    if (!menu) fail('多选时右键没有菜单');
    const del = [...menu.querySelectorAll('button')].find((b) => b.dataset.act === 'del');
    if (!del) fail('多选菜单里没有删除');
    realClick(del);
    await wait(340);
    if (f.pane._blocks.length !== before - 3) {
      fail('删除块数不对：' + before + ' → ' + f.pane._blocks.length);
    }
    return '选中 3 块 → 删除，' + before + ' → ' + f.pane._blocks.length;
  });

  await run('多选块可以批量改类型 / 缩进 / 勾选', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    const menuOn = (i) => {
      const blk = document.querySelector('#preview .blk[data-i="' + i + '"]');
      const r = blk.getBoundingClientRect();
      blk.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: Math.round(r.left + 12), clientY: Math.round(r.top + 8),
      }));
    };
    const chooseType = async (label) => {
      const typeBtn = [...document.querySelectorAll('.blk-menu:not(.sub) button')]
        .find((b) => b.dataset.act === 'type');
      if (!typeBtn) fail('多选菜单里没有「转为」');
      typeBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await wait(140);
      const sub = document.querySelector('.blk-menu.sub');
      if (!sub) fail('没有弹出「转为」子菜单');
      const target = [...sub.querySelectorAll('button')].find((b) => b.textContent === label);
      if (!target) fail('子菜单里没有「' + label + '」');
      realClick(target);
      await wait(260);
    };
    try {
      f.selectNote(note.id);
      await wait(220);
      note.content = '甲段\n\n乙段\n\n丙段\n\n丁段';
      f.pane.renderBlocks();
      await wait(120);
      f.pane._sel = new Set([0, 1, 2]);
      f.pane.repaintSelection();

      menuOn(1);
      await wait(200);
      const menu = document.querySelector('.blk-menu');
      if (!menu) fail('多选右键没有菜单');
      if (![...menu.querySelectorAll('button')].some((b) => b.dataset.act === 'type')) {
        fail('多选菜单里没有批量「转为」');
      }
      await chooseType('标题 2');
      if (f.pane._blocks[0].type !== 'h2' || f.pane._blocks[1].type !== 'h2' || f.pane._blocks[2].type !== 'h2') {
        fail('批量改类型没作用到全部：' + f.pane._blocks.map((b) => b.type).join(','));
      }
      if (f.pane._blocks[3].type !== 'p') fail('没选中的块被改了');
      if (!ws.note(note.id).content.includes('## 甲段') || !ws.note(note.id).content.includes('## 丙段')) {
        fail('批量改类型后文字丢了');
      }
      if (f.pane._sel.size !== 3) fail('批量改完选中丢了：' + f.pane._sel.size);

      // 批量变成待办
      f.pane._sel = new Set([0, 1, 2]);
      f.pane.repaintSelection();
      menuOn(0);
      await wait(180);
      await chooseType('待办');
      if (!f.pane._blocks.slice(0, 3).every((b) => b.type === 'task')) fail('批量转待办没生效');

      // 多选后一键全部勾选
      f.pane._sel = new Set([0, 1, 2]);
      f.pane.repaintSelection();
      menuOn(0);
      await wait(180);
      const check = [...document.querySelectorAll('.blk-menu button')].find((b) => b.dataset.act === 'check');
      if (!check) fail('多选待办菜单里没有「全部勾选」');
      realClick(check);
      await wait(240);
      if (!f.pane._blocks.slice(0, 3).every((b) => b.type === 'task' && b.done)) fail('全部勾选没生效');

      // 批量转成列表后缩进
      f.pane._sel = new Set([0, 1, 2]);
      f.pane.repaintSelection();
      menuOn(0);
      await wait(180);
      await chooseType('无序列表');
      f.pane._sel = new Set([0, 1, 2]);
      f.pane.repaintSelection();
      menuOn(0);
      await wait(180);
      const indent = [...document.querySelectorAll('.blk-menu button')].find((b) => b.dataset.act === 'indent');
      if (!indent) fail('列表多选菜单里没有「缩进一级」');
      realClick(indent);
      await wait(240);
      if (!f.pane._blocks.slice(0, 3).every((b) => b.type === 'bullet' && b.depth === 1)) {
        fail('批量缩进没生效：' + f.pane._blocks.slice(0, 3).map((b) => b.depth).join(','));
      }
      return '批量改类型 / 全部勾选 / 批量缩进 都正常';
    } finally {
      f.pane._sel.clear();
      if (f.pane.closeBlockMenu) f.pane.closeBlockMenu();
      note.content = original;
      f.pane.renderBlocks();
      await wait(120);
    }
  });

  await run('拖选多行文字后右键，可以批量转块类型', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    f.selectNote(note.id);
    await wait(200);
    try {
      note.content = '甲段\n\n乙段\n\n丙段\n\n丁段';
      f.pane.renderBlocks();
      await wait(180);
      const txts = [...document.querySelectorAll('#preview .blk-txt')];
      if (txts.length < 4) fail('块不够');
      const range = document.createRange();
      range.setStart(txts[0].firstChild, 0);
      range.setEnd(txts[2].firstChild, 2);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      await wait(80);
      const picked = f.pane.selectionBlockIndexes();
      if (picked.join(',') !== '0,1,2') fail('跨块选区识别的块不对：' + picked.join(','));

      const blk = document.querySelector('#preview .blk[data-i="1"]');
      const r = blk.getBoundingClientRect();
      blk.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: Math.round(r.left + 12), clientY: Math.round(r.top + 8),
      }));
      await wait(200);
      const menu = document.querySelector('.blk-menu');
      if (!menu) fail('跨块选区右键没有菜单');
      if (![...menu.querySelectorAll('button')].some((b) => b.dataset.act === 'copy-text')) {
        fail('跨块选区菜单里没有「复制所选文字」');
      }
      const typeBtn = menu.querySelector('[data-act="type"]');
      if (!typeBtn || !typeBtn.textContent.includes('3')) fail('跨块选区菜单里没有批量「转为」');
      typeBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await wait(140);
      const sub = document.querySelector('.blk-menu.sub');
      if (!sub) fail('跨块选区没有「转为」子菜单');
      const h2 = [...sub.querySelectorAll('button')].find((b) => b.dataset.type === 'h2');
      if (!h2) fail('子菜单没有标题 2');
      realClick(h2);
      await wait(300);
      if (!f.pane._blocks.slice(0, 3).every((b) => b.type === 'h2')) fail('批量转标题没作用到 3 块');
      if (f.pane._blocks[3].type !== 'p') fail('没选中的块被改了');
      const content = ws.note(note.id).content;
      if (!content.includes('## 甲段') || !content.includes('## 丙段')) fail('批量转标题后文字丢了');
      return '拖选 3 块文字 → 批量转标题 2';
    } finally {
      if (f.pane.closeBlockMenu) f.pane.closeBlockMenu();
      note.content = original;
      f.pane.renderBlocks();
      await wait(120);
    }
  });

  await run('单宿主：文字选区可以跨块（原生选区）', async () => {
    const note = ws.notesOf().find((n) => (n.content || '').split('\n\n').length >= 4);
    f.selectNote(note.id);
    await wait(320);
    const blocks = [...document.querySelectorAll('#preview .blk')];
    const txts = blocks.map((b) => b.querySelector('.blk-txt')).filter(Boolean);
    if (txts.length < 3) fail('块不够');
    const a = txts[0];
    const b = txts[2];
    const range = document.createRange();
    range.setStart(a.firstChild || a, 2);
    range.setEnd(b.firstChild || b, 4);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    await wait(120);
    const picked = sel.toString();
    if (!picked) fail('跨块选区拿不到文字');
    if (!picked.includes('\n')) fail('选区没有跨过多个块：' + JSON.stringify(picked.slice(0, 30)));
    // 复制跟随选区
    const text = f.pane.selectedText();
    if (!text) fail('selectedText 为空');
    return '跨 3 块选区，文字 ' + picked.length + ' 字（含换行）';
  });

  await run('点块左侧留白，光标落到对应行而不是最后一块', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    f.selectNote(note.id);
    await wait(200);
    try {
      note.content = '# 标题\n\n正文\n\n尾部';
      f.pane.renderBlocks();
      await wait(180);
      const heading = document.querySelector('#preview .blk-h1');
      const r = heading.getBoundingClientRect();
      const preview = document.getElementById('preview');
      const x = Math.round(r.left - 10);
      const y = Math.round(r.top + r.height / 2);
      preview.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
      }));
      await wait(300);
      if (f.pane._focus !== 0) fail('左侧留白点击没有落到标题块：' + f.pane._focus);
      const sel = window.getSelection();
      const el = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      const blk = el && el.closest ? el.closest('.blk') : null;
      if (!blk || Number(blk.dataset.i) !== 0) fail('光标没有停在点击的那一行');
      return '左侧留白点击 → 光标停在对应块，不跳到末尾';
    } finally {
      note.content = original;
      f.pane.renderBlocks();
      await wait(120);
    }
  });

  await run('点最后一块下方空白，自动新开一块并跳转', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    f.selectNote(note.id);
    await wait(220);
    try {
      note.content = '第一段\n\n第二段';
      f.pane.renderBlocks();
      await wait(200);
      const before = f.pane._blocks.length;
      const prev = document.getElementById('preview');
      const r = prev.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.bottom - 8);
      const target = document.elementFromPoint(x, y) || prev;
      pointer(target, 'pointerdown', x, y);
      pointer(window, 'pointerup', x, y);
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
      await wait(340);
      if (f.pane._blocks.length !== before + 1) fail('没有新开一块：' + before + ' → ' + f.pane._blocks.length);
      const lastIndex = f.pane._blocks.length - 1;
      if (f.pane._blocks[lastIndex].type !== 'empty') fail('新开的不是空段落');
      if (f.pane._focus !== lastIndex) fail('没有跳到新块：' + f.pane._focus + ' / ' + lastIndex);
      // 单宿主：焦点在 #preview，光标位置看选区
      const sel = window.getSelection();
      const node = sel && sel.anchorNode;
      const el = node ? (node.nodeType === 1 ? node : node.parentElement) : null;
      const blk = el && el.closest ? el.closest('.blk') : null;
      if (!blk || Number(blk.dataset.i) !== lastIndex) fail('光标不在新块里');
      return '最后一块下方点击 → 新开第 ' + (lastIndex + 1) + ' 块并聚焦';
    } finally {
      note.content = original;
      f.pane.renderBlocks();
      await wait(120);
    }
  });

  await run('画布按钮：临时让画布占满，再点还原', async () => {
    const body = document.getElementById('body');
    const right = document.getElementById('rightPane');
    const canvas = document.getElementById('canvas');
    const btn = document.getElementById('btnFit');
    const before = Math.round(canvas.getBoundingClientRect().width);
    realClick(btn);
    await wait(420);
    const wide = Math.round(canvas.getBoundingClientRect().width);
    if (getComputedStyle(right).display !== 'none') fail('笔记栏没收起来');
    if (wide <= before + 100) fail('画布没有占满：' + before + ' → ' + wide);
    if (Math.abs(wide - body.clientWidth) > 4) fail('画布没有占满整条：' + wide + ' vs ' + body.clientWidth);
    realClick(btn);
    await wait(420);
    if (getComputedStyle(right).display === 'none') fail('再点没有还原笔记栏');
    if (Math.abs(Math.round(canvas.getBoundingClientRect().width) - before) > 4) fail('画布宽度没还原');
    return '画布 ' + before + ' → ' + wide + ' → ' + Math.round(canvas.getBoundingClientRect().width);
  });

  await run('窗口半屏自动只看右边，离开半屏恢复分栏', async () => {
    const body = document.getElementById('body');
    const left = document.getElementById('leftPane');
    const right = document.getElementById('rightPane');
    const saved = ws.state.viewMode;
    f.applyWindowFit({ half: true, full: false });
    await wait(260);
    if (!body.classList.contains('view-right')) fail('半屏没有切到只看右边');
    if (getComputedStyle(left).display !== 'none') fail('半屏时画布还在');
    if (ws.state.viewMode !== saved) fail('自动半屏把 viewMode 持久化改了');

    f.applyWindowFit({ half: false, full: true });
    await wait(260);
    if (body.classList.contains('view-right') || body.classList.contains('view-left')) {
      fail('全屏没有恢复左右分栏');
    }
    if (getComputedStyle(left).display === 'none' || getComputedStyle(right).display === 'none') {
      fail('全屏后还有一栏隐藏');
    }
    f.applyWindowFit({ half: false, full: false });
    await wait(220);
    return '半屏 → 只看右边；全屏 / 普通窗口 → 双栏';
  });

  await run('标题栏走原生拖动区域，支持 Windows 贴边分屏', async () => {
    const titlebar = document.querySelector('.titlebar');
    if (!titlebar) fail('没有标题栏');
    const region = getComputedStyle(titlebar).getPropertyValue('-webkit-app-region');
    if (region !== 'drag') fail('标题栏不是原生拖动区域：' + region);
    const close = document.getElementById('btnClose');
    if (getComputedStyle(close).getPropertyValue('-webkit-app-region') !== 'no-drag') {
      fail('窗口按钮没有排除在拖动区域外');
    }
    const menu = document.querySelector('.menubar');
    if (getComputedStyle(menu).getPropertyValue('-webkit-app-region') !== 'no-drag') {
      fail('菜单没有排除在拖动区域外');
    }
    return '标题栏 drag / 按钮和菜单 no-drag';
  });

  await run('视图：只看左边 / 只看右边 / 恢复分栏', async () => {
    const body = document.getElementById('body');
    const left = document.getElementById('leftPane');
    const right = document.getElementById('rightPane');
    const splitter = document.getElementById('splitter');
    const leftW = Math.round(left.getBoundingClientRect().width);
    const rightW = Math.round(right.getBoundingClientRect().width);

    f.menuAction('view', 0).action();
    await wait(420);
    if (getComputedStyle(right).display !== 'none') {
      fail('只看左边时笔记栏没隐藏：' + body.className + ' / ' + ws.state.viewMode + ' / ' + getComputedStyle(right).display);
    }
    if (getComputedStyle(splitter).display !== 'none') fail('只看左边时分栏条没隐藏');
    if (Math.abs(Math.round(left.getBoundingClientRect().width) - body.clientWidth) > 4) {
      fail('只看左边时画布没占满');
    }
    if (ws.state.viewMode !== 'left') fail('viewMode 没记成 left');

    f.menuAction('view', 1).action();
    await wait(420);
    if (getComputedStyle(left).display !== 'none') fail('只看右边时画布没隐藏');
    if (Math.abs(Math.round(right.getBoundingClientRect().width) - body.clientWidth) > 4) {
      fail('只看右边时笔记栏没占满');
    }
    if (ws.state.viewMode !== 'right') fail('viewMode 没记成 right');

    f.menuAction('view', 2).action();
    await wait(420);
    if (getComputedStyle(left).display === 'none' || getComputedStyle(right).display === 'none') {
      fail('恢复分栏后有一边还是隐藏的');
    }
    if (Math.abs(Math.round(left.getBoundingClientRect().width) - leftW) > 5
      || Math.abs(Math.round(right.getBoundingClientRect().width) - rightW) > 5) {
      fail('恢复分栏后宽度没回来');
    }
    if (ws.state.viewMode !== 'both') fail('viewMode 没记成 both');
    return `分栏 ${leftW}+${rightW} → 左 ${body.clientWidth} / 右 ${body.clientWidth} → 还原`;
  });

  await run('分栏拖到左右边缘自动切单栏', async () => {
    const body = document.getElementById('body');
    const left = document.getElementById('leftPane');
    const right = document.getElementById('rightPane');
    const splitter = document.getElementById('splitter');
    const dragTo = async (x, expectClass) => {
      const r = splitter.getBoundingClientRect();
      const sx = Math.round(r.left + 3);
      const sy = Math.round(r.top + 40);
      splitter.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, clientX: sx, clientY: sy, pointerId: 3, button: 0,
      }));
      splitter.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, clientX: x, clientY: sy, pointerId: 3,
      }));
      await wait(80);
      if (expectClass && !body.classList.contains(expectClass)) {
        fail('拖动过程中没有实时进入 ' + expectClass);
      }
      splitter.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, clientX: x, clientY: sy, pointerId: 3,
      }));
      await wait(420);
    };
    f.menuAction('view', 2).action();
    await wait(320);
    // 100px 处还不够靠近左边缘，不应该提前收起
    await dragTo(100);
    if (ws.state.viewMode !== 'both') fail('100px 处就提前切了单栏');
    if (getComputedStyle(left).display === 'none') fail('100px 处画布已经被收起了');

    f.menuAction('view', 2).action();
    await wait(320);
    await dragTo(0, 'split-collapse-left');
    if (ws.state.viewMode !== 'right') fail('拖到最左没有切到只看右边：' + ws.state.viewMode);
    if (getComputedStyle(left).display !== 'none') fail('拖到最左后画布还在');

    f.menuAction('view', 2).action();
    await wait(320);
    await dragTo(body.clientWidth - 1, 'split-collapse-right');
    if (ws.state.viewMode !== 'left') fail('拖到最右没有切到只看左边：' + ws.state.viewMode);
    if (getComputedStyle(right).display !== 'none') fail('拖到最右后笔记栏还在');

    f.menuAction('view', 2).action();
    await wait(320);
    // 双击分栏条 → 恢复均分
    splitter.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await wait(320);
    if (Math.abs((ws.state.split || 0) - 0.5) > 0.02) fail('双击没有恢复均分：' + ws.state.split);
    return '拖动时实时收起；拖到左 / 右 → 单栏；双击恢复均分';
  });

  await run('画布缩放条能用（走真实指针路径）', async () => {
    const btn = document.getElementById('btnZoomIn');
    if (!btn) fail('没有缩放条');
    const r = btn.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const target = document.elementFromPoint(x, y) || btn;
    if (target !== btn) fail('缩放条被别的东西盖住了：' + (target.className || target.id));
    const before = f.canvas.zoom;
    pointer(target, 'pointerdown', x, y);
    pointer(window, 'pointerup', x, y);
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    await wait(260);
    if (f.canvas._drag) fail('按缩放条被当成了画布拖拽');
    if (!(f.canvas.zoom > before)) fail('点 ＋ 没有放大画布');
    // 再点 − 缩回来
    const zoomed = f.canvas.zoom;
    const out = document.getElementById('btnZoomOut');
    const or = out.getBoundingClientRect();
    const ox = Math.round(or.left + or.width / 2);
    const oy = Math.round(or.top + or.height / 2);
    const outTarget = document.elementFromPoint(ox, oy) || out;
    pointer(outTarget, 'pointerdown', ox, oy);
    pointer(window, 'pointerup', ox, oy);
    outTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: ox, clientY: oy }));
    await wait(260);
    if (!(f.canvas.zoom < zoomed)) fail('点 − 没有缩小画布');
    const pct = (n) => Math.round(n * 100) + '%';
    return '缩放 ' + pct(before) + ' → ' + pct(zoomed) + ' → ' + pct(f.canvas.zoom);
  });

  await run('字数并进底部状态栏的字号那一栏，改了会跟着变', async () => {
    const note = ws.notesOf().find((n) => (n.content || '').length > 20);
    f.selectNote(note.id);
    await wait(320);
    if (document.getElementById('noteMeta')) fail('右栏底部那条字数栏还在');
    const right = document.getElementById('statusRight');
    const text = right.textContent.trim();
    if (!/^字号 \d+% · [\d,]+ 字$/.test(text)) fail('状态栏格式不对：' + JSON.stringify(text));
    const before = Number(text.split('·')[1].replace(/[^\d]/g, ''));
    // 写点东西 → 字数变多
    f.pane.focusBlock(0, 'end');
    await wait(220);
    const ed = activeEditor();
    if (!ed) fail('没有光标');
    setBlockText(ed, (ed.textContent || '') + ' 一二三四五六七八九十');
    await wait(360);
    const after = Number(right.textContent.split('·')[1].replace(/[^\d]/g, ''));
    if (!(after > before)) fail(`字数没更新：${before} → ${after}`);
    return `状态栏「${right.textContent.trim()}」（${before} → ${after}）`;
  });

  await run('焦点在笔记里，单键快捷键不会作用到画布', async () => {
    const note = ws.notesOf()[0];
    f.selectNote(note.id);
    await wait(240);
    f.pane.focusBlock(0, 'end');
    await wait(240);
    const ed = activeEditor();
    if (!ed) fail('没有光标');
    const before = ws.notesOf().length;
    const sel = ws.state.selected;
    const scale = ws.state.zoom;

    // Del：不能删画布上的笔记（更不能弹删除确认框）
    const del = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    ed.dispatchEvent(del);
    await wait(260);
    if (ws.notesOf().length !== before) fail('在笔记里按 Del 删掉了画布笔记');
    if (ws.state.selected !== sel) fail('按 Del 改了画布选中项');
    if (del.defaultPrevented) fail('Del 在笔记里不该被全局拦截');

    // f：不能触发画布"适应窗口"
    const fkey = new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true });
    ed.dispatchEvent(fkey);
    await wait(220);
    if (Math.abs((ws.state.zoom || 1) - (scale || 1)) > 1e-6) fail('在笔记里按 f 把画布缩放了');
    if (fkey.defaultPrevented) fail('字母键在笔记里被全局拦截了');

    // 焦点回到画布后，Del 依然好用
    canvasEl.focus();
    await wait(150);
    if (document.activeElement !== canvasEl && !canvasEl.contains(document.activeElement)) {
      fail('焦点没能回到画布');
    }
    return 'Del / f 只在画布获得焦点时生效';
  });

  await run('笔记里 Ctrl+Z / Ctrl+Y 能撤销和重做', async () => {
    const note = ws.notesOf().find((n) => (n.content || '').length > 20);
    f.selectNote(note.id);
    await wait(240);
    const content = () => ws.note(note.id).content;
    const original = content();
    f.pane.focusBlock(0, 'end');
    await wait(220);
    let ed = activeEditor();
    if (!ed) fail('没有光标');
    const marker = '撤销测试 ' + Date.now();
    setBlockText(ed, marker + ' ' + (ed.textContent || ''));
    await wait(300);
    if (!content().includes(marker)) fail('写入没生效');
    // Ctrl+Z：目标是正文块，应该撤掉这次输入
    ed = activeEditor();
    ed.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z', ctrlKey: true, bubbles: true,
    }));
    await wait(320);
    if (content().includes(marker)) fail('Ctrl+Z 没有撤销掉刚才的输入');
    if (content() !== original) fail('撤销后内容不是原文');
    // Ctrl+Y：重做回来
    const ed2 = activeEditor() || document.querySelector('#preview .blk-txt');
    ed2.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'y', ctrlKey: true, bubbles: true,
    }));
    await wait(320);
    if (!content().includes(marker)) fail('Ctrl+Y 没有重做');
    // 收尾
    ws.note(note.id).content = original;
    f.pane.renderBlocks();
    await wait(150);
    return '撤销 / 重做都作用在笔记内容上';
  });

  await run('改完标题后，代码块 Ctrl+Z 仍是撤代码而不是标题', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    const originalTitle = note.title;
    f.selectNote(note.id);
    await wait(200);
    try {
      note.content = '```js\nconst a = 1;\n```';
      f.pane.renderBlocks();
      await wait(160);
      f.pane.hooks.onRename(note.id, originalTitle + 'X');
      await wait(260);
      f.pane.focusCode(0, 'end');
      await wait(120);
      const ta = document.querySelector('#preview .code-input');
      if (!ta) fail('没有代码输入框');
      ta.value = 'const a = 2;';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(220);
      if (!ws.note(note.id).content.includes('const a = 2;')) fail('代码输入没写回');
      ta.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'z', ctrlKey: true, bubbles: true, cancelable: true,
      }));
      await wait(300);
      if (ws.note(note.id).content.includes('const a = 2;')) fail('Ctrl+Z 没有撤掉代码输入');
      if (!ws.note(note.id).content.includes('const a = 1;')) fail('撤销后代码不是上一版');
      if (ws.note(note.id).title !== originalTitle + 'X') fail('Ctrl+Z 把标题也撤了');
      return '代码 Ctrl+Z 只撤代码，标题保持不变';
    } finally {
      f.pane.hooks.onRename(note.id, originalTitle);
      note.content = original;
      f.pane.renderBlocks();
      await wait(140);
    }
  });

  await run('文本光标在深色背景上看得见', async () => {
    const note = ws.notesOf().find((n) => (n.content || '').length > 20);
    f.selectNote(note.id);
    await wait(250);
    f.pane.focusBlock(0, 'end');
    await wait(250);
    const txt = document.querySelector('#preview .blk-txt');
    if (!txt) fail('没有可编辑的块');
    const caret = getComputedStyle(txt).caretColor;
    // 必须不是主题里的深紫 #7c3aed，且亮度够高
    const rgb = caret.match(/\d+/g);
    if (!rgb || rgb.length < 3) fail('拿不到光标颜色：' + caret);
    const [r, g, b] = rgb.map(Number);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < 150) fail(`光标太暗，看不清：${caret}（亮度 ${Math.round(lum)}）`);
    // 聚焦的块还要有落点提示
    const bg = getComputedStyle(txt).backgroundColor;
    if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') fail('聚焦的块没有落点底色');
    return `光标 ${caret}（亮度 ${Math.round(lum)}）`;
  });

  await run('焦点离开笔记后不保留块编辑底色', async () => {
    const note = ws.notesOf()[0];
    f.selectNote(note.id);
    await wait(220);
    f.pane.focusBlock(0, 'end');
    await wait(160);
    if (!document.querySelector('#preview .blk.cur')) fail('聚焦块后没有编辑底色');

    window.dispatchEvent(new Event('blur'));
    await wait(120);
    if (document.querySelector('#preview .blk.cur')) fail('窗口失焦后块还亮着');

    f.pane.focusBlock(0, 'end');
    await wait(160);
    if (!document.querySelector('#preview .blk.cur')) fail('重新聚焦块后没有底色');
    const title = document.getElementById('noteTitle');
    title.focus();
    await wait(140);
    if (document.querySelector('#preview .blk.cur')) fail('焦点到标题后块还亮着');
    return '窗口失焦 / 点标题都会收掉编辑底色';
  });

  await run('真实输入：input 落在 #preview 也能写回', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    f.selectNote(note.id);
    await wait(200);
    try {
      note.content = '原始文字';
      f.pane.renderBlocks();
      await wait(160);
      f.pane.focusBlock(0, 'end');
      await wait(100);
      const txt = document.querySelector('#preview .blk-txt');
      const preview = document.getElementById('preview');
      if (!txt) fail('没有可编辑块');
      txt.innerHTML = '原始文字X';
      preview.dispatchEvent(new InputEvent('input', {
        bubbles: true, inputType: 'insertText', data: 'X',
      }));
      await wait(240);
      if (!ws.note(note.id).content.includes('原始文字X')) {
        fail('input 落在 #preview 时没有写回：' + ws.note(note.id).content.slice(0, 40));
      }
      return '#preview 上的真实 input 已写回 note.content';
    } finally {
      note.content = original;
      f.pane.renderBlocks();
      await wait(140);
    }
  });

  await run('标题块上方空隙收紧，开头标题不顶空白', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    f.selectNote(note.id);
    await wait(200);
    try {
      note.content = '# 开头标题\n\n正文\n\n## 中间标题';
      f.pane.renderBlocks();
      await wait(180);
      const h1 = document.querySelector('#preview .blk-h1 .blk-txt');
      const h2 = document.querySelector('#preview .blk-h2 .blk-txt');
      if (!h1 || !h2) fail('标题块没渲染');
      if (getComputedStyle(h1).marginTop !== '0px') {
        fail('开头标题还有空隙：' + getComputedStyle(h1).marginTop);
      }
      const h1Blk = h1.closest('.blk');
      if (getComputedStyle(h1Blk).paddingTop !== '0px') fail('开头标题块还有顶部内边距');
      const preview = document.getElementById('preview');
      const gap = Math.round(h1.getBoundingClientRect().top - preview.getBoundingClientRect().top);
      if (gap > 1) fail('开头标题离顶部还有 ' + gap + 'px');
      if (getComputedStyle(h2).marginTop !== '14px') {
        fail('中间标题空隙不对：' + getComputedStyle(h2).marginTop);
      }

      // 笔记开头有空的 ### 块时，真正第一个有内容的标题也必须贴顶
      note.content = '### \n\n### 1.bank 标题';
      f.pane.renderBlocks();
      await wait(180);
      const leading = document.querySelector('#preview > .blk-leading-empty');
      const topHeading = document.querySelector('#preview > .blk-top-heading');
      if (!leading || getComputedStyle(leading).display !== 'none') {
        fail('开头空标题块没有收掉');
      }
      if (!topHeading || !topHeading.textContent.includes('1.bank')) {
        fail('第一个有内容的标题没有被标记');
      }
      const topTxt = topHeading.querySelector('.blk-txt');
      const topGap = Math.round(topTxt.getBoundingClientRect().top
        - document.getElementById('preview').getBoundingClientRect().top);
      if (topGap > 1) fail('有前置空块时标题上方还有 ' + topGap + 'px');
      return '开头空块收掉，第一个有内容的标题贴顶；中间 h2 14px';
    } finally {
      note.content = original;
      f.pane.renderBlocks();
      await wait(120);
    }
  });

  await run('中文与英文 / 数字之间自动留半角空隙', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    f.selectNote(note.id);
    await wait(200);
    try {
      note.content = '中文English中文123';
      f.pane.renderBlocks();
      await wait(180);
      const txt = document.querySelector('#preview .blk-txt');
      if (!txt) fail('没有正文块');
      if (getComputedStyle(txt).getPropertyValue('text-autospace') !== 'normal') {
        fail('正文没有启用 text-autospace');
      }
      const gaps = txt.querySelectorAll('.cjk-gap');
      if (gaps.length !== 3) fail('展示空隙数量不对：' + gaps.length);
      if (note.content !== '中文English中文123') fail('展示空隙写进了正文内容');
      const range = document.createRange();
      range.selectNodeContents(txt);
      for (const gap of gaps) gap.style.display = 'none';
      txt.style.textAutospace = 'no-autospace';
      await wait(60);
      const without = range.getBoundingClientRect().width;
      txt.style.textAutospace = 'normal';
      await wait(60);
      const oldSpace = range.getBoundingClientRect().width;
      for (const gap of gaps) gap.style.display = '';
      await wait(60);
      const withSpace = range.getBoundingClientRect().width;
      if (!(withSpace > oldSpace + .5)) {
        fail(`空隙没有比原来更宽：${oldSpace} → ${withSpace}`);
      }
      if (!(withSpace > without + 1)) {
        fail(`中英混排没有变宽：${without} → ${withSpace}`);
      }
      f.pane.focusBlock(0, 'end');
      await wait(100);
      document.execCommand('insertText', false, 'X');
      await wait(220);
      if (!ws.note(note.id).content.includes('中文English中文123X')) {
        fail('空隙节点挡住了正常输入：' + ws.note(note.id).content);
      }
      if (ws.note(note.id).content.includes('cjk-gap')) fail('空隙节点被写进了正文');

      const title = document.getElementById('noteTitle');
      if (!title || getComputedStyle(title).getPropertyValue('text-autospace') !== 'normal') {
        fail('笔记标题没有启用自动空隙');
      }
      const cardTitle = document.querySelector('.card-title');
      if (cardTitle && getComputedStyle(cardTitle).getPropertyValue('text-autospace') !== 'normal') {
        fail('画布卡片标题没有启用自动空隙');
      }

      note.content = '# 中文English中文123';
      f.pane.renderBlocks();
      await wait(160);
      const h1 = document.querySelector('#preview .blk-h1 .blk-txt');
      if (!h1) fail('没有标题块');
      if (h1.querySelectorAll('.cjk-gap').length !== 3) fail('标题块没有自动空隙');
      return `中英混排宽度 ${without.toFixed(1)} → ${withSpace.toFixed(1)}px，正文 / 标题 / 卡片标题都生效`;
    } finally {
      note.content = original;
      f.pane.renderBlocks();
      await wait(120);
    }
  });

  await run('输入即转换 / Tab 缩进 / 上下键跨块 / 多行粘贴拆块', async () => {
    const note = ws.notesOf()[0];
    f.selectNote(note.id);
    await wait(220);
    const content = () => ws.note(note.id).content;
    const original = content();

    // ① 打 "# 标题" → 直接变成标题块
    f.pane.appendBlock();
    await wait(250);
    let ed = activeEditor();
    if (!ed) fail('没有进入新块');
    setBlockText(ed, '# 自动标题');
    await wait(300);
    if (!/^# 自动标题/m.test(content())) fail('输入 "# " 没有转成标题：' + content().slice(-40));
    if (!document.querySelector('#preview .blk-h1')) fail('预览里没出现 h1 块');

    // ② 打 "- 列表" → 变成无序列表
    f.pane.appendBlock();
    await wait(250);
    ed = activeEditor();
    setBlockText(ed, '- 自动列表');
    await wait(300);
    if (!/^- 自动列表/m.test(content())) fail('输入 "- " 没有转成列表');
    if (!document.querySelector('#preview .blk-bullet')) fail('预览里没出现列表块');

    // ③ Tab 缩进这一块
    const listIndex = f.pane._blocks.findIndex((b) => b.type === 'bullet');
    if (listIndex < 0) fail('找不到列表块');
    f.pane.focusBlock(listIndex, 'end');
    await wait(200);
    ed = activeEditor();
    ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await wait(300);
    const indented = f.pane._blocks[listIndex];
    if (!indented || (indented.depth || 0) !== 1) fail('Tab 没有缩进：' + JSON.stringify(indented && indented.depth));

    // ④ 多行粘贴 → 拆成多块
    const beforePaste = f.pane._blocks.length;
    ed = activeEditor();
    const dt = new DataTransfer();
    dt.setData('text/plain', '粘贴第一行\n粘贴第二行\n粘贴第三行');
    ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await wait(320);
    if (f.pane._blocks.length !== beforePaste + 2) {
      fail(`多行粘贴后块数 ${beforePaste} → ${f.pane._blocks.length}`);
    }
    if (!content().includes('粘贴第三行')) fail('粘贴内容没进笔记');

    // ⑤ 块尾按 ↓ → 光标移到下一块（自己定位，别依赖前面步骤留下的状态）
    const idx = 1;
    f.pane.focusBlock(idx, 'end');
    await wait(200);
    ed = activeEditor();
    if (ed) ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await wait(280);
    if (f.pane._focus === idx) fail('↓ 没有跨到下一块');

    // 还原
    ws.note(note.id).content = original;
    f.pane.renderBlocks();
    await wait(150);
    return '自动转换 / 缩进 / 跨块 / 粘贴拆块 都正常';
  });

  await run('右键正文：文本编辑菜单 + 「转为」子菜单；"/" 只是普通字符', async () => {
    const note = ws.notesOf().find((n) => (n.content || '').split('\n\n').length >= 2);
    f.selectNote(note.id);
    await wait(280);
    f.pane.appendBlock();
    await wait(300);
    const ed = activeEditor();
    if (!ed) fail('空块没有光标');

    // 打 "/"：普通字符，不弹菜单
    ed.innerHTML = '/';
    ed.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(220);
    if (document.querySelector('.blk-menu')) fail('打 / 还是弹菜单了');
    if (!ws.note(note.id).content.includes('/')) fail('/ 没写进内容');

    // 右键 → 文本编辑菜单
    const blk = ed.closest('.blk');
    const r = blk.getBoundingClientRect();
    blk.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + 12), clientY: Math.round(r.top + 10),
    }));
    await wait(260);
    const menu = document.querySelector('.blk-menu');
    if (!menu) fail('右键没有弹出菜单');
    const acts = [...menu.querySelectorAll('button')].map((b) => b.dataset.act).filter(Boolean);
    for (const a of ['cut', 'copy', 'paste', 'select', 'type', 'del']) {
      if (!acts.includes(a)) fail('右键菜单缺少 ' + a);
    }

    // 悬停「转为」→ 子菜单
    const typeBtn = menu.querySelector('[data-act="type"]');
    typeBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await wait(260);
    const sub = document.querySelector('.blk-menu.sub');
    if (!sub) fail('「转为」没有子菜单');
    const types = [...sub.querySelectorAll('button')].map((b) => b.dataset.type);
    for (const t of ['h1', 'h2', 'h3', 'bullet', 'num', 'task', 'quote', 'code', 'hr']) {
      if (!types.includes(t)) fail('子菜单缺少块类型 ' + t);
    }
    const h2 = [...sub.querySelectorAll('button')].find((b) => b.dataset.type === 'h2');
    realClick(h2);   // 走真实指针路径：pointerdown 会先触发"点外面"逻辑
    await wait(320);
    if (!preview.querySelector('.blk-h2')) fail('转成标题 2 没生效');
    if (document.querySelector('.blk-menu')) fail('选完菜单没关掉');
    return '剪切/复制/粘贴/全选 + 转为子菜单，" / " 正常输入';
  });

  await run('在笔记里打字不会因为失焦丢内容', async () => {
    const note = ws.notesOf()[0];
    f.selectNote(note.id);
    await wait(200);
    f.pane.focusBlock(0, 'end');
    await wait(180);
    const ed = activeTA();
    if (!ed) fail('没有进入块编辑');
    const marker = '失焦保留 ' + Date.now();
    setBlockText(ed, marker + ' ' + (ed.textContent || ''));
    await wait(200);
    // 直接切到另一篇（模拟点别的卡片）
    const other = ws.notesOf().find((n) => n.id !== note.id);
    f.selectNote(other.id);
    await wait(280);
    if (!ws.note(note.id).content.includes(marker)) fail('切换笔记时内容丢了');
    return '切走也保住了';
  });

  await run('编辑内容落盘', async () => {
    const note = ws.notesOf()[0];
    f.selectNote(note.id);
    await wait(200);
    const marker = 'selftest ' + Date.now();
    const ed = await openBlock(0);
    if (!ed) fail('没有进入块编辑');
    setBlockText(ed, (ed.textContent || '') + ' ' + marker);
    await f.saveNow();
    await wait(200);
    const loaded = await window.tuyu.load();
    if (!loaded.notes[note.id].content.includes(marker)) fail('没有落盘');
    return '写入并读回成功';
  });

  await run('从哪条边的圆点拉线，就钉在哪条边', async () => {
    const notes = ws.notesOf();
    const src = notes[0];
    f.selectNote(src.id);
    await wait(220);
    const sides = ['e', 'w', 'n', 's'];
    const seen = [];
    for (let i = 0; i < sides.length; i += 1) {
      const target = notes.find((n) => n.id !== src.id && !ws.outgoingAttr(src).has(n.id));
      if (!target) break;
      const dot = document.querySelector('.card.selected .dot[data-side="' + sides[i] + '"]');
      if (!dot) fail('没有 ' + sides[i] + ' 边的圆点');
      const [dx, dy] = center(dot);
      pointer(dot, 'pointerdown', dx, dy);
      const used = c._drag ? c._drag.side : null;
      const [tx, ty] = center(cardOf(target.id));
      pointer(window, 'pointermove', tx, ty);
      pointer(window, 'pointerup', tx, ty);
      await wait(220);
      const pinned = ws.getSides(src.id, target.id);
      if (!used) fail(sides[i] + ' 边按下去没有开始拉线');
      if (['n', 's', 'w', 'e'].includes(used)) fail('拖拽记录的边没归一化：' + used);
      if (!pinned) fail(sides[i] + ' 边拉线后没有记录接口');
      if (pinned.from !== used) fail('钉住的边和拖出来的不一致：' + pinned.from + ' vs ' + used);
      const link = (ws.note(src.id).links || []).find((l) => l.id === target.id);
      if (!link) fail('连线没写进笔记');
      if (link.shape !== 'line') fail('新连线默认不是直线：' + link.shape);
      seen.push(sides[i] + '→' + pinned.from);
    }
    if (seen.length < 2) fail('只测到 ' + seen.length + ' 条边');
    return seen.join(' ');
  });

  await run('连线目标端用松手时最近的那个点', async () => {
    const notes = ws.notesOf();
    const src = notes[0];
    const target = notes.find((n) => n.id !== src.id && !ws.outgoingAttr(src).has(n.id));
    if (!target) fail('没有可用的目标笔记');
    c.hooks.onLinkDrop(src.id, target.id, 'bottom', 'right');
    await wait(220);
    const pinned = ws.getSides(src.id, target.id);
    if (!pinned) fail('没有记录接口');
    if (pinned.to !== 'right') fail('目标边没按松手位置：' + pinned.to + ' vs right');
    if (pinned.from !== 'bottom') fail('源端没按拖出来的边：' + pinned.from);
    ws.removeLink(src.id, target.id);
    ws.clearSides(src.id, target.id);
    c.render();
    await wait(120);
    return '目标端 right（松手在目标右侧）';
  });

  await run('从手柄拉线建立属性连接', async () => {
    const notes = ws.notesOf();
    const src = notes[0];
    let dst = null;
    for (const n of notes.slice(1)) {
      if (!ws.outgoingAttr(src).has(n.id)) { dst = n; break; }
    }
    if (!dst) {
      // 演示数据里已经全连上了：拆掉一条现成的，腾出一个目标
      const other = notes.find((n) => n.id !== src.id);
      if (!other) fail('找不到可连的卡片');
      ws.removeLink(src.id, other.id);
      ws.clearSides(src.id, other.id);
      dst = other;
    }
    f.selectNote(src.id);
    await wait();
    const dot = document.querySelector('.card.selected .dot[data-side="e"]');
    if (!dot) fail('没有连线圆点');
    const [dx, dy] = center(dot);
    pointer(dot, 'pointerdown', dx, dy);
    const dragKind = c._drag && c._drag.kind;
    const [tx, ty] = center(cardOf(dst.id));
    pointer(window, 'pointermove', tx, ty);
    const over = c.hitCard(tx, ty);
    const cr = c.canvasRect;
    const wpt = c.toWorld(tx - cr.left, ty - cr.top).map((v) => Math.round(v));
    const rec = c.records.get(dst.id);
    const expect = c.toScreen([rec.x + rec.w / 2, rec.y + rec.h / 2]).map((v) => Math.round(v));
    const domCenter = [Math.round(tx - cr.left), Math.round(ty - cr.top)];
    const el = cardOf(dst.id);
    const dbg = `tf=${c.world.style.transform} rect=${Math.round(c.canvasRect.width)}x${Math.round(c.canvasRect.height)} z=${c.zoom} cam=${c.cam.map((v) => Math.round(v))} rec=${[rec.x, rec.y, rec.w, rec.h].map((v) => Math.round(v))} el=${el.offsetLeft},${el.offsetTop}`;
    pointer(window, 'pointerup', tx, ty);
    await wait();
    if (!ws.outgoingAttr(ws.note(src.id)).has(dst.id)) {
      fail(`drag=${dragKind} over=${over} expect=${expect} dom=${domCenter} ${dbg}`);
    }
    return `${src.title} -> ${dst.title}`;
  });

  await run('接口定死：移动卡片不换边，可手动重新对准', async () => {
    const notes = ws.notesOf();
    let src = null;
    let dst = null;
    for (const n of notes) {
      const l = (n.links || [])[0];
      if (l && ws.note(l.id)) { src = n; dst = ws.note(l.id); break; }
    }
    if (!src) fail('没有连线可用');
    f.selectNote(src.id);
    await wait();
    const ra = c.records.get(src.id);
    const rb = c.records.get(dst.id);
    const sideOf = (d) => {
      const m = /^M ([\d.-]+) ([\d.-]+)/.exec(d || '');
      if (!m) return null;
      const x = Number(m[1]);
      const y = Number(m[2]);
      const near = (v, t) => Math.abs(v - t) < 1.5;
      if (near(x, ra.x + ra.w) && near(y, ra.y + ra.h / 2)) return 'right';
      if (near(x, ra.x) && near(y, ra.y + ra.h / 2)) return 'left';
      if (near(x, ra.x + ra.w / 2) && near(y, ra.y + ra.h)) return 'bottom';
      if (near(x, ra.x + ra.w / 2) && near(y, ra.y)) return 'top';
      return `other(${x.toFixed(0)},${y.toFixed(0)})`;
    };
    const pathOf = () => {
      const p = document.querySelector(`path.edge[data-src="${src.id}"][data-dst="${dst.id}"]`);
      return p && p.getAttribute('d');
    };
    // 摆成左右并排 → 首次渲染把接口钉成 right/left
    rb.x = ra.x + ra.w + 200;
    rb.y = ra.y;
    c.updateCardPosition(dst.id);
    f.repinLink({ src: src.id, dst: dst.id });
    await wait();
    const pinnedAt = sideOf(pathOf());
    // 真拖着它绕到下面去
    const el = document.querySelector(`.card[data-id="${dst.id}"]`);
    const r = el.getBoundingClientRect();
    const sx = r.left + r.width / 2;
    const sy = r.top + 10;
    pointer(el, 'pointerdown', sx, sy);
    pointer(window, 'pointermove', sx - 100, sy + 320);
    await wait();
    const during = sideOf(pathOf());
    pointer(window, 'pointerup', sx - 100, sy + 320);
    await wait();
    const after = sideOf(pathOf());
    // 手动"重新对准"才换边
    f.repinLink({ src: src.id, dst: dst.id });
    await wait();
    const repinned = sideOf(pathOf());
    if (pinnedAt !== 'right') fail(`初始应为 right，实为 ${pinnedAt}`);
    if (during !== 'right') fail(`拖动中应该定死在 right，实为 ${during}`);
    if (after !== 'right') fail(`松手后应该仍是 right，实为 ${after}`);
    if (repinned !== 'bottom') fail(`重新对准后应为 bottom，实为 ${repinned}`);
    return `right -> 拖动仍 right -> 松手仍 right -> 重新对准 bottom`;
  });

  await run('接口定死会存进 app.json', async () => {
    await f.saveNow();
    await wait(200);
    const loaded = await window.tuyu.load();
    const g = loaded.state.graphs.find((x) => x.id === ws.graphId);
    const keys = g && g.sides ? Object.keys(g.sides) : [];
    if (!keys.length) fail('sides 没写进 app.json');
    const entry = g.sides[keys[0]];
    if (!Array.isArray(entry) || entry.length !== 2) fail('sides 格式不对: ' + JSON.stringify(entry));
    return `${keys.length} 条接口记录，示例 ${keys[0]} = ${entry.join('/')}`;
  });

  await run('右栏填满窗口（空笔记也不能缩成一条）', async () => {
    // 新建一篇空笔记：内容为空时最容易暴露"右栏缩水"的问题
    f.newNote();
    await wait(150);
    const note = ws.note(ws.state.selected);
    if (!note) fail('没有新建成功');
    if ((note.content || '').length !== 0) fail('新笔记不是空的');
    ws.note(ws.state.selected).content = '';
    f.pane.renderBlocks();
    await wait(200);
    const pane = document.getElementById('rightPane').getBoundingClientRect();
    const winW = window.innerWidth;
    const gap = Math.round(winW - pane.right);
    if (Math.abs(gap) > 2) fail(`右栏右侧还空着 ${gap}px（宽 ${Math.round(pane.width)}）`);
    if (pane.width < 300) fail(`右栏只有 ${Math.round(pane.width)}px 宽`);
    f.undo();
    await wait(120);
    return `右栏 ${Math.round(pane.width)}px，右边缘间隙 ${gap}px`;
  });

  await run('新建笔记落在光标所指的位置', async () => {
    const emptyPoint = () => {
      const r = canvasEl.getBoundingClientRect();
      for (const [fx, fy] of [[0.5, 0.88], [0.15, 0.85], [0.85, 0.12], [0.2, 0.2], [0.1, 0.5]]) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        if (!c.hitCard(x, y)) return [x, y];
      }
      return null;
    };
    const pt = emptyPoint();
    if (!pt) fail('找不到空白位置');
    const r = canvasEl.getBoundingClientRect();
    const world = c.toWorld(pt[0] - r.left, pt[1] - r.top);

    // ① 右键空白 → 「在这里新建笔记」
    canvasEl.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: pt[0], clientY: pt[1],
    }));
    await wait(160);
    const rows = [...document.getElementById('popover').querySelectorAll('.item')];
    const item = rows.find((x) => x.textContent.includes('在这里新建笔记'));
    if (!item) fail('右键菜单里没有「在这里新建笔记」');
    item.click();
    await wait(300);
    let note = ws.note(ws.state.selected);
    if (!note) fail('新建后没有选中新笔记');
    let rec = c.records.get(note.id);
    let d = Math.hypot(rec.x + rec.w / 2 - world[0], rec.y + rec.h / 2 - world[1]);
    if (d > 6) fail(`右键新建偏离光标 ${d.toFixed(1)}px（卡片中心 ${Math.round(rec.x + rec.w / 2)},${Math.round(rec.y + rec.h / 2)} / 光标 ${Math.round(world[0])},${Math.round(world[1])}）`);

    // ② 鼠标移到别处，Ctrl+N 也要落在鼠标那儿
    const pt2 = [pt[0] - 60, pt[1] - 40];
    const world2 = c.toWorld(pt2[0] - r.left, pt2[1] - r.top);
    canvasEl.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, clientX: pt2[0], clientY: pt2[1], pointerId: 1,
    }));
    await wait(80);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }));
    await wait(300);
    const note2 = ws.note(ws.state.selected);
    if (!note2 || note2.id === note.id) fail('Ctrl+N 没新建出笔记');
    const rec2 = c.records.get(note2.id);
    const d2 = Math.hypot(rec2.x + rec2.w / 2 - world2[0], rec2.y + rec2.h / 2 - world2[1]);
    if (d2 > 6) fail(`Ctrl+N 偏离鼠标 ${d2.toFixed(1)}px`);

    f.undo();
    f.undo();
    await wait(150);
    return `右键新建偏差 ${d.toFixed(1)}px，Ctrl+N 偏差 ${d2.toFixed(1)}px`;
  });

  await run('标题删空后不会弹回旧标题，能接着输入', async () => {
    f.newNote();
    await wait(350);
    const note = ws.note(ws.state.selected);
    if (!note) fail('没有新建成功');
    const title = document.getElementById('noteTitle');
    if (document.activeElement !== title) fail('新笔记没有把焦点放到标题上');
    const old = note.title;
    // 全选删空
    title.value = '';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(800);                       // 远超过 500ms 的防抖
    if (title.value !== '') fail(`删空后旧标题被写回来了：「${title.value}」`);
    if (ws.note(note.id).title !== old) fail('删空期间不该改笔记标题');
    // 继续输入新标题
    title.value = '负载均衡';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(800);
    if (ws.note(note.id).title !== '负载均衡') fail('新标题没写进笔记：' + ws.note(note.id).title);
    if (title.value !== '负载均衡') fail('输入框被改写了：' + title.value);
    // 空着切走再切回来：标题仍然是被认下来的那个（输入框会按笔记内容刷新）
    title.value = '';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);
    const other = ws.notesOf().find((n) => n.id !== note.id);
    if (other) {
      f.selectNote(other.id);
      await wait(200);
      f.selectNote(note.id);
      await wait(250);
    } else {
      f.selectNote(note.id);
      await wait(250);
    }
    if (ws.note(note.id).title !== '负载均衡') fail('空着切走时笔记标题被改了');
    if (title.value !== '负载均衡') fail('切回来标题不对：' + title.value);
    f.undo();
    await wait(150);
    return '删空不弹回 → 能输入新标题 → 切走切回标题还在';
  });

  await run('工具条 ＋ 从这篇新建并链接', async () => {
    const src = ws.notesOf()[0];
    f.selectNote(src.id);
    await wait(200);
    const before = ws.notesOf().length;
    document.getElementById('toolNew').click();
    await wait(300);
    if (ws.notesOf().length !== before + 1) fail('没有新建笔记');
    const created = ws.note(ws.state.selected);
    if (!created || created.id === src.id) fail('新建后没选中新笔记');
    if (!ws.outgoingAttr(ws.note(src.id)).has(created.id)) fail('没有自动连上源笔记');
    const a = c.records.get(src.id);
    const b = c.records.get(created.id);
    if (!b) fail('新卡片没有记录');
    if (b.x < a.x + a.w) fail('新卡片没有摆在源卡片右边');
    f.undo();
    await wait(150);
    return `新卡片在源卡片右侧 +${Math.round(b.x - (a.x + a.w))}px`;
  });

  await run('右键卡片不切换选中的笔记', async () => {
    const cards = [...document.querySelectorAll('.card')];
    if (cards.length < 2) fail('卡片不够');
    const a = cards[0];
    const b = cards[1];
    f.selectNote(a.dataset.id);
    await wait(220);
    if (c.selected !== a.dataset.id) fail('先选中 A 失败');
    const paneBefore = f.pane.note ? f.pane.note.id : null;

    // ① 正常右键 B：菜单要弹，但选中和右栏都不许变
    const rb = b.getBoundingClientRect();
    b.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: rb.left + rb.width / 2, clientY: rb.top + 12,
    }));
    await wait(240);
    if (document.getElementById('popover').hidden) fail('右键没弹菜单');
    if (c.selected !== a.dataset.id) fail(`右键 B 之后选中被改了：${c.selected}`);
    if ((f.pane.note ? f.pane.note.id : null) !== paneBefore) fail('右键 B 之后右栏被换了');
    const menuForB = [...document.querySelectorAll('#popover .item')]
      .some((x) => x.textContent.includes('删除这篇笔记'));
    if (!menuForB) fail('弹出的不是卡片的右键菜单');
    const ctxMarked = document.querySelectorAll('.card.ctx').length;
    if (ctxMarked !== 1) fail('右键提示高亮数量 = ' + ctxMarked);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(140);

    // ② 落点被浮层接走（事件派发到画布元素、坐标压在 B 上）→ 仍然只弹 B 的菜单，选中不动
    canvasEl.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: rb.left + rb.width / 2, clientY: rb.top + 12,
    }));
    await wait(240);
    const stillB = [...document.querySelectorAll('#popover .item')]
      .some((x) => x.textContent.includes('删除这篇笔记'));
    if (!stillB) fail('浮层挡住时没弹卡片菜单');
    if (c.selected !== a.dataset.id) fail('浮层挡住右键时选中被改了');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(140);
    return '右键只开菜单，选中保持 ' + ws.note(c.selected).title;
  });

  await run('点空白取消选中：右栏保留上一篇笔记', async () => {
    const first = ws.notesOf()[0];
    f.selectNote(first.id, false);
    await wait(120);
    if (c.selected !== first.id) fail('先选中都失败了');
    const titleShown = document.getElementById('noteTitle').value;
    pointer(canvasEl, 'pointerdown', 8, 8);
    pointer(window, 'pointerup', 8, 8);
    await wait(180);
    if (c.selected !== null) fail('点空白后还选着');
    if (ws.state.selected !== null) fail('state.selected 没清空');
    // 取消选中不清空右栏：应该还在看刚才那一篇
    if (!f.pane.note || f.pane.note.id !== first.id) fail('右栏没有保留上一篇笔记');
    if (!document.getElementById('emptyHint').hidden) fail('右栏被清成空态了');
    if (document.getElementById('noteTitle').value !== titleShown) fail('标题被清掉了');
    if (!document.querySelectorAll('#preview .blk').length) fail('正文被清掉了');
    const bar = document.getElementById('nodeToolbar');
    if (!bar.hidden) fail('工具条还挂着');
    return '选中清空，右栏仍显示上一篇';
  });

  await run('取消选中后，右栏那篇会记进 app.json', async () => {
    const first = ws.notesOf()[0];
    f.selectNote(first.id);
    await wait(180);
    pointer(canvasEl, 'pointerdown', 8, 8);
    pointer(window, 'pointerup', 8, 8);
    await wait(250);
    if (c.selected !== null) fail('没有取消选中');
    if (!f.pane.note || f.pane.note.id !== first.id) fail('右栏没保留上一篇');
    await f.saveNow();
    await wait(200);
    const loaded = await window.tuyu.load();
    const g = loaded.state.graphs.find((x) => x.id === ws.graphId);
    if (!g) fail('找不到当前图的状态');
    if (loaded.state.selected !== null) fail('selected 应该是 null');
    if (g.last_note !== first.id) fail('last_note 没写进 app.json');
    return '画板不指任何笔记时，右栏这篇记在 last_note 里';
  });

  await run('拖空白平移时不取消选中', async () => {
    const first = ws.notesOf()[0];
    f.selectNote(first.id, false);
    await wait(100);
    pointer(canvasEl, 'pointerdown', 20, 20);
    pointer(window, 'pointermove', 120, 90);
    pointer(window, 'pointerup', 120, 90);
    await wait(120);
    if (c.selected !== first.id) fail('平移把选中弄丢了');
    f.canvas.fit();
    await wait(80);
    return '平移保留选中';
  });

  await run('再点卡片能重新选中', async () => {
    const card = document.querySelector('.card');
    const [x, y] = center(card);
    pointer(card, 'pointerdown', x, y);
    pointer(window, 'pointerup', x, y);
    await wait(120);
    if (!c.selected) fail('点卡片没选上');
    return `重新选中 ${ws.note(c.selected).title}`;
  });

  await run('拖四角改卡片尺寸', async () => {
    const note = ws.notesOf()[0];
    f.selectNote(note.id);
    await wait();
    const h = document.querySelector('.card.selected .handle[data-corner="se"]');
    if (!h) fail('没有尺寸手柄');
    const rec = c.records.get(note.id);
    const w0 = rec.w;
    const h0 = rec.h;
    const [hx, hy] = center(h);
    pointer(h, 'pointerdown', hx, hy);
    pointer(window, 'pointermove', hx + 70, hy + 50);
    pointer(window, 'pointerup', hx + 70, hy + 50);
    await wait();
    if (!(rec.w > w0 + 30 && rec.h > h0 + 20)) fail(`尺寸没变 ${w0}x${h0} -> ${rec.w}x${rec.h}`);
    const grown = `${Math.round(w0)}x${Math.round(h0)} -> ${Math.round(rec.w)}x${Math.round(rec.h)}`;
    // 再往小拖：能小过以前 220x80 的下限
    const [h2x, h2y] = center(h);
    pointer(h, 'pointerdown', h2x, h2y);
    pointer(window, 'pointermove', h2x - 400, h2y - 400);
    pointer(window, 'pointerup', h2x - 400, h2y - 400);
    await wait();
    if (!(rec.w <= 140 && rec.h <= 60)) fail(`卡片的尺寸下限还是太大：${Math.round(rec.w)}x${Math.round(rec.h)}`);
    return grown + `，再缩到 ${Math.round(rec.w)}x${Math.round(rec.h)}`;
  });

  await run('点连线弹出上方工具栏，能调线宽和箭头大小', async () => {
    const notes = ws.notesOf();
    const a = notes[0];
    const b = notes.find((n) => n.id !== a.id);
    ws.addLink(a.id, b.id);
    ws.setLinkStyle(a.id, b.id, { shape: 'line', arrow: 'solid', width: 2, arrowSize: 6 });
    c.renderEdges();
    await wait(280);
    const hit = document.querySelector('path.hit[data-hitsrc="' + a.id + '"][data-hitdst="' + b.id + '"]');
    if (!hit) fail('找不到这条连线');
    const r = hit.getBoundingClientRect();
    pointer(hit, 'pointerdown', Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    await wait(300);
    const tb = document.getElementById('linkToolbar');
    if (!tb || tb.hidden) fail('点连线没有弹出工具栏');
    const rect = tb.getBoundingClientRect();
    const path = document.querySelector('path.edge[data-src="' + a.id + '"][data-dst="' + b.id + '"]');
    if (!path) fail('找不到这条线的 path');
    // 工具栏必须在"连线中点"的正上方、并且水平居中
    const ra2 = c.records.get(a.id);
    const rb2 = c.records.get(b.id);
    const canvasBox = document.getElementById('canvas').getBoundingClientRect();
    const ma = c.toScreen([ra2.x + ra2.w / 2, ra2.y + ra2.h / 2]);
    const mb = c.toScreen([rb2.x + rb2.w / 2, rb2.y + rb2.h / 2]);
    const midX = (ma[0] + mb[0]) / 2 + canvasBox.left;
    const midY = (ma[1] + mb[1]) / 2 + canvasBox.top;
    if (rect.bottom > midY + 4) fail('工具栏没在连线上方：' + Math.round(rect.bottom) + ' vs ' + Math.round(midY));
    if (Math.abs(rect.left + rect.width / 2 - midX) > 60) fail('工具栏没对准连线中点');
    const link = () => ws.note(a.id).links.find((l) => l.id === b.id);
    // 每次重画都会换掉 path 节点，取最新的那个
    const edge = () => document.querySelector('path.edge[data-src="' + a.id + '"][data-dst="' + b.id + '"]');
    if (link().width !== 2) fail('初始线宽不是 2');
    realClick(document.getElementById('linkSizeUp'));
    realClick(document.getElementById('linkSizeUp'));
    await wait(280);
    if (link().width !== 3) fail('线宽没跟着档位变：' + link().width);

    const p1 = edge();
    if (!p1) fail('连线节点不见了');
    if (p1.getAttribute('stroke-width') !== '3') fail('线宽没画到 path 上：' + p1.getAttribute('stroke-width'));
    await wait(120);
    // 同一档位把箭头一起带上去（2 档 = 箭头 6；4 档 = 箭头 12）
    if (link().arrowSize !== 10) fail('箭头没跟着档位变：' + link().arrowSize);
    const marker = (edge() || { getAttribute: () => '' }).getAttribute('marker-end') || '';
    if (!marker.includes('-10')) fail('箭头 marker 没换尺寸：' + marker);
    if (document.getElementById('linkSizeVal').textContent !== '4') fail('档位数字没同步');
    // 收起
    c.selectedLink = null;
    placeToolbarForTest();
    await wait(150);
    return '工具栏在线条上方，档位 2→4（线宽 2→3、箭头 6→10）';
  });

  await run('连线样式可改', async () => {
    const src = ws.notesOf().find((n) => (n.links || []).length);
    if (!src) fail('没有连线');
    const dst = src.links[0].id;
    f.setLinkShape({ src: src.id, dst }, 'line');
    await wait();
    f.setLinkArrow({ src: src.id, dst }, 'hollow');
    await wait();
    const link = ws.note(src.id).links.find((l) => l.id === dst);
    if (link.shape !== 'line' || link.arrow !== 'hollow') fail(`${link.shape}/${link.arrow}`);
    return '直线 + 空心箭头';
  });

  await run('工具条能调标题字号和上下位置', async () => {
    const note = ws.notesOf()[0];
    f.selectNote(note.id);
    await wait(300);
    const card = () => document.querySelector('.card[data-id="' + note.id + '"]');
    const title = () => card().querySelector('.card-title');
    const fs0 = getComputedStyle(title()).fontSize;
    realClick(document.getElementById('toolFontUp'));
    realClick(document.getElementById('toolFontUp'));
    await wait(320);
    const fs1 = getComputedStyle(title()).fontSize;
    if (fs0 === fs1) fail('字号没变：' + fs0);
    if (Number(ws.note(note.id).titleSize) !== 16) fail('字号没存：' + ws.note(note.id).titleSize);

    realClick(document.getElementById('toolPosDown'));
    await wait(260);
    const tf = getComputedStyle(title()).transform;
    if (!/matrix/.test(tf) || !/, 1\)$/.test(tf)) fail('下移没生效：' + tf);
    realClick(document.getElementById('toolPosUp'));
    realClick(document.getElementById('toolPosUp'));
    await wait(260);
    if (Number(ws.note(note.id).titleOffset) !== -1) fail('偏移没存：' + ws.note(note.id).titleOffset);

    // 还原，别影响后面的用例
    ws.note(note.id).titleSize = 14;
    ws.note(note.id).titleOffset = 0;
    c.render();
    await wait(200);
    return fs0 + ' → ' + fs1 + '，偏移 -1px';
  });

  await run('工具条上的「折叠」隐藏卡片正文，再点展开', async () => {
    // 挑一张本来就有高度的卡片
    let note = null;
    for (const n of ws.notesOf()) {
      const el = document.querySelector('.card[data-id="' + n.id + '"]');
      if (el && el.getBoundingClientRect().height / c.zoom > 90) { note = n; break; }
    }
    if (!note) fail('没有足够高的卡片');
    f.selectNote(note.id);
    await wait(300);
    const card = () => document.querySelector('.card[data-id="' + note.id + '"]');
    if (!card()) fail('找不到卡片');
    const hOf = () => Math.round(card().getBoundingClientRect().height / c.zoom);
    if (!card().querySelector('.card-body')) fail('一开始就没有正文');
    const h0 = hOf();
    if (h0 <= 60) fail('起点高度太小：' + h0);
    const btn = document.getElementById('toolFold');
    if (!btn) fail('工具条上没有折叠按钮');
    realClick(btn);
    await wait(360);
    if (!card().classList.contains('compact')) fail('没有进入折叠态');
    if (card().querySelector('.card-body')) fail('折叠后正文还在');
    const h1 = hOf();
    if (h1 >= h0) fail('折叠后没有变矮：' + h0 + ' → ' + h1);
    realClick(btn);
    await wait(360);
    if (!card().querySelector('.card-body')) fail('展开后正文没回来');
    if (Math.abs(hOf() - h0) > 2) fail('展开后高度没还原：' + h0 + ' → ' + hOf());
    return '高度 ' + h0 + ' → ' + h1 + ' → ' + hOf();
  });

  await run('工具条上的「标记」给卡片打待办，再点取消', async () => {
    const note = ws.notesOf()[0];
    f.selectNote(note.id);
    await wait(260);
    const btn = document.getElementById('toolTodo');
    if (!btn) fail('工具条上没有标记按钮');
    const card = () => document.querySelector('.card[data-id="' + note.id + '"]');
    if (!card()) fail('找不到卡片');
    if (card().querySelector('.card-mark')) fail('一开始就有待办标记');
    realClick(btn);
    await wait(300);
    if (!card().querySelector('.card-mark')) fail('点了标记但没出现待办图标');
    if (!ws.note(note.id).todo) fail('数据里没记上 todo');
    realClick(btn);
    await wait(300);
    if (card().querySelector('.card-mark')) fail('再点一次标记没消失');
    if (ws.note(note.id).todo) fail('数据里的 todo 没清掉');
    return '标记 → 出现 ☑ → 再点消失';
  });

  await run('选中卡片浮出工具条', async () => {
    const note = ws.notesOf()[1] || ws.notesOf()[0];
    f.selectNote(note.id);
    await wait();
    const bar = document.getElementById('nodeToolbar');
    const rect = c.screenRectOf(note.id);
    if (bar.hidden) fail('工具条没出现');
    const cx = parseFloat(bar.style.left) + bar.offsetWidth / 2;
    // 工具条变宽后，贴边时会被夹在视口内，容许更大偏差
    if (Math.abs(cx - (rect.x + rect.w / 2)) > 90) fail('工具条没对准卡片');
    return '位置正确';
  });

  await run('拖动卡片时暂时隐藏工具条', async () => {
    const note = ws.notesOf()[1] || ws.notesOf()[0];
    f.selectNote(note.id);
    await wait(180);
    const card = document.querySelector('.card.selected');
    if (!card) fail('没有选中的卡片');
    const bar = document.getElementById('nodeToolbar');
    if (bar.hidden) fail('拖动前工具条没出现');
    const [x, y] = center(card);
    pointer(card, 'pointerdown', x, y);
    pointer(window, 'pointermove', x + 60, y + 40);
    await wait(120);
    if (!document.getElementById('canvas').classList.contains('card-dragging')) {
      fail('拖动时画布没有进入 card-dragging');
    }
    if (getComputedStyle(bar).display !== 'none') fail('拖动时工具条还显示');
    pointer(window, 'pointerup', x + 60, y + 40);
    await wait(220);
    if (document.getElementById('canvas').classList.contains('card-dragging')) {
      fail('松手后 card-dragging 没清掉');
    }
    if (bar.hidden || getComputedStyle(bar).display === 'none') fail('松手后工具条没回来');
    return '拖动隐藏，松手恢复';
  });

  await run('右键卡片弹出菜单', async () => {
    const card = $('.card');
    const [x, y] = center(card);
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: x, clientY: y }));
    await wait();
    const pop = document.getElementById('popover');
    const shown = !pop.hidden && pop.querySelectorAll('.item').length >= 2;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait();
    if (!shown) fail('菜单没出来');
    return '菜单可见';
  });

  await run('点阵背景', async () => {
    const bg = getComputedStyle(canvasEl).backgroundImage;
    if (!bg.includes('radial-gradient')) fail(bg);
    return 'CSS 点阵';
  });

  await run('拖分栏后比例记下来，重启还是同一个比例', async () => {
    const body = document.getElementById('body');
    const left = document.getElementById('leftPane');
    const splitter = document.getElementById('splitter');
    const before = left.getBoundingClientRect().width;
    const target = Math.round(body.clientWidth * 0.36);
    const dx = target - before;
    const r = splitter.getBoundingClientRect();
    const sx = r.left + 3;
    const sy = r.top + 40;
    splitter.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, clientX: sx, clientY: sy, pointerId: 1, button: 0,
    }));
    splitter.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, clientX: sx + dx, clientY: sy, pointerId: 1,
    }));
    splitter.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, clientX: sx + dx, clientY: sy, pointerId: 1,
    }));
    await wait(500);
    const ratio = +(left.getBoundingClientRect().width / body.clientWidth).toFixed(3);
    if (Math.abs(ratio - ws.state.split) > 0.02) fail(`比例没写进 state：${ratio} vs ${ws.state.split}`);
    if (Math.abs(ratio - 0.36) > 0.05) fail(`拖完比例不对：${ratio}`);
    // 落盘 + 读回
    await f.saveNow();
    await wait(200);
    const loaded = await window.tuyu.load();
    const saved = loaded.state.split || 0;
    if (Math.abs(saved - ws.state.split) > 0.005) fail(`比例没落盘：${saved} vs ${ws.state.split}`);
    // 用读回来的比例重算一次，应该和屏幕上的一致
    const again = Math.round(body.clientWidth * saved) / body.clientWidth;
    if (Math.abs(again - ratio) > 0.03) fail(`重开后比例会变：${again} vs ${ratio}`);
    return `比例 ${saved}（${Math.round(ratio * 100)}%）已记住`;
  });

  await run('重启后恢复视图', async () => {
    const st = { split: ws.state.split, zoom: ws.state.zoom, sel: ws.state.selected };
    await f.saveNow();
    await wait(150);
    const loaded = await window.tuyu.load();
    if (Math.abs((loaded.state.split || 0.5) - st.split) > 0.01) fail('分栏没存');
    if (Math.abs((loaded.state.zoom || 1) - st.zoom) > 0.01) fail('字号没存');
    if (loaded.state.selected !== st.sel) fail('选中项没存');
    return '分栏 / 字号 / 选中项都在';
  });

  // ---------------------------------------------------------------- 代码块（Typora 式）
  const keyOn = (el, key, extra = {}) => el.dispatchEvent(new KeyboardEvent('keydown', Object.assign({
    key, bubbles: true, cancelable: true,
  }, extra)));
  const codeBlockOf = () => document.querySelector('#preview .blk-code');
  const codeInputOf = (i = 0) => {
    const blk = document.querySelectorAll('#preview .blk-code')[i];
    return blk ? blk.querySelector('.code-input') : null;
  };
  const setCodeContent = async (md) => {
    ws.note(ws.state.selected).content = md;
    f.pane.renderBlocks();
    await wait(140);
  };
  const restoreNoteContent = async (note, content) => {
    f.selectNote(note.id);
    await wait(160);
    note.content = content;
    f.pane.renderBlocks();
    await wait(140);
  };

  await run('代码块：原地编辑、行号、语言框、实时写回', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    f.selectNote(note.id);
    await wait(220);
    await setCodeContent('# 代码\n\n```js\nconst a = 1;\nconsole.log(a);\n```\n\n尾部');
    const blk = codeBlockOf();
    if (!blk) fail('没有渲染出代码块');
    const ta = blk.querySelector('.code-input');
    const lang = blk.querySelector('.code-lang');
    if (!ta) fail('代码块没有输入框（还是点开才编辑）');
    if (blk.querySelector('.blk-editor')) fail('代码块还是 textarea 源码模式');
    if (blk.classList.contains('is-editing')) fail('代码块进入了 is-editing 模式');
    if (ta.value !== 'const a = 1;\nconsole.log(a);') fail('输入框文本不对：' + ta.value);
    if (blk.querySelectorAll('.code-gutter div').length !== 2) fail('行号数量不对');
    if (lang.value !== 'js') fail('语言框没显示 js：' + lang.value);
    if (!/tok-kw/.test(blk.querySelector('.code-hl').innerHTML)) fail('没有语法着色');

    // 输入：DOM 不重建，note.content 立刻更新
    const same = blk;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.value = 'const a = 2;\nconsole.log(a);';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(120);
    if (same !== codeBlockOf()) fail('打字把整块重排了');
    if (!ws.note(note.id).content.includes('const a = 2;')) fail('输入没实时写回');
    if (codeBlockOf().querySelectorAll('.code-gutter div').length !== 2) fail('行号没跟着更新');

    // 超长行：高亮层跟着输入框一起横向滚动
    const long = 'const long = "' + 'x'.repeat(160) + '";';
    ta.value = long;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(100);
    ta.scrollLeft = 40;
    ta.dispatchEvent(new Event('scroll'));
    await wait(60);
    const tf = codeBlockOf().querySelector('.code-hl').style.transform;
    if (!tf.includes('translateX(-40px)')) fail('高亮层没跟着横向滚动：' + tf);

    // 兜底：即使 blk.src 因为某次重排被清空，写回时也要以 DOM 里的代码为准
    f.pane._blocks[0].src = '';
    f.pane.writeBack();
    if (!ws.note(note.id).content.includes('const long')) fail('写回时没兜住 DOM 里的代码');

    await restoreNoteContent(note, original);
    return '原地输入 / 行号 / 语言 / 高亮都正常';
  });

  await run('代码块输入法组合期间不会整块变白', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    try {
      f.selectNote(note.id);
      await wait(220);
      note.content = '```js\nconst a = 1;\n```';
      f.pane.renderBlocks();
      await wait(180);
      f.pane.focusCode(0, 'end');
      const ta = f.pane.codeInput(0);
      ta.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      ta.value = 'const a = 1;\n中';
      ta.dispatchEvent(new InputEvent('input', {
        bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: '中',
      }));
      await wait(160);
      const blk = ta.closest('.blk-code');
      const hl = blk.querySelector('.code-hl');
      if (!blk.classList.contains('composing')) fail('没有进入 composing 状态');
      if (!hl.textContent.includes('中')) fail('高亮层没有组合文字');
      if (getComputedStyle(hl).visibility === 'hidden') fail('组合期间高亮层被藏起来了');
      const fill = getComputedStyle(ta).webkitTextFillColor;
      if (fill !== 'rgba(0, 0, 0, 0)' && fill !== 'transparent') {
        fail('组合期间输入框文字被显示成实色：' + fill);
      }
      if (!blk.querySelector('.tok-kw')) fail('原有语法颜色没了');
      ta.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      await wait(140);
      if (blk.classList.contains('composing')) fail('组合结束后 composing 没清掉');
      if (!ws.note(note.id).content.includes('中')) fail('组合文字没写回');
    } finally {
      note.content = original;
      f.pane.renderBlocks();
      await wait(140);
    }
    return '组合期间高亮可见、输入框透明、语法颜色保留';
  });

  await run('代码块按键：回车缩进、Tab 制表、Shift+Tab 退格', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    f.selectNote(note.id);
    await wait(200);
    await setCodeContent('```js\nif (x) {\n}\n```');
    f.pane.focusCode(0, 'end');
    let ta = codeInputOf();
    ta.setSelectionRange(8, 8);                 // "if (x) {" 的末尾
    keyOn(ta, 'Enter');
    await wait(100);
    if (!ta.value.startsWith('if (x) {\n  \n}')) fail('回车没自动缩进：' + JSON.stringify(ta.value));
    if (!ws.note(note.id).content.includes('if (x) {\n  \n}')) fail('回车换行没写回');

    ta.setSelectionRange(0, 0);
    keyOn(ta, 'Tab');
    await wait(100);
    if (ta.value[0] !== '\t') fail('Tab 没插入制表符：' + JSON.stringify(ta.value.slice(0, 4)));

    ta.setSelectionRange(1, 1);
    keyOn(ta, 'Tab', { shiftKey: true });
    await wait(100);
    if (ta.value[0] === '\t') fail('Shift+Tab 没退掉制表符');

    await restoreNoteContent(note, original);
    return 'Enter 缩进 2 空格 / Tab 制表符 / Shift+Tab 退回';
  });

  await run('空代码块里退格 / 删除直接移除整块', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    try {
      f.selectNote(note.id);
      await wait(220);
      note.content = '前文\n\n```js\n```\n\n后文';
      f.pane.renderBlocks();
      await wait(180);
      if (f.pane._blocks.length !== 3) fail('初始块数不对：' + f.pane._blocks.length);
      f.pane.focusCode(1, 'start');
      await wait(100);
      const ta = f.pane.codeInput(1);
      if (!ta) fail('没有代码输入框');
      keyOn(ta, 'Backspace');
      await wait(280);
      if (f.pane._blocks.length !== 2) fail('空代码块没被删掉：' + f.pane._blocks.length);
      if (f.pane._blocks.some((b) => b.type === 'code')) fail('还留着 code 块');
      if (note.content.includes('```')) fail('源码里还留着围栏');

      note.content = '```\n```';
      f.pane.renderBlocks();
      await wait(180);
      const emptyCode = document.querySelector('.blk-code');
      if (emptyCode.getBoundingClientRect().height > 50) {
        fail('空代码块还是多行高：' + emptyCode.getBoundingClientRect().height);
      }
      f.pane.focusCode(0, 'start');
      keyOn(f.pane.codeInput(0), 'Delete');
      await wait(280);
      if (f.pane._blocks.length !== 1 || f.pane._blocks[0].type !== 'empty') {
        fail('唯一空代码块删除后不是单个空块');
      }
      if (note.content !== '') fail('源码没有清空：' + JSON.stringify(note.content));
    } finally {
      note.content = original;
      f.pane.renderBlocks();
      await wait(140);
    }
    return '空代码块退格 / Delete → 整块删除';
  });

  await run('最后一块无序列表回车后，新列表可编辑且能离开', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    try {
      f.selectNote(note.id);
      await wait(220);
      note.content = '- 第一项';
      f.pane.renderBlocks();
      await wait(180);
      const first = document.querySelector('#preview .blk-txt');
      f.pane.focusBlock(0, 'end');
      keyOn(first, 'Enter');
      await wait(240);
      if (f.pane._blocks.length !== 2) fail('回车没有拆出第二块');
      if (f.pane._blocks[1].type !== 'bullet') fail('新块不是无序列表');
      const second = document.querySelector('#preview .blk[data-i="1"] .blk-txt');
      if (!second) fail('新列表块没有文本容器');
      if (!second.contains(window.getSelection().anchorNode)) fail('光标没进新列表块');
      if (second.getBoundingClientRect().height < 10) fail('空列表块没有可编辑高度');
      second.textContent = '第二项';
      second.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '第二项' }));
      await wait(160);
      if (!ws.note(note.id).content.includes('第二项')) fail('新列表块不能编辑');
      if (f.pane._blocks.length !== 2) fail('编辑后块数变化');
    } finally {
      f.pane.show(null);
      note.content = original;
      f.selectNote(note.id);
      await wait(160);
    }
    return '最后列表回车 → 新列表可编辑';
  });

  await run('最后一块空无序列表按 ↓ 退出列表', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    try {
      f.selectNote(note.id);
      await wait(220);
      note.content = '- 第一项';
      f.pane.renderBlocks();
      await wait(160);
      f.pane.focusBlock(0, 'end');
      keyOn(document.querySelector('#preview .blk-txt'), 'Enter');
      await wait(200);
      const empty = document.querySelector('#preview .blk[data-i="1"] .blk-txt');
      if (!empty) fail('没有生成空列表块');
      keyOn(empty, 'ArrowDown');
      await wait(220);
      if (f.pane._blocks.length !== 2) fail('↓ 多生成了一块');
      if (['bullet', 'num', 'task'].includes(f.pane._blocks[1].type)) {
        fail('↓ 没有退出无序列表：' + f.pane._blocks[1].type);
      }
    } finally {
      f.pane.show(null);
      note.content = original;
      f.selectNote(note.id);
      await wait(160);
    }
    return '空列表 ↓ → 普通段落';
  });

  await run('代码块按 ↓ 到下一块时，右栏滚到光标处', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    try {
      f.selectNote(note.id);
      await wait(220);
      note.content = '```js\n' + Array.from({ length: 36 }, (_, i) => `const line${i} = ${i};`).join('\n')
        + '\n```\n\n目的地段落';
      f.pane.renderBlocks();
      await wait(180);
      const preview = document.getElementById('preview');
      preview.scrollTop = 0;
      f.pane.focusCode(0, 'end');
      await wait(100);
      keyOn(f.pane.codeInput(0), 'ArrowDown');
      await wait(260);
      const target = document.querySelector('#preview .blk[data-i="1"]');
      if (!target) fail('没有落到下一块');
      const tr = target.getBoundingClientRect();
      const br = preview.getBoundingClientRect();
      if (tr.bottom < br.top || tr.top > br.bottom) {
        fail('下一块在视口外：' + JSON.stringify({ top: tr.top, bottom: tr.bottom, viewTop: br.top, viewBottom: br.bottom }));
      }
    } finally {
      f.pane.show(null);
      note.content = original;
      f.selectNote(note.id);
      await wait(160);
    }
    return '↓ 离开代码块后右栏跟随光标';
  });

  await run('代码块：↓ 从末行出去、↑ 从首行出去、块首退格不拆围栏', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    f.selectNote(note.id);
    await wait(200);

    // 下面已经有段落：↓ 直接落到它开头
    await setCodeContent('```js\nconst a = 1;\n```\n\n尾部');
    f.pane.focusCode(0, 'end');
    keyOn(codeInputOf(), 'ArrowDown');
    await wait(140);
    if (f.pane._focus !== 1) fail('↓ 没落到下一段：' + f.pane._focus);
    if (document.activeElement && document.activeElement.classList.contains('code-input')) fail('焦点还在代码里');

    // 下面是代码块：Typora 会补一个空段落
    await setCodeContent('```js\nconst a = 1;\n```');
    f.pane.focusCode(0, 'end');
    keyOn(codeInputOf(), 'ArrowDown');
    await wait(140);
    if (f.pane._blocks.length !== 2 || f.pane._blocks[1].type !== 'empty') {
      fail('↓ 出去没补空段落：' + f.pane._blocks.map((b) => b.type).join(','));
    }

    // 第一块是代码：↑ 在上面补空段落
    await setCodeContent('```js\nconst a = 1;\n```');
    f.pane.focusCode(0, 'start');
    keyOn(codeInputOf(), 'ArrowUp');
    await wait(140);
    if (f.pane._blocks[0].type !== 'empty' || f.pane._blocks[1].type !== 'code') {
      fail('↑ 出去没补空段落：' + f.pane._blocks.map((b) => b.type).join(','));
    }

    // 末尾已经是空行时再按回车：离开代码块，而不是继续往里堆空行
    await setCodeContent('```js\nconst a = 1;\n\n```');
    f.pane.focusCode(0, 'end');
    await wait(100);
    keyOn(codeInputOf(), 'Enter');
    await wait(160);
    if (f.pane._blocks.length !== 2 || f.pane._blocks[1].type !== 'empty') {
      fail('末行空行回车没有离开代码块：' + f.pane._blocks.map((b) => b.type).join(','));
    }
    if (!ws.note(note.id).content.includes('const a = 1;')) fail('离开代码块时把代码弄丢了');

    // 非空代码块行首退格：不拆围栏，代码块保持
    await setCodeContent('前文\n\n```js\nconst keep = 1;\n```\n\n后文');
    f.pane.focusCode(1, 'start');
    keyOn(codeInputOf(), 'Backspace');
    await wait(140);
    if (!codeBlockOf()) fail('块首退格把代码块拆掉了');
    if (!ws.note(note.id).content.includes('const keep = 1;')) fail('块首退格把代码删掉了');
    if (f.pane._blocks[1].type !== 'code') fail('块首退格改变了代码块类型');

    // 代码块下面那段的开头按退格：文字要接进代码，不能写丢
    await setCodeContent('```js\nconst a = 1;\n```\n\n后文');
    f.pane.focusBlock(1, 'start');
    await wait(100);
    const afterTxt = document.querySelector('#preview .blk[data-i="1"] .blk-txt');
    if (!afterTxt) fail('代码块后面的段落没渲染');
    keyOn(afterTxt, 'Backspace');
    await wait(140);
    if (!ws.note(note.id).content.includes('后文')) fail('段首退格把后面的文字吞了');
    if (f.pane._blocks[0].type !== 'code') fail('上一块不是代码了');

    // 代码块后面的空块里输入再回车：代码和前面的标题都不能丢
    await setCodeContent('# 标题\n\n```js\nconst a = 1;\n```');
    f.pane.appendBlock();
    await wait(160);
    const lastIndex = f.pane._blocks.length - 1;
    let lastTxt = document.querySelector('#preview .blk[data-i="' + lastIndex + '"] .blk-txt');
    lastTxt.innerHTML = '空块里输入';
    lastTxt.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(80);
    f.pane.focusBlock(lastIndex, 'end');
    await wait(80);
    lastTxt = document.querySelector('#preview .blk[data-i="' + lastIndex + '"] .blk-txt');
    keyOn(lastTxt, 'Enter');
    await wait(160);
    const afterEmpty = ws.note(note.id).content;
    if (!afterEmpty.includes('const a = 1;')) fail('空块里回车把前面的代码弄丢了');
    if (!afterEmpty.includes('# 标题')) fail('空块里回车把前面的标题弄丢了');
    if (!afterEmpty.includes('空块里输入')) fail('空块里输入的文字丢了');

    // 空块要有正常行高，鼠标点得中（以前只有 4px 高，容易点到代码块上）
    const emptyNow = document.querySelector('#preview .blk-empty .blk-txt');
    if (emptyNow && emptyNow.getBoundingClientRect().height < 18) {
      fail('空块太矮，点不中：' + emptyNow.getBoundingClientRect().height + 'px');
    }

    // 语言标注要嵌在代码框右下角，而不是掉到代码框外面
    await setCodeContent('```js\nconst a = 1;\n```\n\n下一块');
    const codeBox = document.querySelector('#preview .blk-code .code-box');
    const langBox = document.querySelector('#preview .blk-code .code-lang');
    if (!codeBox || !langBox) fail('代码块没有语言框');
    const cb = codeBox.getBoundingClientRect();
    const lb = langBox.getBoundingClientRect();
    if (lb.top < cb.top || lb.bottom > cb.bottom || lb.left < cb.left || lb.right > cb.right) {
      fail('语言框跑到代码框外面了');
    }
    if (cb.bottom - lb.bottom > 14 || cb.right - lb.right > 14) {
      fail('语言框没有贴住代码框右下角');
    }

    await restoreNoteContent(note, original);
    return '↓ / ↑ 正常离开；块首退格不再拆代码围栏';
  });

  await run('代码块：```js + 回车建块，语言框能改围栏', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    f.selectNote(note.id);
    await wait(200);
    await setCodeContent('前文');
    f.pane.appendBlock();
    await wait(160);
    const blocks = [...document.querySelectorAll('#preview .blk')];
    const txt = blocks[blocks.length - 1].querySelector('.blk-txt');
    if (!txt) fail('没造出普通段落');
    txt.innerHTML = '```js';
    txt.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(80);
    keyOn(txt, 'Enter');
    await wait(140);
    const last = f.pane._blocks[f.pane._blocks.length - 1];
    if (last.type !== 'code' || last.lang !== 'js') fail('```js + 回车没变代码块：' + JSON.stringify(last));
    const ta = codeInputOf();
    if (!ta) fail('新代码块没有输入框');
    if (document.activeElement !== ta) fail('光标没进代码块');

    const langInput = codeBlockOf().querySelector('.code-lang');
    langInput.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerId: 1, button: 0,
    }));
    langInput.focus();
    langInput.value = 'python';
    langInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(120);
    if (!document.querySelector('.code-lang-menu')) fail('语言下拉没出来');
    keyOn(langInput, 'Enter');
    await wait(140);
    if (last.lang !== 'python') fail('语言没改：' + last.lang);
    if (!ws.note(note.id).content.includes('```python')) fail('围栏语言没写回');
    if (codeBlockOf().querySelector('.code-lang').value !== 'python') fail('语言框没同步');

    await restoreNoteContent(note, original);
    return '```js 建块 / 语言下拉改 python 都正常';
  });

  await run('最后一块是代码块：点下方空白新建段落', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    f.selectNote(note.id);
    await wait(200);
    try {
      note.content = '前言\n\n```js\nconst a = 1;\n```';
      f.pane.renderBlocks();
      await wait(220);
      const before = f.pane._blocks.length;
      const preview = document.getElementById('preview');
      const codeBox = document.querySelector('#preview .blk-code .code-box');
      if (!codeBox) fail('没有代码块');
      const pr = preview.getBoundingClientRect();
      const cr = codeBox.getBoundingClientRect();
      const x = Math.round(pr.left + pr.width / 2);
      const y = Math.round(Math.min(pr.bottom - 12, cr.bottom + 34));
      preview.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
      }));
      await wait(220);
      const last = f.pane._blocks[f.pane._blocks.length - 1];
      if (f.pane._blocks.length !== before + 1) {
        fail('点代码块下面没有新增块：' + before + ' → ' + f.pane._blocks.length);
      }
      if (!last || last.type !== 'empty') fail('新增的不是空段落：' + (last && last.type));
      if (f.pane._focus !== f.pane._blocks.length - 1) fail('没有跳到新块');
      if (!ws.note(note.id).content.includes('const a = 1;')) fail('新增块时把代码弄丢了');
      return '最后一块代码 → 点下方空白新增并跳转段落';
    } finally {
      await restoreNoteContent(note, original);
    }
  });

  await run('代码块语言标注：编辑时隐藏，靠近显示', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    f.selectNote(note.id);
    await wait(200);
    try {
      note.content = '```js\nconst a = 1;\n```\n\n后文';
      f.pane.renderBlocks();
      await wait(220);
      f.pane.focusCode(0, 'end');
      await wait(200);
      const block = document.querySelector('#preview .blk-code');
      const foot = block.querySelector('.code-foot');
      if (!block.classList.contains('cur')) fail('代码块没有进入编辑态');
      if (getComputedStyle(foot).opacity !== '0') fail('编辑代码时语言框还显示着');

      const box = block.querySelector('.code-box').getBoundingClientRect();
      block.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        clientX: Math.round(box.right - 30),
        clientY: Math.round(box.bottom - 16),
      }));
      await wait(180);
      if (!block.classList.contains('lang-near')) fail('鼠标靠近右下角没有触发展示');
      if (getComputedStyle(foot).opacity !== '1') fail('鼠标靠近后语言框还是隐藏的');

      block.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }));
      await wait(180);
      if (getComputedStyle(foot).opacity !== '0') fail('鼠标离开后语言框没有重新隐藏');

      f.pane.focusBlock(1, 'end');
      await wait(200);
      if (getComputedStyle(foot).opacity !== '1') fail('不编辑代码时语言框没有常显');
      return '编辑隐藏 / 靠近显示 / 非编辑常显';
    } finally {
      await restoreNoteContent(note, original);
    }
  });

  await run('代码块：中文精确占两个字符宽', async () => {
    await (document.fonts && document.fonts.ready);
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:pre;'
      + 'font:13.5px Consolas,"FYN Code CJK",monospace;';
    document.body.appendChild(host);
    const widthOf = (text) => {
      host.textContent = text;
      const range = document.createRange();
      range.selectNodeContents(host);
      return range.getBoundingClientRect().width;
    };
    const space = widthOf(' ');
    const latin = widthOf('M');
    const cjk = widthOf('中');
    host.remove();
    if (Math.abs(latin - space) > .05) fail(`代码块空格和字母不等宽：${space} / ${latin}`);
    if (Math.abs(cjk - space * 2) > .2) {
      fail(`中文不是精确两格：${cjk}，两格 ${space * 2}`);
    }
    return `代码格 ${space.toFixed(2)}px，中文 ${cjk.toFixed(2)}px`;
  });

  await run('标题块最前面回车：插入空段落，标题保留', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    f.selectNote(note.id);
    await wait(200);
    try {
      note.content = '## 原标题';
      f.pane.renderBlocks();
      await wait(180);
      f.pane.focusBlock(0, 'start');
      await wait(100);
      const txt = document.querySelector('#preview .blk-h2 .blk-txt');
      if (!txt) fail('标题块没渲染');
      txt.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', bubbles: true, cancelable: true,
      }));
      await wait(240);
      if (f.pane._blocks.length !== 2) fail('回车后块数不对：' + f.pane._blocks.length);
      if (!['p', 'empty'].includes(f.pane._blocks[0].type) || f.pane._blocks[0].inline) {
        fail('标题上面没有插入空段落：' + JSON.stringify(f.pane._blocks[0]));
      }
      if (f.pane._blocks[1].type !== 'h2' || f.pane._blocks[1].inline !== '原标题') {
        fail('原标题被降级或弄丢：' + JSON.stringify(f.pane._blocks[1]));
      }
      if (f.pane._focus !== 0) fail('光标没落到上面的空段落');
      return '标题前回车 → 空段落在上，标题格式和文字保留';
    } finally {
      note.content = original;
      f.pane.renderBlocks();
      await wait(120);
    }
  });

  await run('前置空标题时，在标题首行回车能看到新空行', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    f.selectNote(note.id);
    await wait(200);
    try {
      note.content = '### \n\n### 1.bank 标题';
      f.pane.renderBlocks();
      await wait(180);
      f.pane.focusBlock(1, 'start');
      await wait(100);
      const h = document.querySelector('#preview .blk[data-i="1"] .blk-txt');
      if (!h) fail('标题块没渲染');
      h.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', bubbles: true, cancelable: true,
      }));
      await wait(260);
      const blocks = f.pane._blocks;
      if (blocks.length !== 3) fail('块数不对：' + blocks.length);
      if (!['p', 'empty'].includes(blocks[1].type) || blocks[1].inline) {
        fail('标题前没有新空行：' + JSON.stringify(blocks[1]));
      }
      if (blocks[2].type !== 'h3' || !blocks[2].inline.includes('1.bank')) {
        fail('标题被改坏了：' + JSON.stringify(blocks[2]));
      }
      const newEl = document.querySelector('#preview .blk[data-i="1"]');
      if (!newEl || newEl.classList.contains('blk-leading-empty') || getComputedStyle(newEl).display === 'none') {
        fail('新空行被首行标题的收空逻辑藏起来了');
      }
      if (f.pane._focus !== 1) fail('光标没落到新空行');
      return '前置空标题 + 标题首行回车 → 可见新空行，标题保留';
    } finally {
      note.content = original;
      f.pane.renderBlocks();
      await wait(120);
    }
  });

  await run('粘贴 Markdown：代码块和表格不被拆坏', async () => {
    const note = ws.notesOf()[0];
    f.selectNote(note.id);
    await wait(220);
    const original = note.content;
    try {
      f.pane.appendBlock();
      await wait(250);
      const ed = activeEditor();
      if (!ed) fail('没有进入新块');
      const md = [
        '# 粘贴标题',
        '',
        '第一段',
        '',
        '```cpp',
        'class A {',
        'public:',
        '    int x = 0;',
        '};',
        '```',
        '',
        '| 列1 | 列2 |',
        '|---|---|',
        '| a | b |',
      ].join('\n');
      const dt = new DataTransfer();
      dt.setData('text/plain', md);
      ed.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dt, bubbles: true, cancelable: true,
      }));
      await wait(380);
      const code = f.pane._blocks.find((b) => b.type === 'code' && b.src.includes('class A {'));
      if (!code) fail('粘贴后没有代码块');
      if (/\n\s*\n/.test(code.src)) fail('代码块内部又被插入了空行');
      if (!f.pane._blocks.some((b) => b.type === 'table')) fail('表格没有被识别');
      const out = note.content;
      if (!out.includes('```cpp\nclass A {\npublic:')) fail('代码围栏没有连续保存');
      if (!out.includes('| 列1 | 列2 |\n|---|---|')) fail('表头 / 分隔行仍被空行拆开');
    } finally {
      note.content = original;
      f.pane.renderBlocks();
      await wait(140);
    }
    return 'Markdown 粘贴保留代码围栏、表格';
  });

  await run('粘贴纯代码：保留行首空格，自动建代码块', async () => {
    const note = ws.notesOf()[0];
    f.selectNote(note.id);
    await wait(220);
    const original = note.content;
    try {
      f.pane.appendBlock();
      await wait(250);
      const ed = activeEditor();
      if (!ed) fail('没有进入新块');
      const code = [
        'class Animal {',
        'public:',
        '    int age = 0;',
        '',
        '    virtual void speak() { /* 普通动物叫声 */ }',
        '    virtual void move()  { /* 普通动物移动 */ }',
        '};',
        '',
        'class Dog : public Animal {',
        'public:',
        '    void speak() override { /* 汪汪 */ }',
        '};',
        '',
        'void test(Animal* p) {',
        '    p->speak();',
        '    p->move();',
        '}',
      ].join('\n');
      const dt = new DataTransfer();
      dt.setData('text/plain', code);
      ed.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dt, bubbles: true, cancelable: true,
      }));
      await wait(380);
      const blk = f.pane._blocks.find((b) => b.type === 'code' && b.src.includes('class Animal {'));
      if (!blk) fail('纯代码粘贴没有建成代码块');
      if (blk.src !== code) fail('代码块内容和剪贴板不一致（空格被改动）');
      if (blk.lang !== 'c++') fail('C++ 语言没有识别出来：' + blk.lang);
      if (!note.content.includes('    int age = 0;')) fail('正文里行首空格丢了');
      if (!note.content.includes('int age = 0;\n\n    virtual')) fail('代码里的空行丢了');
    } finally {
      note.content = original;
      f.pane.renderBlocks();
      await wait(140);
    }
    return '纯代码 → code 块，空格 / 空行 / C++ 语言都保留';
  });

  await run('右栏空白处右键也能弹出块菜单', async () => {
    const note = ws.notesOf()[0];
    f.selectNote(note.id);
    await wait(220);
    note.content = '第一段\n\n第二段\n\n第三段';
    f.pane.renderBlocks();
    await wait(160);
    const body = document.getElementById('noteBody');
    const last = document.querySelector('#preview > .blk:last-child');
    const br = body.getBoundingClientRect();
    const lr = last.getBoundingClientRect();
    const x = Math.round(br.left + br.width / 2);
    const y = Math.round(Math.min(br.bottom - 12, lr.bottom + 28));
    body.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
    }));
    await wait(220);
    const menu = document.querySelector('.blk-menu:not(.sub)');
    if (!menu) fail('右栏空白处右键没有菜单');
    f.pane.closeBlockMenu();
    await wait(100);
    return '点最后一块下方空白也能出菜单';
  });

  await run('底部右键菜单和转为子菜单不出界', async () => {
    const note = ws.notesOf()[0];
    f.selectNote(note.id);
    await wait(220);
    f.pane._sel.clear();
    f.pane.repaintSelection();
    f.pane.openBlockContextMenu(0, window.innerWidth - 4, window.innerHeight - 4);
    await wait(220);
    const menu = document.querySelector('.blk-menu:not(.sub)');
    if (!menu) fail('没有弹出右键菜单');
    const mr = menu.getBoundingClientRect();
    if (mr.left < 0 || mr.top < 0
      || mr.right > window.innerWidth + 1 || mr.bottom > window.innerHeight + 1) {
      fail('右键菜单出界：' + JSON.stringify({ l: mr.left, t: mr.top, r: mr.right, b: mr.bottom,
        w: innerWidth, h: innerHeight }));
    }
    const typeBtn = [...menu.querySelectorAll('button')].find((b) => b.dataset.act === 'type');
    if (!typeBtn) fail('菜单里没有「转为」');
    typeBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await wait(180);
    const sub = document.querySelector('.blk-menu.sub');
    if (!sub) fail('没有弹出「转为」子菜单');
    const sr = sub.getBoundingClientRect();
    if (sr.left < 0 || sr.top < 0
      || sr.right > window.innerWidth + 1 || sr.bottom > window.innerHeight + 1) {
      fail('子菜单出界：' + JSON.stringify({ l: sr.left, t: sr.top, r: sr.right, b: sr.bottom,
        w: innerWidth, h: innerHeight }));
    }
    f.pane.closeBlockMenu();
    await wait(140);
    return '菜单 / 子菜单都被夹在视口内';
  });

  await run('代码块行号不可编辑，点行号焦点进代码框', async () => {
    const note = ws.notesOf()[0];
    f.selectNote(note.id);
    await wait(220);
    const original = note.content;
    try {
      note.content = '```js\nconst x = 1;\n```';
      f.pane.renderBlocks();
      await wait(200);
      const gutter = document.querySelector('.blk-code .code-gutter');
      if (!gutter) fail('没有代码块行号');
      if (gutter.getAttribute('contenteditable') !== 'false') fail('行号可以被编辑');
      if (getComputedStyle(gutter).pointerEvents !== 'none') fail('行号还在接收点击');
      const r = gutter.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && gutter.contains(hit)) fail('行号仍然能被点到');
      realClick(hit || gutter);
      await wait(160);
      const sel = window.getSelection();
      if (sel.anchorNode && gutter.contains(sel.anchorNode)) fail('光标落进了行号');
    } finally {
      note.content = original;
      f.pane.renderBlocks();
      await wait(140);
    }
    return '行号 contenteditable=false，点击只进代码框';
  });

  await run('代码块：停手后自动识别语言，手动改过的不覆盖', async () => {
    const note = ws.notesOf()[0];
    const original = note.content;
    f.selectNote(note.id);
    await wait(200);
    try {
      await setCodeContent('```\n\n```');
      f.pane.focusCode(0, 'end');
      await wait(80);
      let ta = codeInputOf();
      ta.value = 'const x = 1;\nconsole.log(x);';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(1100);
      if (f.pane._blocks[0].lang !== 'javascript') {
        fail('没识别成 javascript：' + f.pane._blocks[0].lang);
      }
      if (!ws.note(note.id).content.includes('```javascript')) fail('语言没写回围栏');
      if (codeBlockOf().querySelector('.code-lang').value !== 'javascript') fail('语言框没同步');

      // 手动改成 python 后，再输入 HTML 也不应被自动覆盖
      f.pane.commitLang(0, 'python', false);
      await wait(120);
      ta = codeInputOf();
      ta.value = '<!DOCTYPE html>\n<html><body>hi</body></html>';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(1100);
      if (f.pane._blocks[0].lang !== 'python') {
        fail('手动语言被自动覆盖了：' + f.pane._blocks[0].lang);
      }
      return '自动识别 javascript，手动 python 保持';
    } finally {
      await restoreNoteContent(note, original);
    }
  });

  return out;
})();
