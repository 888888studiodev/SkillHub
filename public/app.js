const state = { categories: [], posts: [], selected: null, post: null, query: '', missing: false, collapsed: new Set() };
const pageBase = new URL('.', location.href);
let navigationRequest = 0;
let stopPostOutline;
const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const date = value => new Date(value.replace(' ', 'T') + 'Z').toLocaleString('zh-CN', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
const avatar = name => `<span class="avatar">${escapeHTML(name.slice(0, 1))}</span>`;
const schematicIcon = name => `<svg class="schematic-icon" aria-hidden="true"><use href="#sch-${name}"/></svg>`;
let traceFrame = 0;

function scheduleBlueprintTrace() {
  if (traceFrame) return;
  traceFrame = requestAnimationFrame(() => {
    traceFrame = 0;
    const trace = $('#blueprint-trace');
    const source = $('#tree .tree-row.active') || $('#all.selected');
    const target = $('#content .post-row, #content .post-article') || $('#content .post-status');
    trace.toggleAttribute('hidden', !source || !target);
    if (!source || !target) return;

    const layout = $('.layout').getBoundingClientRect();
    const start = source.getBoundingClientRect();
    const end = target.getBoundingClientRect();
    const x1 = Math.round(start.right - layout.left);
    const x2 = Math.round(end.left - layout.left);
    const y1 = Math.round(start.top - layout.top + start.height / 2);
    const y2 = Math.round(end.top - layout.top + Math.min(52, end.height / 2));
    const bend = Math.round(x1 + (x2 - x1) * 0.56);
    const curve = Math.min(7, Math.abs(y2 - y1) / 2);
    const direction = Math.sign(y2 - y1);
    const path = `M ${x1} ${y1} H ${bend - curve}
      Q ${bend} ${y1} ${bend} ${y1 + direction * curve}
      V ${y2 - direction * curve} Q ${bend} ${y2} ${bend + curve} ${y2} H ${x2}`;
    for (const line of trace.querySelectorAll('path')) line.setAttribute('d', path);
    const port = trace.querySelector('rect');
    port.setAttribute('x', x2 - 4);
    port.setAttribute('y', y2 - 4);
  });
}

async function api(url, options = {}) {
  const response = await fetch('api' + url, { ...options, headers: { 'Content-Type': 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作失败');
  return data;
}
function notify(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3000); }
async function refresh(restoreUrl = false) {
  [state.categories, state.posts] = await Promise.all([api('/categories'), api('/posts')]);
  if (restoreUrl) return restorePageFromUrl();
  renderTree();
  renderContent();
}

function pagePath(slug) {
  return new URL(slug || '.', pageBase).pathname;
}

function updatePageUrl(slug, replace = false) {
  const path = pagePath(slug);
  if (path === location.pathname) return;
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
}

function isOrdinaryLinkClick(event) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
function descendants(id) {
  const ids = new Set([id]); let changed = true;
  while (changed) { changed = false; for (const category of state.categories) if (ids.has(category.parent_id) && !ids.has(category.id)) { ids.add(category.id); changed = true; } }
  return ids;
}
function renderTree() {
  function branch(parent, depth) {
    return state.categories.filter(c => c.parent_id === parent).map(c => {
      const children = state.categories.some(item => item.parent_id === c.id);
      return `<div data-direction-id="${c.id}" data-depth="${depth}" class="tree-row ${state.selected === c.id ? 'active' : ''}" style="--depth:${depth}"><button class="toggle" data-toggle="${c.id}" aria-label="展开或收起">${children ? (state.collapsed.has(c.id) ? '›' : '⌄') : ''}</button><a class="tree-name" data-category="${c.id}" href="${escapeHTML(pagePath(c.slug))}"><span class="folder">${schematicIcon('folder')}</span><span>${escapeHTML(c.name)}</span></a><span class="direction-grip" data-direction-grip aria-hidden="true" title="拖动排序，或移入另一个方向">⠿</span><button class="dots" data-actions="${c.id}" aria-label="方向操作">···</button></div>${state.collapsed.has(c.id) ? '' : branch(c.id, depth + 1)}`;
    }).join('');
  }
  const rows = branch(null, 0);
  $('#tree').innerHTML = rows
    ? `${rows}<div class="direction-root-drop" data-direction-root>移到顶层末尾</div>`
    : '<p class="tree-empty">还没有方向，添加一个吧</p>';
  $('#all').classList.toggle('selected', state.selected === null && !state.post && !state.missing);
  scheduleBlueprintTrace();
}
function breadcrumbs(categoryId, title) {
  const path = [];
  for (let id = categoryId; id != null;) {
    const category = state.categories.find(item => item.id === id);
    if (!category) break;
    path.unshift(category);
    id = category.parent_id;
  }
  const home = schematicIcon('home');
  const items = [{ id: '', name: '主页', icon: home }, ...path];
  if (title) items.push({ name: title });

  return `<nav class="breadcrumbs" aria-label="当前位置"><ol>${items.map((item, index) => {
    const content = item.icon || escapeHTML(item.name);
    const style = item.icon ? ' breadcrumb-home' : '';
    const accessibleName = item.icon ? ' aria-label="主页"' : '';
    const crumb = index === items.length - 1
      ? `<span class="breadcrumb-item${style}" aria-current="page"${accessibleName}>${content}</span>`
      : `<button type="button" class="breadcrumb-item${style}" data-breadcrumb="${item.id}"${accessibleName}>${content}</button>`;
    return `<li>${crumb}</li>`;
  }).join('')}</ol></nav>`;
}

function navigateDirection(id, writeUrl = true) {
  navigationRequest++;
  state.selected = id;
  state.post = null;
  state.missing = false;
  if (writeUrl) updatePageUrl(state.categories.find(category => category.id === id)?.slug);
  setSidebarOpen(false);
  renderTree();
  renderContent();
}

async function navigatePost(id, writeUrl = true) {
  const request = ++navigationRequest;
  const post = await api(`/posts/${id}`);
  if (request !== navigationRequest) return;
  state.post = post;
  state.selected = post.category_id;
  state.missing = false;
  if (writeUrl) updatePageUrl(post.slug);
  renderTree();
  renderContent();
}

function restorePageFromUrl() {
  const slug = location.pathname.slice(pageBase.pathname.length);
  if (!slug) return navigateDirection(null, false);
  const category = state.categories.find(item => item.slug === slug);
  if (category) return navigateDirection(category.id, false);
  const post = state.posts.find(item => item.slug === slug);
  if (post) return navigatePost(post.id, false);

  navigationRequest++;
  state.selected = null;
  state.post = null;
  state.missing = true;
  renderTree();
  renderContent();
}

function renderContent() {
  stopPostOutline?.();
  stopPostOutline = null;
  scheduleBlueprintTrace();
  if (state.post) return renderPost();
  if (state.missing) {
    document.title = '页面不存在 — SkillHub';
    $('#content').innerHTML = '<section class="page"><h1>页面不存在</h1><button class="secondary" data-breadcrumb="">返回主页</button></section>';
    return;
  }
  const cat = state.categories.find(c => c.id === state.selected);
  document.title = cat ? `${cat.name} — SkillHub` : 'SkillHub — 团队的 Skill 知识库';
  const ids = cat ? descendants(cat.id) : null;
  const query = state.query.toLowerCase();
  const childCount = cat?.parent_id === null
    ? state.categories.filter(category => category.parent_id === cat.id).length
    : null;
  const directionPosts = ids ? state.posts.filter(post => ids.has(post.category_id)) : state.posts;
  const posts = directionPosts.filter(post =>
    `${post.title} ${post.content} ${post.author} ${post.category_name}`.toLowerCase().includes(query));
  const latest = directionPosts.reduce((time, post) => post.created_at > time ? post.created_at : time, '');
  const latestDate = latest
    ? `<time datetime="${escapeHTML(latest.replace(' ', 'T') + 'Z')}">${date(latest)}</time>`
    : '—';

  $('#content').innerHTML = `
    <section class="page">
      ${breadcrumbs(cat?.id)}
      <div class="page-title">
        <h1>${cat ? escapeHTML(cat.name) : '发现团队的好 Skill'}</h1>
        <button class="primary" id="list-new">${schematicIcon('plus')} 分享 Skill</button>
      </div>
      <div class="post-status">
        <div class="post-status-counts">
          ${childCount === null ? '' : `<span><strong>${childCount}</strong> 个子方向</span>`}
          <span><strong>${directionPosts.length}</strong> 篇帖子</span>
        </div>
        <span>最新发布 <strong>${latestDate}</strong></span>
      </div>
      ${posts.length ? `<div class="post-list">${posts.map(p => `
        <a class="post-row" data-post="${p.id}" href="${escapeHTML(pagePath(p.slug))}">
          <span class="post-schematic">${schematicIcon('chip')}</span>
          <svg class="post-traces" viewBox="0 0 320 150" preserveAspectRatio="xMaxYMid meet" aria-hidden="true"><use href="#sch-card-traces"/></svg>
          <div class="post-main">
            <div class="post-title">${escapeHTML(p.title)}</div>
            <p>${escapeHTML(p.content.slice(0, 100) || '包含图片或视频')}</p>
            <div class="post-meta"><span>${escapeHTML(p.author)}</span><span>·</span><span>${escapeHTML(p.category_name)}</span><span>·</span><span>${date(p.created_at)}</span></div>
          </div>
          <span class="comment-count" aria-label="${p.comment_count} 条评论">${schematicIcon('comments')} ${p.comment_count}</span><span class="row-arrow">${schematicIcon('chevron')}</span>
        </a>`).join('')}</div>` : `
        <div class="empty">
          <div class="empty-icon">${schematicIcon('chip')}</div>
          <h3>${query ? '没有找到相关内容' : '这里还没有分享'}</h3>
          ${!query ? '<button class="secondary" id="empty-new">＋ 分享第一个 Skill</button>' : ''}
        </div>`}
    </section>`;
  $('#list-new').onclick = openPostDialog;
  if ($('#empty-new')) $('#empty-new').onclick = openPostDialog;
}
function renderPost() {
  const p = state.post;
  document.title = `${p.title} — SkillHub`;
  $('#content').innerHTML = `
    <div class="page detail">
      ${breadcrumbs(p.category_id, p.title)}
      <div class="post-layout">
        <article class="post-article">
          <div class="detail-title">
            <h1 id="post-title">${escapeHTML(p.title)}</h1>
            <button class="secondary" id="edit-document">编辑文档</button>
          </div>
          <div class="author-line">${avatar(p.author)}<div><strong>${escapeHTML(p.author)}</strong><span>${date(p.created_at)}</span></div></div>
          ${p.source ? `<div class="source">↗ <span>来源</span><a href="${escapeHTML(p.source)}" target="_blank" rel="noopener noreferrer">${escapeHTML(p.source)}</a></div>` : ''}
          <div id="post-document" class="post-body${p.document ? ' rich-document' : ''}">${p.document ? '' : escapeHTML(p.content)}</div>
          <section class="comments" id="post-comments">
            <div class="comment-heading"><h2>评论 <span>${p.comments.length}</span></h2></div>
            ${p.comments.map(c => `
              <div class="comment">
                ${avatar(c.author)}
                <div>
                  <div class="comment-meta"><strong>${escapeHTML(c.author)}</strong><time>${date(c.created_at)}</time></div>
                  <p>${escapeHTML(c.content)}</p>
                </div>
              </div>`).join('')}
            <form id="comment-form" class="comment-form">
              <div class="comment-form-top">
                ${namePickerFields()}
                <button type="submit" class="primary">发表评论</button>
              </div>
              <textarea id="comment" name="content" aria-label="评论" rows="2" maxlength="10000" required placeholder="写下你的评论..."></textarea>
              <p id="comment-error" class="error" role="alert"></p>
            </form>
          </section>
        </article>
        <nav class="post-outline" id="post-outline" aria-label="帖子目录"></nav>
      </div>
    </div>`;
  if (p.document) renderDocument($('#post-document'), p.document);
  stopPostOutline = trackPostOutline(p.title);
  $('#edit-document').onclick = () => editSkill({
    id: p.id, title: p.title, categoryId: p.category_id,
    content: p.content, document: p.document
  });
  const commentForm = $('#comment-form');
  setupNamePicker(commentForm.querySelector('.name-picker'));
  commentForm.onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(commentForm);
    try {
      await api(`/posts/${p.id}/comments`, {
        method: 'POST', body: { author: form.get('author'), content: form.get('content') }
      });
      state.post = await api(`/posts/${p.id}`);
      await refresh();
    } catch (error) {
      $('#comment-error').textContent = error.message;
    }
  };
}
function trackPostOutline(title) {
  const outline = $('#post-outline');
  const headings = [...$('#post-document').querySelectorAll('h1, h2, h3, h4, h5, h6')]
    .filter(heading => heading.textContent.trim());
  const shallowest = Math.min(6, ...headings.map(heading => Number(heading.tagName[1])));
  const items = [
    { target: $('#post-title'), label: title, depth: 0 },
    ...headings.map(target => ({
      target, label: target.textContent.trim(), depth: Number(target.tagName[1]) - shallowest + 1
    })),
    { target: $('#post-comments'), label: '评论', depth: 0 }
  ];
  outline.innerHTML = `<ol>${items.map(({ label, depth }, index) => `
    <li><button type="button" data-outline-index="${index}" style="--outline-depth:${depth}" title="${escapeHTML(label)}">${escapeHTML(label)}</button></li>
  `).join('')}</ol>`;

  for (const { target } of items) target.classList.add('outline-target');
  const buttons = outline.querySelectorAll('button');
  const scrollTarget = document.scrollingElement;
  const listeners = new AbortController();
  let active = -1;
  let frame = 0;

  function markActive(index) {
    if (index === active) return;
    buttons[active]?.removeAttribute('aria-current');
    const button = buttons[index];
    button.setAttribute('aria-current', 'location');
    active = index;
    const bounds = outline.getBoundingClientRect();
    const row = button.getBoundingClientRect();
    if (row.top < bounds.top) outline.scrollTop += row.top - bounds.top;
    else if (row.bottom > bounds.bottom) outline.scrollTop += row.bottom - bounds.bottom;
  }

  function update() {
    frame = 0;
    if (!outline.getClientRects().length) return;
    const atBottom = scrollTarget.scrollTop > 0 &&
      scrollTarget.scrollTop + scrollTarget.clientHeight >= scrollTarget.scrollHeight - 2;
    let index = 0;
    for (let i = 1; i < items.length; i++) {
      if (items[i].target.getBoundingClientRect().top > 90) break;
      index = i;
    }
    markActive(atBottom ? items.length - 1 : index);
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  outline.addEventListener('click', event => {
    const button = event.target.closest('[data-outline-index]');
    if (!button) return;
    const index = Number(button.dataset.outlineIndex);
    items[index].target.scrollIntoView({ block: 'start' });
    markActive(index);
  }, { signal: listeners.signal });
  window.addEventListener('scroll', schedule, { passive: true, signal: listeners.signal });
  window.addEventListener('resize', schedule, { signal: listeners.signal });
  $('#post-document').addEventListener('load', schedule, { capture: true, signal: listeners.signal });
  update();

  return () => {
    listeners.abort();
    cancelAnimationFrame(frame);
  };
}

function dialog(title, fields, submit, saveLabel = '保存', afterSubmit = refresh) {
  $('#dialog-title').textContent = title; $('#dialog-fields').innerHTML = fields; $('#dialog-error').textContent = ''; $('#submit-dialog').textContent = saveLabel; $('#submit-dialog').disabled = false; $('#dialog').showModal();
  $('#dialog-form').onsubmit = async e => {
    e.preventDefault();
    const button = $('#submit-dialog');
    button.disabled = true;
    try {
      const result = await submit(new FormData(e.target));
      $('#dialog').close();
      await afterSubmit(result);
    } catch (error) {
      $('#dialog-error').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}
const presetNames = ['股东F', '股东M'];
const nameStorageKey = 'skillhub-name-preferences';
let sessionNames = { custom: [], selected: '' };

function readNamePreference() {
  try {
    const saved = JSON.parse(localStorage.getItem(nameStorageKey));
    if (Array.isArray(saved?.custom) && typeof saved.selected === 'string') return saved;
  } catch {
    // The picker can still work for this session if storage is unavailable.
  }
  return sessionNames;
}

function rememberName(name, addCustom = false) {
  const { custom } = readNamePreference();
  const names = addCustom && !presetNames.includes(name) && !custom.includes(name) ? [...custom, name] : custom;
  sessionNames = { custom: names, selected: name };
  try { localStorage.setItem(nameStorageKey, JSON.stringify(sessionNames)); } catch {}
}

function nameOptions(selected) {
  const preference = readNamePreference();
  const names = [...new Set([...presetNames, ...preference.custom])];
  selected ??= preference.selected;
  return `<option value="" disabled${names.includes(selected) ? '' : ' selected'}>选择名称</option>` + names.map(name =>
    `<option value="${escapeHTML(name)}"${name === selected ? ' selected' : ''}>${escapeHTML(name)}</option>`).join('') +
    '<option value="" data-create-name>＋ 新建名称</option>';
}

function namePickerFields(label = '名称', selected) {
  return `<div class="name-picker">
    <label>${label}<select name="author" required>${nameOptions(selected)}</select></label>
    <div class="name-create" data-name-create hidden>
      <label>新名称<input data-name-input maxlength="40"></label>
      <div class="name-create-actions">
        <button type="button" class="secondary" data-name-cancel>取消</button>
        <button type="button" class="primary" data-name-save>创建</button>
      </div>
      <p class="error" data-name-error role="alert"></p>
    </div>
  </div>`;
}

function setupNamePicker(picker) {
  const select = picker.querySelector('select[name="author"]');
  const panel = picker.querySelector('[data-name-create]');
  const input = picker.querySelector('[data-name-input]');
  const error = picker.querySelector('[data-name-error]');
  let selected = select.value;
  function close() {
    panel.hidden = true;
    input.value = error.textContent = '';
    select.focus();
  }
  function create() {
    const name = input.value.trim();
    if (!name) {
      error.textContent = '请输入名称';
      input.focus();
      return;
    }
    rememberName(name, true);
    select.innerHTML = nameOptions(name);
    selected = name;
    close();
  }
  select.onchange = () => {
    if (select.selectedOptions[0]?.hasAttribute('data-create-name')) {
      select.value = selected;
      panel.hidden = false;
      input.focus();
      return;
    }
    selected = select.value;
    rememberName(selected);
    if (!panel.hidden) close();
  };
  picker.querySelector('[data-name-cancel]').onclick = close;
  picker.querySelector('[data-name-save]').onclick = create;
  input.onkeydown = event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    create();
  };
  return select;
}

function categoryDialog(parentId = null) {
  dialog(parentId ? '新增子方向' : '新增大方向', '<label>方向名称<input name="name" maxlength="80" required placeholder="例如：设计、前端开发"></label>', async form => { await api('/categories', { method:'POST', body:{ name:form.get('name'), parentId } }); if (parentId) state.collapsed.delete(parentId); });
}
function categoryOptions(selected) {
  function branch(parentId, path) {
    return state.categories.filter(category => category.parent_id === parentId).map(category => {
      const label = [...path, category.name];
      return `<option value="${category.id}" ${category.id === selected ? 'selected' : ''}>${escapeHTML(label.join(' / '))}</option>` +
        branch(category.id, label);
    }).join('');
  }
  return branch(null, []) || '<option value="" selected disabled>请先新建方向</option>';
}

function categoryPickerFields(selected) {
  return `
    <label class="direction-select">所属方向<select name="categoryId" required>${categoryOptions(selected)}</select></label>
    <div class="direction-actions">
      <button type="button" data-add-root>＋ 新建方向</button>
      <button type="button" data-add-child>＋ 新建子方向</button>
    </div>
    <div class="share-category-panel" data-category-panel hidden>
      <label><span data-category-label>方向名称</span><input data-category-name maxlength="80" placeholder="输入方向名称"></label>
      <div class="direction-actions">
        <button type="button" data-category-save>创建并选中</button>
        <button type="button" data-category-cancel>取消</button>
      </div>
      <p class="error" data-category-error role="alert"></p>
    </div>`;
}

function openPostDialog() {
  dialog('分享 Skill', `
    ${categoryPickerFields(state.selected)}
    <label>Skill 名称<input name="title" required maxlength="160" placeholder="给这篇分享起个标题"></label>
    <label>介绍<textarea name="content" required maxlength="20000" rows="4" placeholder="简单介绍一下这个 Skill"></textarea></label>
    ${namePickerFields('发布人')}
  `, form => {
    const categoryId = Number(form.get('categoryId'));
    const title = form.get('title').trim();
    const content = form.get('content').trim();
    if (!state.categories.some(category => category.id === categoryId)) throw new Error('请选择所属方向');
    if (!title || !content) throw new Error('请填写 Skill 名称和介绍');
    return { categoryId, title, content, author: form.get('author') };
  }, '确认', editSkill);
  const fields = $('#dialog-fields');
  setupCategoryPicker(fields, $('#submit-dialog'));
  setupNamePicker(fields.querySelector('.name-picker'));
}

function setupCategoryPicker(container, submit) {
  const field = selector => container.querySelector(selector);
  const select = field('select[name="categoryId"]');
  const panel = field('[data-category-panel]');
  const input = field('[data-category-name]');
  const createRoot = field('[data-add-root]');
  const createChild = field('[data-add-child]');
  const create = field('[data-category-save]');
  const cancel = field('[data-category-cancel]');
  const error = field('[data-category-error]');
  let parentId = null;

  function openCategoryPanel(parent) {
    parentId = parent?.id ?? null;
    field('[data-category-label]').textContent = parent ? `在「${parent.name}」下新建子方向` : '方向名称';
    input.value = error.textContent = '';
    panel.hidden = false;
    submit.disabled = true;
    input.focus();
  }

  function closeCategoryPanel() {
    panel.hidden = true;
    submit.disabled = false;
    select.focus();
  }

  createChild.disabled = !select.value;
  select.onchange = () => {
    createChild.disabled = !select.value;
    if (!panel.hidden) closeCategoryPanel();
  };
  createRoot.onclick = () => openCategoryPanel(null);
  createChild.onclick = () => {
    const parent = state.categories.find(item => item.id === Number(select.value));
    if (parent) openCategoryPanel(parent);
  };
  cancel.onclick = closeCategoryPanel;
  create.onclick = async () => {
    if (!input.value.trim()) {
      error.textContent = '请输入方向名称';
      input.focus();
      return;
    }
    createRoot.disabled = createChild.disabled = create.disabled = cancel.disabled = select.disabled = true;
    error.textContent = '';
    try {
      const category = await api('/categories', { method: 'POST', body: { name: input.value, parentId } });
      if (!state.categories.some(item => item.id === category.id)) state.categories.push(category);
      for (let parent = category.parent_id; parent; parent = state.categories.find(item => item.id === parent)?.parent_id) {
        state.collapsed.delete(parent);
      }
      renderTree();
      if (!select.isConnected || select.closest('dialog:not([open])')) return;
      select.innerHTML = categoryOptions(category.id);
      select.disabled = false;
      closeCategoryPanel();
      select.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (failure) {
      error.textContent = failure.message;
    } finally {
      createRoot.disabled = create.disabled = cancel.disabled = select.disabled = false;
      createChild.disabled = !select.value;
    }
  };
  input.onkeydown = event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!create.disabled) create.click();
    }
  };
}

function editSkill(draft) {
  setSidebarOpen(false);
  openDocumentEditor(draft, async body => {
    const post = draft.id
      ? await api(`/posts/${draft.id}`, { method: 'PATCH', body })
      : await api('/posts', { method: 'POST', body });
    state.post = post;
    state.selected = post.category_id;
    state.missing = false;
    updatePageUrl(post.slug);
    renderTree();
    renderContent();
    refresh().catch(error => notify(error.message));
  }, async () => {
    await api(`/posts/${draft.id}`, { method: 'DELETE' });
    state.posts = state.posts.filter(post => post.id !== draft.id);
    const category = state.categories.find(item => item.id === draft.categoryId);
    updatePageUrl(category?.slug, true);
    navigateDirection(category?.id ?? null, false);
    refresh().catch(error => notify(error.message));
  });
}

const mobileMenu = $('#mobile-menu');
function setSidebarOpen(open) {
  const wasOpen = document.body.classList.contains('nav-open');
  if (wasOpen === open) return;
  document.body.classList.toggle('nav-open', open);
  mobileMenu.setAttribute('aria-expanded', String(open));
  mobileMenu.setAttribute('aria-label', open ? '收起目录' : '打开目录');
  if (open) $('#all').focus();
  else mobileMenu.focus();
}
$('#all').onclick = () => navigateDirection(null);
$('#add-root').onclick = () => categoryDialog();
$('#new-post').onclick = openPostDialog;
$('#close-dialog').onclick = $('#cancel-dialog').onclick = () => $('#dialog').close();
$('#search').oninput = event => {
  state.query = event.target.value.trim();
  if (state.post || state.missing) navigateDirection(state.selected);
  else renderContent();
};
mobileMenu.onclick = () => setSidebarOpen(!document.body.classList.contains('nav-open'));
$('#sidebar-backdrop').onclick = () => setSidebarOpen(false);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#dialog').open) setSidebarOpen(false);
});
$('#tree').onclick = async e => {
  const toggle = e.target.closest('[data-toggle]'); if (toggle) { const id = Number(toggle.dataset.toggle); state.collapsed.has(id) ? state.collapsed.delete(id) : state.collapsed.add(id); return renderTree(); }
  const category = e.target.closest('[data-category]');
  if (category && isOrdinaryLinkClick(e)) {
    e.preventDefault();
    return navigateDirection(Number(category.dataset.category));
  }
  const actions = e.target.closest('[data-actions]'); if (!actions) return;
  const id = Number(actions.dataset.actions), cat = state.categories.find(c => c.id === id);
  dialog(`管理「${cat.name}」`, `<div class="category-actions"><button type="button" id="add-child">＋ 新增子方向</button><button type="button" id="rename">✎ 重命名</button><button type="button" id="delete" class="danger">× 删除方向</button></div>`, async () => {});
  $('#submit-dialog').hidden = true;
  $('#add-child').onclick = () => { $('#dialog').close(); $('#submit-dialog').hidden = false; categoryDialog(id); };
  $('#rename').onclick = () => { $('#dialog').close(); $('#submit-dialog').hidden = false; dialog('重命名方向', `<label>方向名称<input name="name" maxlength="80" required value="${escapeHTML(cat.name)}"></label>`, async form => api(`/categories/${id}`, { method:'PATCH', body:{ name:form.get('name') } })); };
  $('#delete').onclick = async () => { if (!confirm(`确定删除「${cat.name}」？`)) return; try { await api(`/categories/${id}`, { method:'DELETE' }); $('#dialog').close(); $('#submit-dialog').hidden = false; if (state.selected === id) { state.selected = null; updatePageUrl(null, true); } await refresh(); } catch (error) { $('#dialog-error').textContent = error.message; } };
};
$('#dialog').addEventListener('close', () => { $('#submit-dialog').hidden = false; });
$('#content').onclick = async e => {
  const crumb = e.target.closest('[data-breadcrumb]');
  if (crumb) return navigateDirection(Number(crumb.dataset.breadcrumb) || null);
  const row = e.target.closest('[data-post]');
  if (row && isOrdinaryLinkClick(e)) {
    e.preventDefault();
    navigatePost(Number(row.dataset.post)).catch(error => notify(error.message));
  }
};

