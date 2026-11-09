const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../store');
test('categories, posts and comments persist and protect nonempty folders', () => {
  const store = createStore(':memory:');
  const root = store.createCategory('设计', null);
  const child = store.createCategory('UI设计', root.id);
  const post = store.createPost({ categoryId: child.id, title: '测试 Skill', author: '小林', source: 'https://example.com', content: '介绍' });
  store.createComment(post.id, '小陈', '很好用');
  assert.equal(store.getPost(post.id).comments[0].author, '小陈');
  assert.throws(() => store.deleteCategory(root.id));
  assert.throws(() => store.deleteCategory(child.id));
  assert.throws(() => store.createComment(post.id, '', '内容'));
  store.close();
});

test('rich documents are saved and updated without losing existing comments', () => {
  const store = createStore(':memory:');
  const category = store.createCategory('开发', null);
  const legacy = store.createPost({ categoryId: category.id, title: '旧帖', author: '小林', content: '原有正文' });
  store.createComment(legacy.id, '小陈', '有用');
  const document = { ops: [
    { insert: '使用方法' }, { insert: '\n', attributes: { header: 2 } },
    { insert: '文档', attributes: { link: 'https://example.com' } }, { insert: '\n' },
    { insert: { image: 'https://example.com/cover.png' } }, { insert: '\n' },
    { insert: { 'native-video': 'https://example.com/demo.mp4' } }, { insert: '\n' },
    { insert: 'npm test' }, { insert: '\n', attributes: { 'code-block': 'plain' } }
  ] };
  const post = store.createPost({ categoryId: category.id, title: '新帖', document });
  assert.deepEqual(store.getPost(post.id).document, document);
  assert.match(store.posts().find(item => item.id === post.id).content, /使用方法/);
  store.updatePostDocument(legacy.id, document);
  assert.deepEqual(store.getPost(legacy.id).document, document);
  assert.equal(store.getPost(legacy.id).author, '小林');
  assert.equal(store.getPost(legacy.id).comments[0].content, '有用');
  assert.throws(() => store.updatePostDocument(post.id, { ops: [{ insert: '恶意链接', attributes: { link: 'javascript:alert(1)' } }] }), /链接/);
  assert.deepEqual(store.getPost(post.id).document, document);
  store.close();
});

test('moving a direction changes its sibling order or parent and rejects cycles', () => {
  const store = createStore(':memory:');
  const first = store.createCategory('设计', null);
  const second = store.createCategory('开发', null);
  const child = store.createCategory('界面', first.id);
  const leaf = store.createCategory('组件', child.id);
  const children = parentId => store.categories().filter(item => item.parent_id === parentId).map(item => item.id);

  store.moveCategory(second.id, { targetId: first.id, placement: 'before' });
  assert.deepEqual(children(null), [second.id, first.id]);
  store.moveCategory(child.id, { targetId: second.id, placement: 'inside' });
  assert.deepEqual(children(first.id), []);
  assert.deepEqual(children(second.id), [child.id]);
  assert.deepEqual(children(child.id), [leaf.id]);
  assert.throws(() => store.moveCategory(second.id, { targetId: leaf.id, placement: 'inside' }), /子方向/);
  assert.deepEqual(children(second.id), [child.id]);
  store.moveCategory(child.id, { targetId: second.id, placement: 'after' });
  const added = store.createCategory('测试', null);
  assert.deepEqual(children(null), [second.id, child.id, first.id, added.id]);
  store.close();
});

test('editing a post changes title and category atomically while retaining its comments', () => {
  const store = createStore(':memory:');
  const root = store.createCategory('开发', null);
  const child = store.createCategory('前端', root.id);
  const document = { ops: [{ insert: '说明\n' }] };
  const post = store.createPost({ categoryId: root.id, title: '原名', document });
  store.createComment(post.id, '小林', '有用');
  store.updatePostDocument(post.id, document, { title: '新名', categoryId: child.id });

  const saved = store.getPost(post.id);
  assert.equal(saved.title, '新名');
  assert.equal(saved.category_id, child.id);
  assert.equal(saved.comments[0].content, '有用');
  assert.throws(() => store.updatePostDocument(post.id, document, { title: '不应保存', categoryId: 999 }));
  assert.equal(store.getPost(post.id).title, '新名');
  store.close();
});
