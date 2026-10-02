/**
 * The injected settings panel: a floating, draggable panel in the ZCode
 * renderer for live-tuning blur/dim, toggling Monet colors and wallpaper
 * visibility, and swapping the wallpaper image — all via the local API
 * started by `zcode-beautify serve`.
 *
 * The script always rebuilds the panel, so a stale copy left in the DOM can
 * never shadow a newer script version, and it is safe to re-evaluate on every
 * injection or reload.
 */

export const PANEL_ROOT_ID = "zcode-beautify-panel-root";

export function buildPanelScript(apiPort: number): string {
  const api = `http://127.0.0.1:${apiPort}`;
  return `(function(){
  var API = ${JSON.stringify(api)};
  var ROOT_ID = ${JSON.stringify(PANEL_ROOT_ID)};
  // Always rebuild: an older panel left in the DOM would otherwise shadow the
  // current script version forever (the old build skipped installation).
  var stale = document.getElementById(ROOT_ID);
  if (stale) stale.remove();
  var staleStyle = document.getElementById('zcode-beautify-panel-style');
  if (staleStyle) staleStyle.remove();

  var css = [
    '#zcode-beautify-panel-root, #zcode-beautify-panel-root * { box-sizing: border-box; font-family: system-ui, sans-serif; }',
    '#zcode-beautify-panel-root { position: fixed; inset: auto; z-index: 2147483647; font-size: 12px; color: #e8e8ea; }',
    '#zb-fab { position: fixed; right: 18px; bottom: 18px; width: 34px; height: 34px; border-radius: 50%;',
      ' background: rgba(32,32,38,.78); border: 1px solid rgba(255,255,255,.12); cursor: pointer;',
      ' display: flex; align-items: center; justify-content: center; backdrop-filter: blur(10px);',
      ' box-shadow: 0 2px 12px rgba(0,0,0,.35); user-select: none; font-size: 15px; line-height: 1; }',
    '#zb-fab:hover { background: rgba(52,52,60,.85); }',
    '#zb-panel { position: fixed; right: 18px; bottom: 60px; width: 264px; padding: 0 0 10px;',
      ' background: rgba(24,24,30,.88); border: 1px solid rgba(255,255,255,.12); border-radius: 12px;',
      ' backdrop-filter: blur(16px); box-shadow: 0 8px 32px rgba(0,0,0,.45); user-select: none; }',
    '#zb-panel[hidden] { display: none; }',
    '#zb-head { padding: 9px 12px; font-weight: 600; cursor: move; border-bottom: 1px solid rgba(255,255,255,.1);',
      ' display: flex; justify-content: space-between; align-items: center; }',
    '#zb-body { padding: 10px 12px 0; }',
    '#zb-tabs { display: flex; gap: 6px; margin-bottom: 10px; }',
    '.zb-tab { flex: 1; text-align: center; padding: 5px 0; border-radius: 8px; cursor: pointer;',
      ' background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); color: inherit; font-size: 11px; }',
    '.zb-tab:hover { background: rgba(255,255,255,.12); }',
    '.zb-tab[data-active="1"] { background: rgba(122,162,247,.3); border-color: rgba(122,162,247,.6); }',
    '.zb-row { margin-bottom: 10px; }',
    '.zb-row label { display: flex; justify-content: space-between; margin-bottom: 4px; opacity: .85; }',
    '#zb-panel input[type=range] { width: 100%; accent-color: #7aa2f7; height: 18px; margin: 0; cursor: pointer; }',
    '.zb-toggles { display: flex; justify-content: center; gap: 16px; }',
    '.zb-toggles label { display: flex; align-items: center; gap: 5px; margin: 0; cursor: pointer; }',
    '.zb-actions { display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; }',
    '.zb-btn { display: inline-block; padding: 6px 10px; text-align: center; border-radius: 999px; cursor: pointer;',
      ' background: rgba(255,255,255,.09); border: 1px solid rgba(255,255,255,.14); color: inherit; font-size: 12px;',
      ' white-space: nowrap; flex: 0 1 auto; }',
    '.zb-btn:hover { background: rgba(255,255,255,.16); }',
    '#zb-status { min-height: 14px; padding: 2px 12px 0; opacity: .6; font-size: 11px; }',
    '#zb-scene-path { width: 100%; padding: 5px 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14);',
      ' background: rgba(0,0,0,.3); color: inherit; font-size: 11px; outline: none; }',
    '#zb-scene-path:focus { border-color: rgba(122,162,247,.6); }',
    '#zb-progress { position: relative; height: 14px; border-radius: 7px; overflow: hidden;',
      ' background: rgba(255,255,255,.08); font-size: 10px; line-height: 14px; text-align: center; }',
    '#zb-progress-bar { position: absolute; inset: 0; width: 0%; background: rgba(122,162,247,.5); transition: width .4s; }',
    '#zb-progress span { position: relative; }',
    '#zb-guide { padding: 8px 10px; background: rgba(120,53,15,.55); border-radius: 8px; font-size: 11px;',
      ' line-height: 1.5; white-space: pre-wrap; user-select: text; max-height: 180px; overflow: auto; }',
    '.zb-lib { max-height: 120px; overflow: auto; font-size: 11px; }',
    '.zb-lib .zb-lib-head { opacity: .55; margin: 4px 0 2px; }',
    '.zb-sched-head { display: flex; justify-content: space-between; align-items: center; opacity: .85; margin-bottom: 4px; }',
    '.zb-sched-head label { display: flex; align-items: center; gap: 5px; margin: 0; cursor: pointer; }',
    '.zb-sched-plan { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }',
    '.zb-sched-plan select { flex: 1; min-width: 0; padding: 3px 5px; border-radius: 6px;',
      ' border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.3); color: inherit; font-size: 11px;',
      ' outline: none; color-scheme: dark; }',
    '.zb-sched-plan .zb-act { font-size: 12px; }',
    '.zb-sched-mode { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; opacity: .85; font-size: 11px; }',
    '.zb-sched-mode select { flex: 1; min-width: 0; padding: 3px 5px; border-radius: 6px;',
      ' border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.3); color: inherit; font-size: 11px;',
      ' outline: none; color-scheme: dark; }',
    '#zb-sched-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px; }',
    '.zb-sched-row { display: flex; align-items: center; gap: 4px; }',
    '.zb-sched-row input[type=number], .zb-sched-row input[type=time], .zb-sched-row select { padding: 3px 5px; border-radius: 6px;',
      ' border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.3); color: inherit; font-size: 11px;',
      ' outline: none; color-scheme: dark; }',
    '.zb-sched-row input[type=number] { width: 52px; flex: none; }',
    '.zb-sched-row input[type=time] { width: 66px; flex: none; }',
    '.zb-sched-row select { flex: 1; min-width: 0; }',
    '.zb-sched-dur { flex: none; opacity: .7; font-size: 11px; }',
    '.zb-wp-picker { position: relative; flex: 1; min-width: 0; }',
    '.zb-wp-btn { display: flex; align-items: center; gap: 5px; width: 100%; padding: 2px 5px; border-radius: 6px;',
      ' border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.3); color: inherit; font-size: 11px; cursor: pointer; }',
    '.zb-wp-btn img { width: 42px; height: 24px; object-fit: cover; border-radius: 3px; flex: none; background: #000; }',
    '.zb-wp-btn span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }',
    '.zb-wp-pop { position: absolute; left: 0; right: 0; bottom: calc(100% + 4px); z-index: 30; max-height: 160px;',
      ' overflow: auto; background: rgba(16,16,22,.98); border: 1px solid rgba(255,255,255,.16); border-radius: 8px; padding: 3px; }',
    '.zb-wp-item { display: flex; align-items: center; gap: 6px; padding: 3px 5px; border-radius: 6px; cursor: pointer; font-size: 11px; }',
    '.zb-wp-item:hover { background: rgba(255,255,255,.12); }',
    '.zb-wp-item[data-cur="1"] { background: rgba(122,162,247,.28); }',
    '.zb-wp-item img { width: 46px; height: 26px; object-fit: cover; border-radius: 3px; flex: none; background: #000; }',
    '.zb-wp-item span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.zb-item { display: flex; align-items: center; gap: 4px; padding: 3px 6px; border-radius: 6px; }',
    '.zb-item:hover { background: rgba(255,255,255,.1); }',
    '.zb-item[data-current="1"] { background: rgba(122,162,247,.25); }',
    '.zb-item .zb-label { flex: 1; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.zb-item .zb-label-input { flex: 1; min-width: 0; padding: 1px 4px; border-radius: 4px; border: 1px solid rgba(122,162,247,.6);',
      ' background: rgba(0,0,0,.35); color: inherit; font-size: 11px; outline: none; }',
    '.zb-item .zb-act { cursor: pointer; opacity: .5; padding: 0 3px; font-size: 11px; background: none; border: none; color: inherit; }',
    '.zb-item .zb-act:hover { opacity: 1; }',
    '.zb-item .zb-act[data-armed="1"] { opacity: 1; color: #f87171; }',
    '#zb-offline { display: flex; flex-direction: column; gap: 6px; align-items: center;',
      ' padding: 10px 12px; background: rgba(120,53,15,.55); font-size: 11px; line-height: 1.5; text-align: center; }',
    '#zb-offline[hidden] { display: none; }',
    '#zb-offline code { background: rgba(0,0,0,.35); padding: 1px 4px; border-radius: 4px;',
      ' font-size: 10px; user-select: text; }',
    '#zb-offline .zb-hint { opacity: .85; }',
    // While offline the controls hold nothing we could read, so they must not
    // look interactive — a slider parked mid-track next to a "0px" label reads
    // as a real (wrong) setting.
    '#zcode-beautify-panel-root[data-offline="1"] #zb-body { opacity: .45; pointer-events: none; }',
    '#zcode-beautify-panel-root[data-offline="1"] #zb-status { display: none; }',
    '#zcode-beautify-panel-root[data-offline="1"] #zb-fab { border-color: rgba(248,113,113,.7); }'
  ].join('');

  var style = document.createElement('style');
  style.id = 'zcode-beautify-panel-style';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  var root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML =
    '<div id="zb-fab" title="ZCode Beautify">🎨</div>' +
    '<div id="zb-panel" hidden>' +
    '  <div id="zb-head"><span>ZCode Beautify</span></div>' +
    '  <div id="zb-offline" hidden>' +
    '    <div>⚠ 美化服务未运行,面板不可用</div>' +
    '    <div class="zb-hint">在插件目录执行 <code>node dist/cli.js serve --detach</code> 启动</div>' +
    '    <button class="zb-btn" id="zb-retry">重试连接</button>' +
    '  </div>' +
    '  <div id="zb-body">' +
    '    <div id="zb-tabs">' +
    '      <button class="zb-tab" data-tab="main">壁纸</button>' +
    '      <button class="zb-tab" data-tab="sched">定时播放</button>' +
    '    </div>' +
    '    <div id="zb-tab-main">' +
    '    <div class="zb-row"><label title="背景模糊程度(像素)"><span>背景模糊</span><span><span id="zb-blur-val">0</span>px</span></label>' +
    '      <input type="range" id="zb-blur" min="0" max="30" step="1" value="0"></div>' +
    '    <div class="zb-row"><label title="背景压暗程度(百分比,越高越暗)"><span>背景压暗</span><span><span id="zb-dim-val">0</span>%</span></label>' +
    '      <input type="range" id="zb-dim" min="0" max="80" step="1" value="0"></div>' +
    '    <div class="zb-row zb-toggles">' +
    '      <label title="根据壁纸自动生成 UI 配色;关闭则保留 ZCode 原生颜色"><input type="checkbox" id="zb-monet">UI 莫奈取色</label>' +
    '      <label title="显示或隐藏背景壁纸"><input type="checkbox" id="zb-vis">显示壁纸</label>' +
    '    </div>' +
    '    <div class="zb-row zb-actions">' +
    '      <button class="zb-btn" id="zb-fit" title="背景填充方式:填满裁剪铺满窗口 / 完整显示不裁剪(模糊垫底)/ 智能适配自动分析画面主体">背景填充: …</button>' +
    '    </div>' +
    '    <div class="zb-row zb-actions">' +
    '      <label class="zb-btn" for="zb-file" title="选择一张图片作为背景壁纸,UI 配色随之更新">更换图片…</label>' +
    '      <input type="file" id="zb-file" accept="image/*" hidden>' +
    '    </div>' +
    '    <div class="zb-row"><label style="opacity:.85"><span>动态壁纸 (场景 / 视频)</span></label>' +
    '      <div class="zb-actions" style="margin:2px 0 6px">' +
    '        <button class="zb-btn" id="zb-pick" title="打开文件选择器:选 .pkg(场景)或 .mp4(视频),或壁纸目录内任意文件(会自动定位),选完自动开始导入">选择并导入…</button>' +
    '      </div>' +
    '      <input type="text" id="zb-scene-path" placeholder="或粘贴 .pkg / .mp4 / 壁纸目录完整路径…" spellcheck="false">' +
    '      <div class="zb-actions" style="margin-top:6px">' +
    '        <button class="zb-btn" id="zb-import" title="渲染并录制场景壁纸,生成无缝循环动态背景">导入粘贴的路径</button>' +
    '      </div>' +
    '      <div id="zb-progress" hidden><div id="zb-progress-bar"></div><span>…</span></div>' +
    '      <div id="zb-guide" hidden></div>' +
    '      <div class="zb-actions" style="margin-top:6px"><button class="zb-btn" id="zb-guide-retry" hidden>已安装,重试</button></div>' +
    '    </div>' +
    '    <div class="zb-row zb-lib" id="zb-lib"></div>' +
    '    <div class="zb-row zb-actions">' +
    '      <button class="zb-btn" id="zb-reset" title="移除壁纸与配色,还原 ZCode 默认外观(壁纸会被记住,可再次恢复)">还原默认外观</button>' +
    '    </div>' +
    '    </div>' +
    '    <div id="zb-tab-sched" hidden>' +
    '    <div class="zb-row"><div class="zb-sched-head"><span>定时播放</span>' +
    '      <label title="启用后按所选模式自动切换壁纸"><input type="checkbox" id="zb-sched-on">启用</label></div>' +
    '      <div class="zb-sched-plan"><select id="zb-plan" title="播放方案"></select>' +
    '        <button class="zb-act" id="zb-plan-add" title="新建播放方案">➕</button>' +
    '        <button class="zb-act" id="zb-plan-ren" title="重命名当前方案">✎</button>' +
    '        <button class="zb-act" id="zb-plan-del" title="删除当前方案">🗑</button>' +
    '      </div>' +
    '      <div class="zb-sched-mode"><span>模式</span><select id="zb-sched-mode">' +
    '        <option value="sequence">顺序轮播</option>' +
    '        <option value="random">随机轮播</option>' +
    '        <option value="schedule">定时切换</option>' +
    '      </select></div>' +
    '      <div class="zb-sched-mode"><span>特效</span><select id="zb-fx" title="本方案播放时的壁纸切换特效">' +
    '        <option value="fade">交叉淡入</option>' +
    '        <option value="slide">右侧滑入</option>' +
    '        <option value="zoom">缩放浮现</option>' +
    '        <option value="blur">模糊渐清</option>' +
    '        <option value="none">直接切换</option>' +
    '      </select></div>' +
    '      <div id="zb-sched-list"></div>' +
    '      <div class="zb-actions">' +
    '        <button class="zb-btn" id="zb-sched-add" title="添加一条:选择壁纸并设定时长或时间点">➕ 添加</button>' +
    '        <button class="zb-btn" id="zb-sched-save" title="保存全部方案(不改变启用状态)">💾 保存</button>' +
    '        <button class="zb-btn" id="zb-sched-play" title="保存并立即启用当前方案开始播放">▶ 播放</button>' +
    '        <button class="zb-btn" id="zb-sched-next" title="跳过当前时长,立即切换到下一张壁纸">⏭ 立即切换</button>' +
    '      </div>' +
    '      <div class="zb-lib-head" id="zb-sched-hint" style="margin:4px 0 0"></div>' +
    '    </div>' +
    '    </div>' +
    '  </div>' +
    '</div>' +
    '<div id="zb-status"></div>';
  document.body.appendChild(root);

  function $(id) { return document.getElementById(id); }
  function wallpaperEl() { return document.getElementById('zcode-beautify-wallpaper'); }
  function status(msg) {
    var el = $('zb-status'); if (!el) return;
    el.textContent = msg;
    setTimeout(function () { if (el.textContent === msg) el.textContent = ''; }, 2200);
  }
  function post(path, body, cb) {
    fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (cb) cb(d); })
      .catch(function () { status('无法连接美化服务 service unreachable'); });
  }

  // Local live preview; the server re-injects the authoritative CSS right after.
  function preview() {
    var w = wallpaperEl(); if (!w) return;
    var b = Number($('zb-blur').value), d = Number($('zb-dim').value);
    w.style.filter = b > 0 ? 'blur(' + b + 'px)' : 'none';
    w.style.transform = b > 0 ? 'scale(1.04)' : 'none';
    document.documentElement.style.setProperty('--zcode-beautify-dim', String(d / 100));
  }

  var pushTimer = null;
  function pushConfig() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      post('/api/config', {
        blur: Number($('zb-blur').value),
        dim: Number($('zb-dim').value),
        monet: $('zb-monet').checked,
        wallpaperVisible: $('zb-vis').checked
      }, function (d) { status(d && d.windows > 0 ? '已应用 applied' : '已保存(ZCode 未连接)'); });
    }, 300);
  }

  // The control service lives in a separate process that can stop or die. When
  // it is unreachable the panel must say so instead of rendering values it
  // never read, and it must recover on its own once the service is back.
  var beatTimer = null;
  function panelOpen() { return !$('zb-panel').hidden; }
  /** Re-check the service: while the panel is open, and always while offline. */
  function beat(on) {
    if (on && !beatTimer) beatTimer = setInterval(refresh, 4000);
    if (!on && beatTimer) { clearInterval(beatTimer); beatTimer = null; }
  }

  function setOffline(on) {
    root.setAttribute('data-offline', on ? '1' : '0');
    $('zb-offline').hidden = !on;
    $('zb-retry').textContent = '重试连接';
    $('zb-fab').title = on ? 'ZCode Beautify — 美化服务未运行' : 'ZCode Beautify';
    if (on) {
      $('zb-blur').value = 0; $('zb-blur-val').textContent = '0';
      $('zb-dim').value = 0; $('zb-dim-val').textContent = '0';
      $('zb-monet').checked = false;
      $('zb-vis').checked = false;
      $('zb-fit').textContent = '背景填充: 未知';
      $('zb-fit').removeAttribute('data-fit');
      $('zb-reset').textContent = '还原默认外观';
      $('zb-reset').setAttribute('data-mode', 'reset');
      beat(true);
    } else {
      if (!panelOpen()) beat(false);
    }
  }

  // Last /api/config seen by refresh(); the add-button uses it to preselect
  // the currently applied wallpaper in a new rotation row.
  var lastConfig = null;
  function currentWallpaperKey() {
    if (lastConfig) {
      if (lastConfig.mediaType === 'video' && lastConfig.sceneHash) return 'h:' + lastConfig.sceneHash;
      if (lastConfig.wallpaperPath) return 'p:' + lastConfig.wallpaperPath;
      return '';
    }
    try { return localStorage.getItem('zcode-beautify:current-key') || ''; } catch (e) { return ''; }
  }

  function refresh() {
    fetch(API + '/api/config')
      .then(function (r) { return r.json(); })
      .then(function (c) {
        setOffline(false);
        lastConfig = c;
        $('zb-blur').value = c.blur; $('zb-blur-val').textContent = c.blur;
        $('zb-dim').value = c.dim; $('zb-dim-val').textContent = c.dim;
        $('zb-monet').checked = !!c.monet;
        $('zb-vis').checked = !!c.wallpaperVisible;
        $('zb-fit') && applyFitLabel($('zb-fit'), c.fit || 'cover');
        var resetBtn = $('zb-reset');
        if (c.wallpaperSet) {
          resetBtn.textContent = '还原默认外观';
          resetBtn.setAttribute('data-mode', 'reset');
          resetBtn.title = '移除壁纸与配色,还原 ZCode 默认外观(壁纸会被记住,可再次恢复)';
        } else if (c.hasBackup) {
          resetBtn.textContent = '恢复我的壁纸';
          resetBtn.setAttribute('data-mode', 'restore');
          resetBtn.title = '从备份恢复你之前的壁纸与配色';
        } else {
          resetBtn.textContent = '还原默认外观';
          resetBtn.setAttribute('data-mode', 'reset');
          resetBtn.title = '当前已是默认外观';
        }
      })
      .catch(function () { setOffline(true); });
  }

  $('zb-blur').addEventListener('input', function () {
    $('zb-blur-val').textContent = this.value; preview(); pushConfig();
  });
  $('zb-dim').addEventListener('input', function () {
    $('zb-dim-val').textContent = this.value; preview(); pushConfig();
  });
  $('zb-monet').addEventListener('change', pushConfig);
  $('zb-vis').addEventListener('change', pushConfig);

  var FITS = ['cover', 'contain', 'smart'];
  var FIT_LABELS = { cover: '填满裁剪', contain: '完整显示', smart: '智能适配' };
  function applyFitLabel(btn, fit) {
    btn.textContent = '背景填充: ' + (FIT_LABELS[fit] || fit);
    btn.setAttribute('data-fit', fit);
  }
  $('zb-fit').addEventListener('click', function () {
    var current = this.getAttribute('data-fit') || 'cover';
    var next = FITS[(FITS.indexOf(current) + 1) % FITS.length];
    applyFitLabel(this, next);
    post('/api/config', { fit: next }, function (d) { status(d && d.windows > 0 ? '已应用:' + FIT_LABELS[next] : '已保存(ZCode 未连接)'); });
  });

  var FXS = ['fade', 'slide', 'zoom', 'blur', 'none'];
  var FX_LABELS = { fade: '交叉淡入', slide: '右侧滑入', zoom: '缩放浮现', blur: '模糊渐清', none: '直接切换' };
  function applyFxLabel(sel, fx) {
    sel.value = FX_LABELS[fx] ? fx : 'fade';
  }
  // The effect is a per-plan setting; the dropdown edits the plan in the
  // editor and persists immediately (playback is not disturbed — the effect
  // is read from the active plan on every switch).
  $('zb-fx').addEventListener('change', function () {
    var plan = schedPlans[schedIdx];
    if (!plan) return;
    plan.transition = this.value;
    persistPlans();
  });

  $('zb-file').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { status('图片过大,上限 20 MB'); return; }
    var fr = new FileReader();
    fr.onload = function () {
      post('/api/wallpaper', { dataUri: fr.result, name: f.name }, function () { status('壁纸已更新 updated'); });
    };
    fr.readAsDataURL(f);
  });

  // --- scene wallpaper import ------------------------------------------------
  var STAGE_LABELS = {
    starting: '准备中', detect: '识别中', deps: '检查依赖', opening: '渲染中', 'render-ready': '渲染中',
    recording: '录制中', closing: '录制中', processing: '处理中', poster: '处理中', saving: '保存中',
    'cache-hit': '缓存命中', done: '完成', error: '失败'
  };
  var importTimer = null;
  function setProgress(on, stage, fromCache) {
    var box = $('zb-progress');
    box.hidden = !on;
    if (on) {
      var label = STAGE_LABELS[stage] || stage || '…';
      // The pipeline stages advance in order; map them onto a smooth bar.
      var order = ['starting', 'detect', 'deps', 'opening', 'render-ready', 'recording', 'closing', 'processing', 'poster', 'saving', 'done'];
      var pct = stage === 'done' ? 100 : (stage === 'cache-hit' ? 100 : 8 + 88 * Math.max(0, order.indexOf(stage)) / (order.length - 1));
      $('zb-progress-bar').style.width = pct + '%';
      box.firstElementChild.nextSibling.textContent = label + (stage === 'cache-hit' ? '(缓存)' : '');
    }
  }
  function showGuide(guide, retryable) {
    var g = $('zb-guide');
    g.hidden = !guide;
    g.textContent = guide || '';
    $('zb-guide-retry').hidden = !retryable;
  }
  $('zb-pick').addEventListener('click', function () {
    var btn = this;
    btn.textContent = '打开选择器…';
    fetch(API + '/api/pick-scene', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        btn.textContent = '选择并导入…';
        if (!d || !d.ok || !d.path) return; // user cancelled the dialog
        $('zb-scene-path').value = d.path;
        $('zb-import').click();
      })
      .catch(function () { btn.textContent = '选择并导入…'; status('无法连接美化服务 service unreachable'); });
  });

  $('zb-import').addEventListener('click', function () {
    var p = $('zb-scene-path').value.trim();
    if (!p) { status('请先粘贴场景壁纸路径'); return; }
    showGuide('', false);
    post('/api/import-scene', { path: p }, function (d) {
      if (d && d.error) { status(d.error); return; }
      setProgress(true, 'starting');
      if (importTimer) clearInterval(importTimer);
      importTimer = setInterval(pollImport, 600);
    });
  });
  function pollImport() {
    fetch(API + '/api/import-status')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        setProgress(j.running || j.stage === 'done', j.stage);
        if (j.error) {
          clearInterval(importTimer); importTimer = null;
          setProgress(false);
          showGuide(j.guide || ('导入失败: ' + j.error), Boolean(j.guide));
          return;
        }
        if (!j.running && j.stage === 'done') {
          clearInterval(importTimer); importTimer = null;
          status(j.result && j.result.fromCache ? '已从缓存载入' : '动态壁纸已应用');
          refresh();
        }
      })
      .catch(function () { /* transient */ });
  }
  $('zb-guide-retry').addEventListener('click', function () {
    showGuide('', false);
    $('zb-import').click();
  });

  // --- library (static images + imported scene loops) ------------------------
  function loadLibrary() {
    fetch(API + '/api/library')
      .then(function (r) { return r.json(); })
      .then(function (lib) {
        var el = $('zb-lib');
        el.innerHTML = '';
        var head1 = document.createElement('div');
        head1.className = 'zb-lib-head'; head1.textContent = '壁纸库 — 动态';
        el.appendChild(head1);
        (lib.scenes || []).forEach(function (s) {
          el.appendChild(libItem(s.name || ('场景 ' + s.hash.slice(0, 8)), { hash: s.hash }, s.hash, 'scene', s.hash));
        });
        var head2 = document.createElement('div');
        head2.className = 'zb-lib-head'; head2.textContent = '壁纸库 — 图片';
        el.appendChild(head2);
        (lib.images || []).forEach(function (im) {
          el.appendChild(libItem(im.name, { path: im.path }, im.path, 'image', im.path));
        });
        if (!(lib.scenes || []).length && !(lib.images || []).length) {
          el.innerHTML = '<div class="zb-lib-head">壁纸库为空 — 导入或更换壁纸后出现在这里</div>';
        }
      })
      .catch(function () { /* offline */ });
  }
  /** One library row: click-to-apply label + rename (inline) + two-step delete. */
  function libItem(label, applyBody, key, kind, ref) {
    var row = document.createElement('div');
    row.className = 'zb-item';
    var cur = localStorage.getItem('zcode-beautify:current-key');
    if (cur === key) row.setAttribute('data-current', '1');

    var labelEl = document.createElement('span');
    labelEl.className = 'zb-label';
    labelEl.textContent = label;
    labelEl.title = label;
    labelEl.addEventListener('click', function () {
      post('/api/apply-wallpaper', applyBody, function (r) {
        if (r && r.error) { status(r.error); return; }
        try { localStorage.setItem('zcode-beautify:current-key', key); } catch (e) {}
        status('已应用 applied');
        loadLibrary();
      });
    });
    row.appendChild(labelEl);

    function renameEditor() {
      var input = document.createElement('input');
      input.className = 'zb-label-input';
      input.value = label;
      row.replaceChild(input, labelEl);
      input.focus(); input.select();
      var done = function (save) {
        if (save && input.value.trim() && input.value.trim() !== label) {
          post('/api/library-rename', { kind: kind, hash: applyBody.hash, path: applyBody.path, name: input.value.trim() },
            function (r) {
              if (r && r.error) { status(r.error); }
              loadLibrary();
            });
        } else {
          loadLibrary();
        }
      };
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
      });
      input.addEventListener('blur', function () { done(true); });
    }

    var ren = document.createElement('button');
    ren.className = 'zb-act'; ren.textContent = '✎'; ren.title = '重命名';
    ren.addEventListener('click', renameEditor);
    row.appendChild(ren);

    var del = document.createElement('button');
    del.className = 'zb-act'; del.textContent = '🗑'; del.title = '删除';
    var disarm = null;
    del.addEventListener('click', function () {
      if (del.getAttribute('data-armed') !== '1') {
        del.setAttribute('data-armed', '1'); del.textContent = '确认删除?';
        disarm = setTimeout(function () { del.removeAttribute('data-armed'); del.textContent = '🗑'; }, 3000);
        return;
      }
      clearTimeout(disarm);
      post('/api/library-delete', { kind: kind, hash: applyBody.hash, path: applyBody.path }, function (r) {
        if (r && r.error) { status(r.error); del.removeAttribute('data-armed'); del.textContent = '🗑'; return; }
        if (localStorage.getItem('zcode-beautify:current-key') === key) {
          try { localStorage.removeItem('zcode-beautify:current-key'); } catch (e) {}
        }
        status('已删除 deleted');
        loadLibrary();
      });
    });
    row.appendChild(del);
    return row;
  }

  // --- wallpaper rotation (定时播放: plans, each with its own mode) ---------
  var schedOptions = [];
  var schedPlans = [];        // plans being edited (id/name/mode/entries)
  var schedIdx = 0;           // plan currently shown in the editor
  var schedActiveId = null;   // which plan plays (server side)
  var SCHED_DEFAULT_TIMES = ['09:00', '12:00', '18:00', '21:00'];
  var MODE_HINTS = {
    sequence: '每张播放设定的时长后自动切下一张,顺序循环;保存即开始',
    random: '随机顺序播放,同一张不会连续出现;保存即开始',
    schedule: '每天到设定的时间点切换到对应壁纸;保存后到点生效'
  };
  function schedMode() { return $('zb-sched-mode').value || 'sequence'; }
  function applyModeHint() { $('zb-sched-hint').textContent = MODE_HINTS[schedMode()] || ''; }
  function fetchScheduleOptions() {
    return fetch(API + '/api/library')
      .then(function (r) { return r.json(); })
      .then(function (lib) {
        schedOptions = [];
        (lib.scenes || []).forEach(function (s) {
          schedOptions.push({
            value: 'h:' + s.hash,
            label: '▶ ' + (s.name || ('场景 ' + s.hash.slice(0, 8))),
            thumb: API + '/media/poster/' + s.hash + '.jpg'
          });
        });
        (lib.images || []).forEach(function (im) {
          schedOptions.push({
            value: 'p:' + im.path,
            label: '🖼 ' + im.name,
            thumb: API + '/media/lib/' + encodeURIComponent(im.name)
          });
        });
        if (!schedOptions.length) schedOptions = [{ value: '', label: '(壁纸库为空)' }];
      })
      .catch(function () { /* offline */ });
  }
  /**
   * Wallpaper picker with thumbnail previews (native <option> elements cannot
   * show images). The row keeps its current value in a data-wp attribute; the
   * button shows the selected wallpaper's poster, clicking opens a popup list
   * where every option carries a preview image.
   */
  function wallpaperPicker(row, val) {
    var wrap = document.createElement('div');
    wrap.className = 'zb-wp-picker';
    var cur = null;
    for (var i = 0; i < schedOptions.length; i++) if (schedOptions[i].value === val) cur = schedOptions[i];
    var hasLib = schedOptions.length && schedOptions[0].value !== '';
    if (!cur) {
      if (!val && hasLib) { cur = schedOptions[0]; val = cur.value; }
      else cur = { value: val, label: val ? '(壁纸已失效)' : '(壁纸库为空)', thumb: null };
    }
    row.setAttribute('data-wp', val);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'zb-wp-btn';
    var img = document.createElement('img');
    if (cur.thumb) img.src = cur.thumb; else img.style.visibility = 'hidden';
    var span = document.createElement('span');
    span.textContent = cur.label;
    btn.appendChild(img); btn.appendChild(span);
    var pop = null;
    function closePop() {
      if (!pop) return;
      pop.remove(); pop = null;
      document.removeEventListener('mousedown', onDoc, true);
    }
    function onDoc(e) {
      if (pop && !pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closePop();
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (pop) { closePop(); return; }
      if (!hasLib) return;
      pop = document.createElement('div');
      pop.className = 'zb-wp-pop';
      schedOptions.forEach(function (o) {
        var it = document.createElement('div');
        it.className = 'zb-wp-item';
        if (o.value === row.getAttribute('data-wp')) it.setAttribute('data-cur', '1');
        var t = document.createElement('img');
        if (o.thumb) t.src = o.thumb; else t.style.visibility = 'hidden';
        var s = document.createElement('span');
        s.textContent = o.label;
        it.appendChild(t); it.appendChild(s);
        it.addEventListener('click', function (ev) {
          ev.stopPropagation();
          row.setAttribute('data-wp', o.value);
          if (o.thumb) { img.src = o.thumb; img.style.visibility = 'visible'; }
          else img.style.visibility = 'hidden';
          span.textContent = o.label;
          closePop();
        });
        pop.appendChild(it);
      });
      wrap.appendChild(pop);
      document.addEventListener('mousedown', onDoc, true);
    });
    wrap.appendChild(btn);
    return wrap;
  }
  function schedRow(entry) {
    var row = document.createElement('div');
    row.className = 'zb-sched-row';
    if (schedMode() === 'schedule') {
      var t = document.createElement('input');
      t.type = 'time';
      t.value = entry.time || '09:00';
      row.appendChild(t);
    } else {
      var d = document.createElement('input');
      d.type = 'number';
      d.min = '0.5'; d.step = '0.5';
      d.value = entry.seconds ? String(Math.round((entry.seconds / 60) * 10) / 10) : '5';
      d.title = '播放时长(分钟)';
      row.appendChild(d);
      var u = document.createElement('span');
      u.className = 'zb-sched-dur'; u.textContent = '分';
      row.appendChild(u);
    }
    var val = entry.hash ? ('h:' + entry.hash) : (entry.path ? ('p:' + entry.path) : '');
    row.appendChild(wallpaperPicker(row, val));
    var del = document.createElement('button');
    del.className = 'zb-act'; del.textContent = '✕'; del.title = '删除此条';
    del.addEventListener('click', function () { row.remove(); });
    row.appendChild(del);
    return row;
  }
  function renderSchedRows(entries) {
    var list = $('zb-sched-list');
    list.innerHTML = '';
    (entries || []).forEach(function (e) { list.appendChild(schedRow(e)); });
  }
  function renderPlanSelect() {
    var sel = $('zb-plan');
    sel.innerHTML = '';
    schedPlans.forEach(function (p, i) {
      var op = document.createElement('option');
      op.value = String(i);
      op.textContent = p.name + (p.id === schedActiveId ? ' (生效中)' : '');
      if (i === schedIdx) op.selected = true;
      sel.appendChild(op);
    });
  }
  function renderPlanEditor() {
    var plan = schedPlans[schedIdx];
    if (!plan) return;
    $('zb-sched-mode').value = plan.mode || 'sequence';
    $('zb-fx') && applyFxLabel($('zb-fx'), plan.transition || 'fade');
    applyModeHint();
    renderSchedRows(plan.entries || []);
  }
  /** Reads the row editor into entry objects for the currently shown mode. */
  function collectPlanEntries() {
    var entries = [];
    var rows = document.querySelectorAll('#zb-sched-list .zb-sched-row');
    var isSchedule = schedMode() === 'schedule';
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i].getAttribute('data-wp') || '';
      if (!v || v.length < 3) continue;
      var hash = v.slice(0, 2) === 'h:' ? v.slice(2) : undefined;
      var imgPath = v.slice(0, 2) !== 'h:' ? v.slice(2) : undefined;
      if (isSchedule) {
        var time = rows[i].querySelector('input[type=time]').value;
        if (!time) continue;
        entries.push({ time: time, hash: hash, path: imgPath });
      } else {
        var minutes = Number(rows[i].querySelector('input[type=number]').value);
        if (!isFinite(minutes) || minutes <= 0) continue;
        var seconds = Math.round(minutes * 60);
        if (seconds < 10) seconds = 10;
        entries.push({ seconds: seconds, hash: hash, path: imgPath });
      }
    }
    return entries;
  }
  /** Writes the editor (mode + rows) back into the plan being edited. */
  function syncEditorIntoPlan() {
    var plan = schedPlans[schedIdx];
    if (!plan) return;
    plan.mode = schedMode();
    plan.entries = collectPlanEntries();
  }
  function plansPayload() {
    return schedPlans.map(function (p) { return { id: p.id, name: p.name, mode: p.mode, transition: p.transition || 'fade', entries: p.entries }; });
  }
  /**
   * Auto-persists plan structure edits (rename / create / delete): what the
   * dropdown already shows must survive a reopen without requiring 保存.
   * Keeps the current enabled state and active plan so playback is not
   * disturbed; the editor is NOT reloaded afterwards.
   */
  function persistPlans() {
    syncEditorIntoPlan();
    var activeId = null;
    for (var i = 0; i < schedPlans.length; i++) if (schedPlans[i].id === schedActiveId) activeId = schedActiveId;
    post('/api/rotation', {
      rotation: {
        enabled: $('zb-sched-on').checked,
        activePlanId: activeId,
        plans: plansPayload()
      }
    }, function (d) {
      if (d && d.error) { status(d.error); return; }
      if (d && d.rotation) schedActiveId = d.rotation.activePlanId || schedActiveId;
      renderPlanSelect();
    });
  }
  /** Cross-mode conversion: keeps the wallpaper refs, carries over seconds
   *  when present, spreads default times when switching to schedule. */
  function convertEntries(rawEntries, toMode) {
    return (rawEntries || []).map(function (e, i) {
      var out = e.hash ? { hash: e.hash } : { path: e.path };
      if (toMode === 'schedule') out.time = e.time || SCHED_DEFAULT_TIMES[i % SCHED_DEFAULT_TIMES.length];
      else out.seconds = e.seconds || 300;
      return out;
    });
  }
  function loadRotation() {
    fetchScheduleOptions().then(function () {
      return fetch(API + '/api/rotation').then(function (r) { return r.json(); });
    }).then(function (d) {
      var rot = (d && d.rotation) || {};
      schedPlans = rot.plans && rot.plans.length
        ? rot.plans
        : [{ id: 'default', name: '方案 1', mode: 'sequence', entries: [] }];
      schedActiveId = rot.activePlanId || (schedPlans[0] && schedPlans[0].id) || null;
      var activeIdx = -1;
      for (var i = 0; i < schedPlans.length; i++) if (schedPlans[i].id === schedActiveId) activeIdx = i;
      schedIdx = activeIdx >= 0 ? activeIdx : 0;
      $('zb-sched-on').checked = !!rot.enabled;
      renderPlanSelect();
      renderPlanEditor();
    }).catch(function () { /* offline */ });
  }
  // Plan switching keeps the edited plan's state; the editor loads the newly
  // selected plan from schedPlans.
  $('zb-plan').addEventListener('change', function () {
    syncEditorIntoPlan();
    schedIdx = Number(this.value) || 0;
    renderPlanSelect();
    renderPlanEditor();
  });
  $('zb-plan-add').addEventListener('click', function () {
    syncEditorIntoPlan();
    schedPlans.push({ id: 'p' + Date.now().toString(36), name: '方案 ' + (schedPlans.length + 1), mode: 'sequence', entries: [] });
    schedIdx = schedPlans.length - 1;
    renderPlanSelect();
    renderPlanEditor();
    persistPlans();
  });
  $('zb-plan-ren').addEventListener('click', function () {
    var row = document.querySelector('.zb-sched-plan');
    var sel = $('zb-plan');
    var plan = schedPlans[schedIdx];
    if (!plan || !row) return;
    var input = document.createElement('input');
    input.type = 'text';
    input.value = plan.name;
    input.className = 'zb-label-input';
    input.style.flex = '1';
    row.replaceChild(input, sel);
    input.focus(); input.select();
    // One-shot guard: restoring the select unfocuses the input and fires
    // blur, which would otherwise run done() a second time (and an Escape
    // cancel would still commit the typed name).
    var finished = false;
    var done = function (save) {
      if (finished) return;
      finished = true;
      if (save && input.value.trim()) plan.name = input.value.trim().slice(0, 20);
      row.replaceChild(sel, input);
      renderPlanSelect();
      if (save) persistPlans();
    };
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', function () { done(true); });
  });
  $('zb-plan-del').addEventListener('click', function () {
    var btn = this;
    if (schedPlans.length <= 1) { status('至少保留一个方案'); return; }
    if (btn.getAttribute('data-armed') !== '1') {
      btn.setAttribute('data-armed', '1'); btn.textContent = '确认?';
      setTimeout(function () { btn.removeAttribute('data-armed'); btn.textContent = '🗑'; }, 3000);
      return;
    }
    btn.removeAttribute('data-armed'); btn.textContent = '🗑';
    var removed = schedPlans.splice(schedIdx, 1)[0];
    if (schedActiveId === removed.id) schedActiveId = null;
    schedIdx = Math.min(schedIdx, schedPlans.length - 1);
    renderPlanSelect();
    renderPlanEditor();
    persistPlans();
  });
  // Switching modes re-renders the rows in the new editor shape, keeping the
  // wallpapers and converting timing fields with sensible defaults.
  $('zb-sched-mode').addEventListener('change', function () {
    applyModeHint();
    var plan = schedPlans[schedIdx];
    if (!plan) return;
    plan.mode = schedMode();
    plan.entries = convertEntries(collectPlanEntries(), plan.mode);
    renderSchedRows(plan.entries);
  });
  $('zb-sched-add').addEventListener('click', function () {
    var doAdd = function () {
      var entry = schedMode() === 'schedule' ? { time: '09:00' } : { seconds: 300 };
      var key = currentWallpaperKey();
      if (key.slice(0, 2) === 'h:') entry.hash = key.slice(2);
      else if (key.length > 2) entry.path = key.slice(2);
      $('zb-sched-list').appendChild(schedRow(entry));
    };
    if (!schedOptions.length || schedOptions[0].value === '') {
      fetchScheduleOptions().then(function () {
        if (!schedOptions.length || schedOptions[0].value === '') { status('壁纸库为空,先导入或更换壁纸'); return; }
        doAdd();
      });
      return;
    }
    doAdd();
  });
  $('zb-sched-save').addEventListener('click', function () {
    syncEditorIntoPlan();
    var payload = {
      enabled: $('zb-sched-on').checked,
      activePlanId: schedPlans[schedIdx] ? schedPlans[schedIdx].id : undefined,
      plans: plansPayload()
    };
    post('/api/rotation', { rotation: payload }, function (d) {
      if (d && d.error) { status(d.error); return; }
      status(payload.enabled ? '已保存,当前方案生效' : '已保存(未启用)');
      loadRotation();
    });
  });
  // 播放 = save everything AND force-enable the edited plan right now —
  // one click from any state to visible playback.
  $('zb-sched-play').addEventListener('click', function () {
    syncEditorIntoPlan();
    var plan = schedPlans[schedIdx];
    var payload = {
      enabled: true,
      activePlanId: plan ? plan.id : undefined,
      plans: plansPayload()
    };
    post('/api/rotation', { rotation: payload }, function (d) {
      if (d && d.error) { status(d.error); return; }
      $('zb-sched-on').checked = true;
      status(plan ? '开始播放:' + plan.name : '开始播放');
      loadRotation();
    });
  });
  // 立即切换: skip the current entry's remaining duration, next wallpaper now.
  $('zb-sched-next').addEventListener('click', function () {
    post('/api/rotation-next', {}, function (d) {
      if (d && d.error) { status(d.error); return; }
      status('已切换到下一张');
    });
  });

  $('zb-reset').addEventListener('click', function () {
    var mode = this.getAttribute('data-mode') || 'reset';
    post(mode === 'restore' ? '/api/restore' : '/api/reset', {}, function () {
      if (mode === 'reset') {
        try { localStorage.removeItem('zcode-beautify:css'); localStorage.removeItem('zcode-beautify:wallpaper'); } catch (e) {}
        status('已还原默认外观');
      } else {
        status('已恢复你的壁纸');
      }
      refresh();
    });
  });

  $('zb-retry').addEventListener('click', function () {
    this.textContent = '正在重试…';
    refresh();
  });

  // --- tabs (壁纸 / 定时播放) ------------------------------------------------
  function switchTab(name) {
    var tabs = document.querySelectorAll('.zb-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].setAttribute('data-active', tabs[i].getAttribute('data-tab') === name ? '1' : '0');
    }
    $('zb-tab-main').hidden = name !== 'main';
    $('zb-tab-sched').hidden = name !== 'sched';
    try { localStorage.setItem('zcode-beautify:tab', name); } catch (e) {}
    if (name === 'sched') loadRotation();
    else { refresh(); loadLibrary(); }
  }
  $('zb-tabs').addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.zb-tab') : null;
    if (b) switchTab(b.getAttribute('data-tab'));
  });
  function activateSavedTab() {
    var saved = 'main';
    try { saved = localStorage.getItem('zcode-beautify:tab') || 'main'; } catch (e) {}
    switchTab(saved === 'sched' ? 'sched' : 'main');
  }

  $('zb-fab').addEventListener('click', function () {
    var p = $('zb-panel');
    p.hidden = !p.hidden;
    if (!p.hidden) {
      // A previously dragged panel can sit (partially) outside the viewport,
      // which reads as "the panel did not open". Pull it back in.
      var r = p.getBoundingClientRect();
      if (r.width && (r.right < 40 || r.bottom < 40 || r.left > window.innerWidth - 40 || r.top > window.innerHeight - 40)) {
        p.style.left = ''; p.style.top = ''; p.style.right = ''; p.style.bottom = '';
      }
      activateSavedTab();
      beat(true);
    } else if (root.getAttribute('data-offline') !== '1') {
      beat(false);
    }
  });

  // Fill in the fit label (and control values) right away, not just on open.
  refresh();

  (function () {
    var head = $('zb-head'), panel = $('zb-panel');
    var sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    head.addEventListener('pointerdown', function (e) {
      dragging = true; sx = e.clientX; sy = e.clientY;
      var r = panel.getBoundingClientRect(); ox = r.left; oy = r.top;
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var x = Math.max(4, Math.min(window.innerWidth - 80, ox + e.clientX - sx));
      var y = Math.max(4, Math.min(window.innerHeight - 60, oy + e.clientY - sy));
      panel.style.left = x + 'px'; panel.style.top = y + 'px';
    });
    head.addEventListener('pointerup', function () { dragging = false; });
  })();

  // Self-heal: if the theme style is missing but a previous injection saved it,
  // restore it from localStorage.
  if (!document.getElementById('zcode-beautify-style')) {
    var savedCss = null, savedWp = null;
    try {
      savedCss = localStorage.getItem('zcode-beautify:css');
      savedWp = localStorage.getItem('zcode-beautify:wallpaper');
    } catch (e) {}
    if (savedCss) {
      var s = document.createElement('style');
      s.id = 'zcode-beautify-style';
      s.textContent = savedCss;
      (document.head || document.documentElement).appendChild(s);
      if (savedWp && !wallpaperEl()) {
        var w = document.createElement('div');
        w.id = 'zcode-beautify-wallpaper';
        document.documentElement.appendChild(w);
        w.style.backgroundImage = 'url(' + savedWp + ')';
      }
    }
  }
})();`;
}
