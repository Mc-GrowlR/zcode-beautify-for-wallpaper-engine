/**
 * The Bubble Studio page (气泡工坊) served at ui://zcode-beautify/bubble-studio.html.
 *
 * Rendered by ZCode's MCP-Apps sandbox (plugin.json ui.surfaces + tool-result
 * _meta.ui). Talks to the plugin MCP server through the host-injected
 * window.zcode alias bridge (callTool), so the page has zero dependencies and
 * ships as one resource read. No host DOM access: previews re-create the real
 * bubble rules (core/bubbleRecipes.ts + the --zb-bubble-* var contract from
 * cdp.ts applyBubbleLook) against the literal .zb-bubble class names, and
 * "应用到聊天" round-trips through apply_options so the LIVE chat restyles.
 *
 * Template hygiene: the HTML below deliberately contains NO backtick, no
 * dollar-brace sequence and no backslash (page JS uses string concatenation
 * and split/join instead of regex) so the template literal below survives
 * every bundling/unbundling pass verbatim — see the panel-template pitfalls.
 */

import { bubbleRecipes, BUBBLE_SELECTOR_PREVIEW } from "../core/bubbleRecipes.js";

export function bubbleStudioHtml(): string {
  // Builtin recipe CSS against the literal preview class names — identical to
  // what lands in ZCode (cdp.ts bakes the same strings against real selectors).
  const recipesJson = JSON.stringify(bubbleRecipes(BUBBLE_SELECTOR_PREVIEW));
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>气泡工坊 · zcode-beautify</title>
<style>
:root { --color-primary:#2563eb; --color-surface:#ffffff; --color-text:#18181b;
  --color-border:#e4e4e7; --color-muted:#71717a; --page:#f4f4f5; --card:#fafafa; }
:root[data-theme="dark"] { --color-primary:#60a5fa; --color-surface:#27272a; --color-text:#fafafa;
  --color-border:#3f3f46; --color-muted:#a1a1aa; --page:#18181b; --card:#1f1f23; }
* { box-sizing: border-box; }
body { margin:0; padding:14px; font:13px/1.6 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
  color:var(--color-text); background:var(--page); }
header { display:flex; align-items:center; gap:10px; margin-bottom:12px; flex-wrap:wrap; }
h1 { font-size:15px; margin:0; font-weight:600; }
#zb-active { color:var(--color-muted); font-size:12px; }
#zb-reset { margin-left:auto; }
button { font:inherit; font-size:12px; padding:4px 12px; border-radius:8px; cursor:pointer;
  border:1px solid var(--color-border); background:var(--card); color:var(--color-text); }
button:hover { border-color:var(--color-primary); }
button[disabled] { opacity:.5; cursor:default; }
button.primary { background:var(--color-primary); border-color:var(--color-primary); color:#fff; }
#zb-notice { position:fixed; left:50%; transform:translateX(-50%); bottom:14px; z-index:9;
  background:var(--color-surface); border:1px solid var(--color-border); border-radius:10px;
  padding:6px 14px; font-size:12px; box-shadow:0 6px 24px rgb(0 0 0 / .18); }
#zb-notice[hidden] { display:none; }
#zb-editor { background:var(--card); border:1px solid var(--color-border); border-radius:12px;
  padding:12px; margin-bottom:12px; }
#zb-editor .row { display:flex; align-items:center; gap:10px; margin:6px 0; flex-wrap:wrap; }
#zb-editor label { font-size:12px; color:var(--color-muted); min-width:52px; }
#zb-editor input[type="text"] { font:inherit; padding:4px 8px; border-radius:8px;
  border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); width:180px; }
#zb-editor input[type="range"] { width:150px; }
#zb-editor output { font-size:12px; min-width:34px; color:var(--color-muted); }
#zb-editor select { font:inherit; font-size:12px; padding:3px 6px; border-radius:8px;
  border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); }
#zb-css-wrap { margin-top:8px; }
#zb-css-wrap[hidden] { display:none; }
#zb-css { width:100%; min-height:110px; resize:vertical; font:12px/1.5 Consolas, monospace;
  padding:8px; border-radius:8px; border:1px solid var(--color-border);
  background:var(--color-surface); color:var(--color-text); }