window.addEventListener('popstate', () => {
  if (leaveDocumentEditor && !leaveDocumentEditor()) return;
  restorePageFromUrl()?.catch(error => notify(error.message));
});
window.addEventListener('resize', scheduleBlueprintTrace);
refresh(true).catch(error => notify(`连接失败：${error.message}`));

const directionTree = $('#tree');
let directionDrag;
let savingDirection = false;

directionTree.addEventListener('pointerdown', event => {
  const grip = event.target.closest('[data-direction-grip]');
  if (!grip || event.button !== 0 || !event.isPrimary || directionDrag || savingDirection) return;
  const row = grip.closest('[data-direction-id]');
  const id = Number(row.dataset.directionId);
  directionDrag = {
    id, row, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
    blocked: descendants(id)
  };
  directionTree.setPointerCapture(event.pointerId);
  event.preventDefault();
});

function directionDropTarget(event, blocked) {
  const element = document.elementFromPoint(event.clientX, event.clientY);
  const root = element?.closest('[data-direction-root]');
  if (root) return { element: root, placement: 'root' };

  const row = element?.closest('[data-direction-id]');
  const targetId = Number(row?.dataset.directionId);
  if (!row || blocked.has(targetId)) return null;

  const rect = row.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / rect.height;
  const placement = ratio < 0.26 ? 'before' : ratio > 0.74 ? 'after' : 'inside';
  return { element: row, targetId, placement };
}

