const editorFormats = [
  'font', 'size', 'header', 'bold', 'italic', 'underline', 'strike', 'list',
  'blockquote', 'code-block', 'link', 'image', 'video', 'native-video'
];

class NativeVideo extends Quill.import('blots/block/embed') {
  static blotName = 'native-video';
  static tagName = 'VIDEO';

  static create(url) {
    const node = super.create();
    node.src = url;
    node.controls = true;
    node.preload = 'none';
    return node;
  }

  static value(node) {
    return node.getAttribute('src');
  }
}

class EmbeddedVideo extends Quill.import('formats/video') {
  static create(url) {
    const node = super.create(url);
    node.title = '视频';
    node.loading = 'lazy';
    node.referrerPolicy = 'strict-origin-when-cross-origin';
    node.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    return node;
  }
}
Quill.register(NativeVideo);
Quill.register(EmbeddedVideo, true);

function renderDocument(element, document) {
  const reader = new Quill(element, { readOnly: true, formats: editorFormats, modules: { toolbar: false } });
  reader.setContents(document);
}

function editorUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入有效的网址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) {
    throw new Error('请输入有效的 HTTP 或 HTTPS 网址');
  }
  return url;
}

function videoInsert(url) {
  const host = url.hostname.replace(/^www\./, '');
  let id;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) {
    id = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1];
  } else {
    return { type: 'native-video', value: url.href };
  }
  if (!/^[\w-]{11}$/.test(id || '')) throw new Error('请输入有效的 YouTube 视频链接');
  return { type: 'video', value: `https://www.youtube-nocookie.com/embed/${id}` };
}

function readImage(file) {
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) || file.size > 2_000_000) {
    throw new Error('请选择不超过 2 MB 的 PNG、JPG、GIF 或 WebP 图片');
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('无法读取图片'));
    reader.readAsDataURL(file);
  });
}

function insertDocumentItem(editor, type) {
  let range = editor.getSelection(true) || { index: editor.getLength() - 1, length: 0 };
  if (editor.getFormat(range.index, 0)['code-block']) {
    // Code blocks only hold text. Insert rich content after the entire block.
    const [line] = editor.getLine(range.index);
    range = { index: editor.getIndex(line.parent) + line.parent.length(), length: 0 };
  }
  const label = { image: '图片', video: '视频', link: '链接' }[type];
  const upload = type === 'image' ? '<label>上传图片<input type="file" name="file" accept="image/png,image/jpeg,image/gif,image/webp"></label><p class="editor-hint">可以上传不超过 2 MB 的图片，或填写图片链接。</p>' : '';
  const hint = type === 'video' ? '<p class="editor-hint">支持 YouTube 链接和可直接播放的视频地址，例如 MP4。</p>' : '';
  dialog(`插入${label}`, `${upload}<label>${label}地址<input name="url" type="url" placeholder="https://..." ${type === 'image' ? '' : 'required'}></label>${hint}`, async form => {
    const file = form.get('file');
    if (type === 'image' && file?.size) {
      editor.insertEmbed(range.index, 'image', await readImage(file), 'user');
      editor.setSelection(range.index + 1, 0, 'silent');
      return;
    }

    const url = editorUrl(form.get('url'));
    if (type === 'link') {
      if (range.length) editor.formatText(range.index, range.length, 'link', url.href, 'user');
      else editor.insertText(range.index, url.href, 'link', url.href, 'user');
    } else {
      const embed = type === 'video' ? videoInsert(url) : { type: 'image', value: url.href };
      editor.insertEmbed(range.index, embed.type, embed.value, 'user');
      editor.setSelection(range.index + 1, 0, 'silent');
    }
  }, '插入', () => editor.focus());
}

let leaveDocumentEditor;