#zb-css-hint { font-size:11px; color:var(--color-muted); margin-top:4px; }
#zb-gallery { display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:10px; }
.zb-card { background:var(--card); border:1px solid var(--color-border); border-radius:12px;
  padding:10px; cursor:pointer; position:relative; }
.zb-card:hover { border-color:var(--color-primary); }
.zb-card.zb-selected { border-color:var(--color-primary); box-shadow:0 0 0 1px var(--color-primary); }
.zb-badge { position:absolute; top:8px; right:8px; font-size:10px; color:var(--color-primary);
  border:1px solid var(--color-primary); border-radius:6px; padding:0 6px; }
.zb-demo { margin:6px 0 8px; }
.zb-ai { color:var(--color-muted); font-size:12px; margin:0 0 6px 2px; }
/* Base bubble: mirrors the visual ZCode ships (recipes override bg/border
   with !important, geometry always comes from the --zb-bubble-* vars). */
.zb-bubble { display:inline-block; padding:7px 12px; font-size:13px; line-height:1.6;
  background:var(--color-surface); color:var(--color-text);
  border:1px solid var(--color-border); word-break:break-word;
  border-radius:var(--zb-bubble-radius, 12px); max-width:var(--zb-bubble-maxw, 70%); }
.zb-bubble-row { display:flex; align-items:var(--zb-bubble-align, flex-end); }
.zb-name { font-size:12px; font-weight:500; }
.zb-hint { font-size:11px; color:var(--color-muted); margin-top:2px; }
footer { margin-top:12px; font-size:11px; color:var(--color-muted); }
</style>
</head>
<body>
<header>
  <h1>气泡工坊</h1>
  <span id="zb-active">读取中…</span>
  <button id="zb-reset" type="button" disabled>恢复默认</button>
</header>

<section id="zb-editor">
  <div class="row">
    <label for="zb-name">名称</label>
    <input id="zb-name" type="text" maxlength="40" placeholder="保存为新配方的名称" disabled>
  </div>
  <div class="row">
    <label for="zb-tint">着色</label>
    <input id="zb-tint" type="range" min="0" max="100" step="1" disabled>
    <output id="zb-tint-v">28</output>
    <label for="zb-radius">圆角</label>
    <input id="zb-radius" type="range" min="4" max="24" step="1" disabled>
    <output id="zb-radius-v">12</output>
    <label for="zb-width">宽度</label>
    <input id="zb-width" type="range" min="40" max="90" step="1" disabled>
    <output id="zb-width-v">70</output>
  </div>
  <div class="row">
    <label for="zb-align">对齐</label>
    <select id="zb-align" disabled>
      <option value="right">靠右（ZCode 原生）</option>
      <option value="left">靠左</option>
    </select>
    <button id="zb-delete" type="button" hidden>删除此配方</button>
  </div>
  <div id="zb-css-wrap" hidden>
    <textarea id="zb-css" spellcheck="false" placeholder=".zb-bubble { … }"></textarea>
    <div id="zb-css-hint">选择器约定 .zb-bubble = 用户消息气泡，.zb-bubble-row = 所在行；建议用 var(--color-primary) 等主题变量并加 !important。</div>
  </div>
  <div class="row">
    <button id="zb-apply" type="button" class="primary" disabled>应用到聊天</button>
    <button id="zb-save" type="button" disabled>保存为配方</button>
    <span id="zb-count" style="font-size:12px;color:var(--color-muted)"></span>
  </div>
</section>

<section id="zb-gallery" aria-live="polite"></section>
<footer>预览为近似配色，实际效果以应用后的聊天界面为准；点卡片选中，右侧调整后「应用到聊天」即时生效。</footer>
<div id="zb-notice" hidden></div>