directionTree.addEventListener('pointermove', event => {
  const drag = directionDrag;
  if (drag?.pointerId !== event.pointerId) return;
  if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
  drag.active = true;
  directionTree.classList.add('direction-dragging');
  drag.row.classList.add('direction-drag-source');

  drag.target?.element.removeAttribute('data-drop-placement');
  drag.target = directionDropTarget(event, drag.blocked);
  if (drag.target) drag.target.element.dataset.dropPlacement = drag.target.placement;
});

function finishDirectionDrag(event, dropped = false) {
  const drag = directionDrag;
  if (!drag || (event && event.pointerId !== drag.pointerId)) return;
  const destination = dropped && drag.active && directionDropTarget(event, drag.blocked);
  directionDrag = null;
  directionTree.classList.remove('direction-dragging');
  drag.row.classList.remove('direction-drag-source');
  drag.target?.element.removeAttribute('data-drop-placement');
  if (directionTree.hasPointerCapture(drag.pointerId)) directionTree.releasePointerCapture(drag.pointerId);

  if (destination) saveDirectionPosition(drag.id, destination);
}

async function saveDirectionPosition(id, { targetId, placement }) {
  savingDirection = true;
  try {
    state.categories = await api(`/categories/${id}/position`, { method: 'PATCH', body: { targetId, placement } });
    if (placement === 'inside') state.collapsed.delete(targetId);
    renderTree();
  } catch (error) {
    notify(error.message);
  } finally {
    savingDirection = false;
  }
}

directionTree.addEventListener('pointerup', event => finishDirectionDrag(event, true));
directionTree.addEventListener('pointercancel', event => finishDirectionDrag(event));
directionTree.addEventListener('lostpointercapture', event => finishDirectionDrag(event));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') finishDirectionDrag();
});
