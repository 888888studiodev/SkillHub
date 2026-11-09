const state = { categories: [], posts: [], selected: null, post: null, query: '', collapsed: new Set() };
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
async function refresh() { [state.categories, state.posts] = await Promise.all([api('/categories'), api('/posts')]); renderTree(); renderContent(); }
function descendants(id) {
  const ids = new Set([id]); let changed = true;
  while (changed) { changed = false; for (const category of state.categories) if (ids.has(category.parent_id) && !ids.has(category.id)) { ids.add(category.id); changed = true; } }
  return ids;
}
function renderTree() {
  function branch(parent, depth) {
    return state.categories.filter(c => c.parent_id === parent).map(c => {
      const children = state.categories.some(item => item.parent_id === c.id);
      return `<div data-direction-id="${c.id}" class="tree-row ${state.selected === c.id ? 'active' : ''}" style="--depth:${depth}"><button class="toggle" data-toggle="${c.id}" aria-label="展开或收起">${children ? (state.collapsed.has(c.id) ? '›' : '⌄') : ''}</button><button class="tree-name" data-category="${c.id}"><span class="folder">▱</span><span>${escapeHTML(c.name)}</span></button><span class="direction-grip" data-direction-grip aria-hidden="true" title="拖动排序，或移入另一个方向">⠿</span><button class="dots" data-actions="${c.id}" aria-label="方向操作">···</button></div>${state.collapsed.has(c.id) ? '' : branch(c.id, depth + 1)}`;
    }).join('');
  }
  const rows = branch(null, 0);
  $('#tree').innerHTML = rows
    ? `${rows}<div class="direction-root-drop" data-direction-root>移到顶层末尾</div>`
    : '<p class="tree-empty">还没有方向，添加一个吧</p>';
  $('#all').classList.toggle('selected', state.selected === null && !state.post);
}
function renderContent() {
  if (state.post) return renderPost();
  const cat = state.categories.find(c => c.id === state.selected);
  const ids = cat ? descendants(cat.id) : null;
  const query = state.query.toLowerCase();
  const posts = state.posts.filter(p => (!ids || ids.has(p.category_id)) && `${p.title} ${p.content} ${p.author} ${p.category_name}`.toLowerCase().includes(query));
  $('#content').innerHTML = `<section class="page"><div class="crumb">⌂ <span>›</span> ${cat ? escapeHTML(cat.name) : '全部方向'}</div><div class="page-title"><div><div class="eyebrow">TEAM KNOWLEDGE SPACE</div><h1>${cat ? escapeHTML(cat.name) : '发现团队的好 Skill'}</h1><p>${cat ? '浏览这个方向下的分享与讨论' : '把发现的好工具收藏起来，一起交流使用心得。'}</p></div><button class="primary" id="list-new">＋ 分享 Skill</button></div><div class="list-header"><div><h2>${cat ? '这个方向的分享' : '最近分享'}</h2><p>每一个好发现，都值得被记录</p></div><span>${posts.length} 篇帖子</span></div>${posts.length ? `<div class="post-list">${posts.map(p => `<button class="post-row" data-post="${p.id}">${avatar(p.author)}<div class="post-main"><div class="post-title">${escapeHTML(p.title)}</div><p>${escapeHTML(p.content.slice(0, 100) || '包含图片或视频')}</p><div class="post-meta"><span>${escapeHTML(p.author)}</span><span>·</span><span>${escapeHTML(p.category_name)}</span><span>·</span><span>${date(p.created_at)}</span></div></div><span class="comment-count">♧ ${p.comment_count}</span><span class="row-arrow">›</span></button>`).join('')}</div>` : `<div class="empty"><div class="empty-icon">▤</div><h3>${query ? '没有找到相关内容' : '这里还没有分享'}</h3><p>${query ? '试试其他关键词' : '从一个好用的 Skill 开始，和团队分享你的发现。'}</p>${!query ? '<button class="secondary" id="empty-new">＋ 分享第一个 Skill</button>' : ''}</div>`}</section>`;
  $('#list-new').onclick = openPostDialog;
  if ($('#empty-new')) $('#empty-new').onclick = openPostDialog;
}
function renderPost() {
  const p = state.post;
  $('#content').innerHTML = `<article class="page detail"><div class="crumb"><button id="back">⌂ 全部方向</button><span>›</span><button id="back-category">${escapeHTML(p.category_name)}</button></div><div class="detail-title"><h1>${escapeHTML(p.title)}</h1><button class="secondary" id="edit-document">编辑文档</button></div><div class="author-line">${avatar(p.author)}<div><strong>${escapeHTML(p.author)}</strong><span>${date(p.created_at)}</span></div></div>${p.source ? `<div class="source">↗ <span>来源</span><a href="${escapeHTML(p.source)}" target="_blank" rel="noopener noreferrer">${escapeHTML(p.source)}</a></div>` : ''}<div id="post-document" class="post-body${p.document ? ' rich-document' : ''}">${p.document ? '' : escapeHTML(p.content)}</div><section class="comments"><div class="comment-heading"><h2>评论 <span>${p.comments.length}</span></h2><p>分享你的使用心得和想法</p></div>${p.comments.length ? p.comments.map(c => `<div class="comment">${avatar(c.author)}<div><div class="comment-meta"><strong>${escapeHTML(c.author)}</strong><time>${date(c.created_at)}</time></div><p>${escapeHTML(c.content)}</p></div></div>`).join('') : '<p class="no-comments">还没有评论，来分享第一个想法吧。</p>'}<form id="comment-form" class="comment-form"><label for="nickname">昵称</label><input id="nickname" name="author" maxlength="40" required placeholder="输入你的昵称" value="${escapeHTML(localStorage.getItem('skillhub-nickname') || '')}"><label for="comment">评论</label><textarea id="comment" name="content" maxlength="10000" required placeholder="写下你的评论..."></textarea><div class="form-bottom"><span>友善交流，分享你的真实体验</span><button class="primary">发表评论</button></div><p id="comment-error" class="error" role="alert"></p></form></section></article>`;
  if (p.document) renderDocument($('#post-document'), p.document);
  $('#edit-document').onclick = () => editSkill({
    id: p.id, title: p.title, categoryId: p.category_id,
    content: p.content, document: p.document
  });
  $('#back').onclick = () => { state.post = null; state.selected = null; renderTree(); renderContent(); };
  $('#back-category').onclick = () => { state.selected = p.category_id; state.post = null; renderTree(); renderContent(); };
  $('#comment-form').onsubmit = async e => { e.preventDefault(); const form = new FormData(e.target); try { await api(`/posts/${p.id}/comments`, { method:'POST', body: { author:form.get('author'), content:form.get('content') } }); localStorage.setItem('skillhub-nickname', form.get('author').trim()); state.post = await api(`/posts/${p.id}`); await refresh(); } catch (error) { $('#comment-error').textContent = error.message; } };
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
  `, form => {
    const categoryId = Number(form.get('categoryId'));
    const title = form.get('title').trim();
    const content = form.get('content').trim();
    if (!state.categories.some(category => category.id === categoryId)) throw new Error('请选择所属方向');
    if (!title || !content) throw new Error('请填写 Skill 名称和介绍');
    return { categoryId, title, content };
  }, '确认', editSkill);
  setupCategoryPicker($('#dialog-fields'), $('#submit-dialog'));
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
$('#all').onclick = () => {
  state.selected = null;
  state.post = null;
  setSidebarOpen(false);
  renderTree();
  renderContent();
};
$('#add-root').onclick = () => categoryDialog();
$('#new-post').onclick = openPostDialog;
$('#close-dialog').onclick = $('#cancel-dialog').onclick = () => $('#dialog').close();
$('#search').oninput = e => { state.query = e.target.value.trim(); state.post = null; renderContent(); };
mobileMenu.onclick = () => setSidebarOpen(!document.body.classList.contains('nav-open'));
$('#sidebar-backdrop').onclick = () => setSidebarOpen(false);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#dialog').open) setSidebarOpen(false);
});
$('#tree').onclick = async e => {
  const toggle = e.target.closest('[data-toggle]'); if (toggle) { const id = Number(toggle.dataset.toggle); state.collapsed.has(id) ? state.collapsed.delete(id) : state.collapsed.add(id); return renderTree(); }
  const category = e.target.closest('[data-category]'); if (category) { state.selected = Number(category.dataset.category); state.post = null; setSidebarOpen(false); renderTree(); return renderContent(); }
  const actions = e.target.closest('[data-actions]'); if (!actions) return;
  const id = Number(actions.dataset.actions), cat = state.categories.find(c => c.id === id);
  dialog(`管理「${cat.name}」`, `<div class="category-actions"><button type="button" id="add-child">＋ 新增子方向</button><button type="button" id="rename">✎ 重命名</button><button type="button" id="delete" class="danger">× 删除方向</button></div>`, async () => {});
  $('#submit-dialog').hidden = true;
  $('#add-child').onclick = () => { $('#dialog').close(); $('#submit-dialog').hidden = false; categoryDialog(id); };
  $('#rename').onclick = () => { $('#dialog').close(); $('#submit-dialog').hidden = false; dialog('重命名方向', `<label>方向名称<input name="name" maxlength="80" required value="${escapeHTML(cat.name)}"></label>`, async form => api(`/categories/${id}`, { method:'PATCH', body:{ name:form.get('name') } })); };
  $('#delete').onclick = async () => { if (!confirm(`确定删除「${cat.name}」？`)) return; try { await api(`/categories/${id}`, { method:'DELETE' }); $('#dialog').close(); $('#submit-dialog').hidden = false; if (state.selected === id) state.selected = null; await refresh(); } catch (error) { $('#dialog-error').textContent = error.message; } };
};
$('#dialog').addEventListener('close', () => { $('#submit-dialog').hidden = false; });
$('#content').onclick = async e => { const row = e.target.closest('[data-post]'); if (row) { try { state.post = await api(`/posts/${row.dataset.post}`); state.selected = state.post.category_id; renderTree(); renderContent(); } catch (error) { notify(error.message); } } };
refresh().catch(error => notify(`连接失败：${error.message}`));

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