<script>
(function () {
  'use strict';
  // Builtin recipes, baked server-side from core/bubbleRecipes.ts against the
  // literal preview selectors — the same CSS cdp.ts injects against ZCode's
  // real selectors, so previews match what lands in the live chat.
  var RECIPES = ${recipesJson};
  var DEMO_TEXT = '帮我把气泡换成这个样式';
  var DEMO_AI = '已加载气泡工坊，点卡片试穿 ✦';
  var ZC = null;
  var state = null;   // { active, activeRecipeId, builtins, saved }
  var sel = 'default';
  var draft = null;   // edited copy of the selected recipe's look
  var busy = false;
  var el = function (id) { return document.getElementById(id); };
  var gallery = el('zb-gallery');
  var styleEl = document.createElement('style');
  styleEl.id = 'zb-dynamic';
  document.head.appendChild(styleEl);

  function toast(msg) {
    var n = el('zb-notice');
    n.textContent = msg;
    n.hidden = false;
    window.setTimeout(function () { n.hidden = true; }, 1800);
  }
  function note(msg) { toast(msg); }
  function reportHeight() {
    try { if (ZC && ZC.notifyIntrinsicHeight) ZC.notifyIntrinsicHeight(document.body.scrollHeight); } catch (e) {}
  }
  function setEnabled(on) {
    var ids = ['zb-name', 'zb-tint', 'zb-radius', 'zb-width', 'zb-align', 'zb-apply', 'zb-save', 'zb-reset'];
    for (var i = 0; i < ids.length; i++) el(ids[i]).disabled = !on;
    el('zb-css').disabled = !on;
  }
  function allRecipes() {
    if (!state) return [];
    return state.builtins.concat(state.saved);
  }
  function findRecipe(id) {
    var list = allRecipes();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  // Scope recipe/user CSS to one card wrapper. The row marker runs FIRST and
  // through a placeholder so the plain '.zb-bubble' pass cannot eat half of a
  // '.zb-bubble-row' (same ordering trick as core rewriteCustomBubbleCss).
  function scopeCss(css, wrap) {
    var ROW = '.zb-bubble-row', BUB = '.zb-bubble', MARK = '@@ZBROW@@';
    return String(css)
      .split(ROW).join(MARK)
      .split(BUB).join(wrap + ' .zb-bubble')
      .split(MARK).join(wrap + ' .zb-bubble-row');
  }
  function recipeCss(look) {
    if (!look) return '';
    if (look.preset === 'custom') return look.customCss || '';
    if (look.preset === 'default') return '';
    return RECIPES[look.preset] || '';
  }
  // Mirrors cdp.ts applyBubbleLook: 2px tail corner on the aligned edge.
  function varsFor(look) {
    var r = Math.max(2, Math.round(look.radius || 12));
    var corners = look.align === 'left' ? ('2px ' + r + 'px ' + r + 'px ' + r + 'px') : (r + 'px 2px ' + r + 'px ' + r + 'px');
    return '--zb-bubble-tint:' + (Math.max(0, Math.min(100, look.tint || 0)) / 100)
      + ';--zb-bubble-radius:' + corners
      + ';--zb-bubble-maxw:' + Math.max(40, Math.min(90, look.width || 70)) + '%'
      + ';--zb-bubble-align:' + (look.align === 'left' ? 'flex-start' : 'flex-end');
  }
  function cardNode(recipe, index) {
    var card = document.createElement('div');
    card.className = 'zb-card' + (recipe.id === sel ? ' zb-selected' : '');
    card.setAttribute('data-id', recipe.id);
    var demo = document.createElement('div');
    demo.className = 'zb-demo zb-c' + index;
    demo.setAttribute('style', varsFor(recipe.look));
    var ai = document.createElement('p');
    ai.className = 'zb-ai';
    ai.textContent = DEMO_AI;
    var row = document.createElement('div');
    row.className = 'zb-bubble-row';
    var bub = document.createElement('div');
    bub.className = 'zb-bubble';
    bub.textContent = DEMO_TEXT;
    row.appendChild(bub);
    demo.appendChild(ai);
    demo.appendChild(row);
    card.appendChild(demo);
    var name = document.createElement('div');
    name.className = 'zb-name';
    name.textContent = recipe.name;
    card.appendChild(name);
    if (state && recipe.id === state.activeRecipeId) {
      var badge = document.createElement('span');
      badge.className = 'zb-badge';
      badge.textContent = '当前';
      card.appendChild(badge);
    }
    if (recipe.look.preset === 'default') {
      var hint = document.createElement('div');
      hint.className = 'zb-hint';
      hint.textContent = '原生样式，不响应圆角/着色调整';
      card.appendChild(hint);
    }
    if (recipe.look.preset === 'custom' && !(recipe.look.customCss || '').trim()) {
      var ch = document.createElement('div');
      ch.className = 'zb-hint';
      ch.textContent = '自定义 CSS 为空，仅应用几何参数';
      card.appendChild(ch);
    }
    card.addEventListener('click', function () { select(recipe.id); });
    return card;
  }
  function render() {
    if (!state) return;
    var list = allRecipes();
    var cssText = '';
    gallery.textContent = '';
    for (var i = 0; i < list.length; i++) {
      var wrap = '.zb-c' + i;
      var scoped = scopeCss(recipeCss(list[i].look), wrap);
      if (scoped) cssText += scoped + String.fromCharCode(10);
      gallery.appendChild(cardNode(list[i], i));
    }
    styleEl.textContent = cssText;
    var cur = findRecipe(state.activeRecipeId);
    el('zb-active').textContent = '当前聊天: ' + (cur ? cur.name : (state.active.preset === 'default' ? 'ZCode 原版' : state.active.preset));
    el('zb-count').textContent = state.saved.length ? ('已保存 ' + state.saved.length + ' 个配方') : '';
    reportHeight();
  }
  function syncEditor() {
    if (!draft) return;
    el('zb-name').value = findRecipe(sel) ? findRecipe(sel).name : '';
    el('zb-tint').value = draft.tint; el('zb-tint-v').value = draft.tint;
    el('zb-radius').value = draft.radius; el('zb-radius-v').value = draft.radius;
    el('zb-width').value = draft.width; el('zb-width-v').value = draft.width;
    el('zb-align').value = draft.align;
    var stock = draft.preset === 'default';
    el('zb-tint').disabled = stock; el('zb-radius').disabled = stock; el('zb-width').disabled = stock;
    el('zb-css-wrap').hidden = draft.preset !== 'custom';
    el('zb-css').value = draft.customCss || '';
    el('zb-delete').hidden = !findRecipe(sel) || !!findRecipe(sel).builtin;
  }
  function select(id, keepDraft) {
    var r = findRecipe(id);
    if (!r) return;
    sel = id;
    draft = { preset: r.look.preset, tint: r.look.tint, radius: r.look.radius, width: r.look.width, align: r.look.align, customCss: r.look.customCss || '' };
    if (!keepDraft) syncEditor();
    try { if (ZC && ZC.setWidgetState) ZC.setWidgetState({ modelContent: null, privateContent: { sel: sel } }).catch(function () {}); } catch (e) {}
    render();
  }
  function patchDraft() {
    if (!draft) return;
    draft.tint = Number(el('zb-tint').value);
    draft.radius = Number(el('zb-radius').value);
    draft.width = Number(el('zb-width').value);
    draft.align = el('zb-align').value;
    draft.customCss = el('zb-css').value.slice(0, 8000);
    el('zb-tint-v').value = draft.tint; el('zb-radius-v').value = draft.radius; el('zb-width-v').value = draft.width;
    var r = findRecipe(sel);
    if (r) { r.look = { preset: draft.preset, tint: draft.tint, radius: draft.radius, width: draft.width, align: draft.align, customCss: draft.customCss }; }
    render();
  }
  function call(name, args) {
    return ZC.callTool(name, args || {}).then(function (res) {
      var text = '';
      try {
        var c = res && res.content;
        if (c && c.length && typeof c[0].text === 'string') text = c[0].text;
      } catch (e) {}
      if (res && res.isError) throw new Error(text || (name + ' 失败'));
      var parsed = null;
      try { parsed = JSON.parse(text); } catch (e) {}
      return parsed !== null && typeof parsed === 'object' ? parsed : { raw: text };
    });
  }
  function applyLook(look, doneMsg) {
    if (busy || !ZC) return;
    busy = true;
    call('apply_options', { bubble: look }).then(function () {
      state.active = { preset: look.preset, tint: look.tint, radius: look.radius, width: look.width, align: look.align, customCss: look.customCss };
      var match = allRecipes().filter(function (r) {
        return r.look.preset === state.active.preset && r.look.tint === state.active.tint && r.look.radius === state.active.radius
          && r.look.width === state.active.width && r.look.align === state.active.align && (r.look.customCss || '') === (state.active.customCss || '');
      });
      state.activeRecipeId = match.length ? match[0].id : null;
      render();
      toast(doneMsg || '已应用到聊天界面');
    }).catch(function (err) { note('应用失败: ' + (err && err.message ? err.message : err)); })
      .then(function () { busy = false; });
  }
  el('zb-apply').addEventListener('click', function () { if (draft) applyLook(draft); });
  el('zb-reset').addEventListener('click', function () { applyLook({ preset: 'default', tint: 28, radius: 12, width: 70, align: 'right', customCss: '' }, '已恢复 ZCode 原版气泡'); });
  el('zb-save').addEventListener('click', function () {
    if (busy || !ZC || !draft) return;
    busy = true;
    var payload = { name: el('zb-name').value || (findRecipe(sel) ? findRecipe(sel).name : ''), look: draft };
    if (findRecipe(sel) && !findRecipe(sel).builtin) payload.id = sel;
    call('save_bubble_recipe', payload).then(function (out) {
      var saved = out.recipe || out;
      if (saved && saved.id) {
        var list = state.saved.filter(function (r) { return r.id !== saved.id; });
        list.push(saved);
        state.saved = list;
        toast('已保存配方: ' + (saved.name || ''));
        select(saved.id);
      } else {
        toast('已保存');
      }
    }).catch(function (err) { note('保存失败: ' + (err && err.message ? err.message : err)); })
      .then(function () { busy = false; });
  });
  el('zb-delete').addEventListener('click', function () {
    if (busy || !ZC) return;
    var r = findRecipe(sel);
    if (!r || r.builtin) return;
    busy = true;
    call('delete_bubble_recipe', { id: r.id }).then(function () {
      state.saved = state.saved.filter(function (x) { return x.id !== r.id; });
      toast('已删除: ' + r.name);
      select('default');
    }).catch(function (err) { note('删除失败: ' + (err && err.message ? err.message : err)); })
      .then(function () { busy = false; });
  });
  ['zb-tint', 'zb-radius', 'zb-width', 'zb-align', 'zb-css'].forEach(function (id) {
    el(id).addEventListener('input', patchDraft);
  });

  function applyTheme() {
    var t = null;
    try { t = (ZC && ZC.hostContext && ZC.hostContext.theme) || (ZC && ZC.theme); } catch (e) {}
    if (t) document.documentElement.setAttribute('data-theme', String(t).indexOf('dark') >= 0 ? 'dark' : 'light');
  }
  function bootWithBridge() {
    applyTheme();
    try { if (ZC.onhostcontextchanged) ZC.onhostcontextchanged = applyTheme; } catch (e) {}
    call('bubble_studio_state', {}).then(function (s) {
      state = s;
      var want = null;
      try { want = ZC.widgetState && ZC.widgetState.sel; } catch (e) {}
      select(want && findRecipe(want) ? want : (state.activeRecipeId && findRecipe(state.activeRecipeId) ? state.activeRecipeId : 'default'));
      setEnabled(true);
      render();
    }).catch(function (err) {
      el('zb-active').textContent = '状态读取失败';
      note('读取失败: ' + (err && err.message ? err.message : err));
    });
  }
  function boot() {
    ZC = window.zcode || null;
    if (ZC && typeof ZC.callTool === 'function' && typeof ZC.ready === 'function') {
      ZC.ready().then(bootWithBridge, bootWithBridge);
      return;
    }
    if (ZC && typeof ZC.callTool === 'function') { bootWithBridge(); return; }
    // Standalone open (plain browser): local preview with the builtin seed.
    window.setTimeout(function () {
      if (state) return;
      state = { active: { preset: 'default', tint: 28, radius: 12, width: 70, align: 'right' }, activeRecipeId: 'default',
        builtins: [], saved: [] };
      state.builtins = [
        { id: 'default', name: 'ZCode 原版', builtin: true, look: state.active },
        { id: 'accent', name: '主题强调色', builtin: true, look: { preset: 'accent', tint: 45, radius: 12, width: 70, align: 'right' } },
        { id: 'glass', name: '玻璃拟态', builtin: true, look: { preset: 'glass', tint: 28, radius: 16, width: 70, align: 'right' } },
        { id: 'outline', name: '描边', builtin: true, look: { preset: 'outline', tint: 40, radius: 12, width: 70, align: 'right' } },
        { id: 'flat', name: '扁平', builtin: true, look: { preset: 'flat', tint: 28, radius: 10, width: 70, align: 'right' } }
      ];
      select('default');
      el('zb-active').textContent = '未连接 ZCode 宿主 — 仅本地预览';
      note('请在 ZCode 会话中打开气泡工坊以启用应用/保存');
    }, 1200);
  }
  boot();
})();
</script>
</body>
</html>`;
}