function openDocumentEditor(draft, save) {
  const originalUrl = location.href;
  const layout = $('.layout');
  const workspace = $('#document-workspace');
  layout.hidden = true;
  workspace.hidden = false;
  workspace.innerHTML = `
    <header class="editor-header">
      <div id="editor-path"></div>
      <div class="editor-actions">
        <button type="button" class="secondary" id="editor-cancel">取消</button>
        <button type="button" class="primary" id="editor-save">${draft.id ? '保存更改' : '保存并发布'}</button>
      </div>
    </header>
    <div class="editor-shell">
      <div class="editor-properties">
        <label class="editor-title-field">Skill 名称<input name="title" maxlength="160" required value="${escapeHTML(draft.title)}"></label>
        <div class="editor-category-picker">${categoryPickerFields(draft.categoryId)}</div>
        ${draft.id ? '' : namePickerFields('发布人', draft.author)}
      </div>
      <div id="document-toolbar" aria-label="文档格式">
        <span class="ql-formats">
          <select class="ql-header" aria-label="标题级别">
            <option selected>正文</option>
            ${[1, 2, 3, 4, 5, 6].map(level => `<option value="${level}">标题 ${level}</option>`).join('')}
          </select>
          <select class="ql-font" aria-label="字体"><option selected>默认字体</option><option value="serif">衬线字体</option><option value="monospace">等宽字体</option></select>
          <select class="ql-size" aria-label="字号"><option value="small">小</option><option selected>正常</option><option value="large">大</option><option value="huge">特大</option></select>
        </span>
        <span class="ql-formats">
          <button type="button" class="ql-bold" aria-label="加粗"></button>
          <button type="button" class="ql-italic" aria-label="斜体"></button>
          <button type="button" class="ql-underline" aria-label="下划线"></button>
          <button type="button" class="ql-strike" aria-label="删除线"></button>
        </span>
        <span class="ql-formats">
          <button type="button" class="ql-list" value="ordered" aria-label="编号列表"></button>
          <button type="button" class="ql-list" value="bullet" aria-label="项目列表"></button>
          <button type="button" class="ql-blockquote" aria-label="引用"></button>
          <button type="button" class="ql-code-block" aria-label="代码块"></button>
        </span>
        <span class="ql-formats">
          <button type="button" class="ql-link" aria-label="插入链接"></button>
          <button type="button" class="ql-image" aria-label="插入图片"></button>
          <button type="button" class="ql-video" aria-label="插入视频"></button>
          <button type="button" class="ql-clean" aria-label="清除格式"></button>
        </span>
      </div>
      <div id="document-body"></div>
      <p id="editor-error" class="error" role="alert"></p>
    </div>`;

  const editor = new Quill('#document-body', {
    theme: 'snow',
    placeholder: '写下这个 Skill 的介绍、示例和使用方法…',
    formats: editorFormats,
    modules: {
      toolbar: {
        container: '#document-toolbar',
        handlers: {
          image: () => insertDocumentItem(editor, 'image'),
          video: () => insertDocumentItem(editor, 'video'),
          link: () => insertDocumentItem(editor, 'link')
        }
      }
    }
  });
  editor.root.setAttribute('aria-label', 'Skill 正文');
  for (const [format, label] of Object.entries({ header: '标题级别', font: '字体', size: '字号' })) {
    $(`#document-toolbar .ql-${format}.ql-picker .ql-picker-label`).setAttribute('aria-label', label);
  }
  for (const control of workspace.querySelectorAll('#document-toolbar button[aria-label], #document-toolbar .ql-picker-label[aria-label]')) {
    control.dataset.tooltip = control.getAttribute('aria-label');
  }
  if (draft.document) editor.setContents(draft.document);
  else editor.setText(draft.content);
  editor.history.clear();
  editor.setSelection(0, 0, 'silent');

  let dirty = false;
  const warnOnExit = event => {
    if (dirty) event.preventDefault();
  };
  window.addEventListener('beforeunload', warnOnExit);
  editor.on('text-change', (_delta, _previous, source) => {
    if (source === 'user') dirty = true;
  });

  const cancel = $('#editor-cancel');
  const saveButton = $('#editor-save');
  const error = $('#editor-error');
  const titleField = workspace.querySelector('input[name="title"]');
  const categoryField = workspace.querySelector('select[name="categoryId"]');
  setupCategoryPicker($('.editor-category-picker'), saveButton);
  const authorField = draft.id ? null : setupNamePicker(workspace.querySelector('.name-picker'));
  const editorPath = $('#editor-path');
  const showPath = () => {
    editorPath.innerHTML = breadcrumbs(Number(categoryField.value), titleField.value.trim() || '编辑 Skill');
  };
  const updatePath = () => {
    dirty = true;
    showPath();
  };
  showPath();
  titleField.addEventListener('input', updatePath);
  categoryField.addEventListener('change', updatePath);

  function closeEditor() {
    leaveDocumentEditor = null;
    window.removeEventListener('beforeunload', warnOnExit);
    workspace.hidden = true;
    workspace.replaceChildren();
    layout.hidden = false;
  }

  const canLeaveEditor = () => !cancel.disabled && (!dirty || confirm('放弃本次编辑？'));
  leaveDocumentEditor = () => {
    if (!canLeaveEditor()) {
      history.pushState(null, '', originalUrl);
      return false;
    }
    closeEditor();
    return true;
  };
  cancel.onclick = () => {
    if (canLeaveEditor()) closeEditor();
  };
  editorPath.onclick = event => {
    const crumb = event.target.closest('[data-breadcrumb]');
    if (!crumb || !canLeaveEditor()) return;
    closeEditor();
    navigateDirection(Number(crumb.dataset.breadcrumb) || null);
  };
  saveButton.onclick = async () => {
    const title = titleField.value.trim();
    const categoryId = Number(categoryField.value);
    if (!title || !categoryId) {
      error.textContent = !title ? '请填写 Skill 名称' : '请选择所属方向';
      (title ? categoryField : titleField).focus();
      return;
    }
    if (authorField && !authorField.reportValidity()) return;
    cancel.disabled = saveButton.disabled = true;
    error.textContent = '';
    try {
      const post = { title, categoryId, document: editor.getContents() };
      if (authorField) post.author = authorField.value;
      await save(post);
      closeEditor();
    } catch (failure) {
      error.textContent = failure.message;
      cancel.disabled = saveButton.disabled = false;
    }
  };
}
