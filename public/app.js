const state = { categories: [], posts: [], selected: null, post: null, query: '', missing: false, collapsed: new Set() };
const pageBase = new URL('.', location.href);
let navigationRequest = 0;
const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const date = value => new Date(value.replace(' ', 'T') + 'Z').toLocaleString('zh-CN', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
const avatar = name => `<span class="avatar">${escapeHTML(name.slice(0, 1))}</span>`;
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
      return `<div data-direction-id="${c.id}" class="tree-row ${state.selected === c.id ? 'active' : ''}" style="--depth:${depth}"><button class="toggle" data-toggle="${c.id}" aria-label="展开或收起">${children ? (state.collapsed.has(c.id) ? '›' : '⌄') : ''}</button><a class="tree-name" data-category="${c.id}" href="${escapeHTML(pagePath(c.slug))}"><span class="folder">▱</span><span>${escapeHTML(c.name)}</span></a><span class="direction-grip" data-direction-grip aria-hidden="true" title="拖动排序，或移入另一个方向">⠿</span><button class="dots" data-actions="${c.id}" aria-label="方向操作">···</button></div>${state.collapsed.has(c.id) ? '' : branch(c.id, depth + 1)}`;
    }).join('');
  }
  const rows = branch(null, 0);
  $('#tree').innerHTML = rows
    ? `${rows}<div class="direction-root-drop" data-direction-root>移到顶层末尾</div>`
    : '<p class="tree-empty">还没有方向，添加一个吧</p>';
  $('#all').classList.toggle('selected', state.selected === null && !state.post && !state.missing);
}
function breadcrumbs(categoryId, title) {
  const path = [];
  for (let id = categoryId; id != null;) {
    const category = state.categories.find(item => item.id === id);
    if (!category) break;
    path.unshift(category);
    id = category.parent_id;
  }
  const home = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.8 1.5 12h3v9h5v-6h5v6h5v-9h3L12 2.8Z"/></svg>';
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
        <button class="primary" id="list-new">＋ 分享 Skill</button>
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
          ${avatar(p.author)}
          <div class="post-main">
            <div class="post-title">${escapeHTML(p.title)}</div>
            <p>${escapeHTML(p.content.slice(0, 100) || '包含图片或视频')}</p>
            <div class="post-meta"><span>${escapeHTML(p.author)}</span><span>·</span><span>${escapeHTML(p.category_name)}</span><span>·</span><span>${date(p.created_at)}</span></div>
          </div>
          <span class="comment-count">♧ ${p.comment_count}</span><span class="row-arrow">›</span>
        </a>`).join('')}</div>` : `
        <div class="empty">
          <div class="empty-icon">▤</div>
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
  $('#content').innerHTML = `<article class="page detail">${breadcrumbs(p.category_id, p.title)}<div class="detail-title"><h1>${escapeHTML(p.title)}</h1><button class="secondary" id="edit-document">编辑文档</button></div><div class="author-line">${avatar(p.author)}<div><strong>${escapeHTML(p.author)}</strong><span>${date(p.created_at)}</span></div></div>${p.source ? `<div class="source">↗ <span>来源</span><a href="${escapeHTML(p.source)}" target="_blank" rel="noopener noreferrer">${escapeHTML(p.source)}</a></div>` : ''}<div id="post-document" class="post-body${p.document ? ' rich-document' : ''}">${p.document ? '' : escapeHTML(p.content)}</div><section class="comments"><div class="comment-heading"><h2>评论 <span>${p.comments.length}</span></h2><p>分享你的使用心得和想法</p></div>${p.comments.length ? p.comments.map(c => `<div class="comment">${avatar(c.author)}<div><div class="comment-meta"><strong>${escapeHTML(c.author)}</strong><time>${date(c.created_at)}</time></div><p>${escapeHTML(c.content)}</p></div></div>`).join('') : '<p class="no-comments">还没有评论，来分享第一个想法吧。</p>'}<form id="comment-form" class="comment-form">${namePickerFields()}<label for="comment">评论</label><textarea id="comment" name="content" maxlength="10000" required placeholder="写下你的评论..."></textarea><div class="form-bottom"><span>友善交流，分享你的真实体验</span><button class="primary">发表评论</button></div><p id="comment-error" class="error" role="alert"></p></form></section></article>`;
  if (p.document) renderDocument($('#post-document'), p.document);
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
    `<option value="${escapeHTML(name)}"${name === selected ? ' selected' : ''}>${escapeHTML(name)}</option>`).join('');
}

function namePickerFields(label = '名称', selected) {
  return `<div class="name-picker">
    <label>${label}<select name="author" required>${nameOptions(selected)}</select></label>
    <button type="button" class="secondary" data-add-name>＋ 新建名称</button>
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
  const add = picker.querySelector('[data-add-name]');
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
    close();
  }
  select.onchange = () => rememberName(select.value);
  add.onclick = () => { panel.hidden = false; input.focus(); };
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
