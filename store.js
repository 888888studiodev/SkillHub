const { DatabaseSync } = require('node:sqlite');
const { prepareDocument } = require('./document');

function required(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${label}不能为空或过长`);
  return value.trim();
}
function createStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, parent_id INTEGER REFERENCES categories(id));
    CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES categories(id), title TEXT NOT NULL, author TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES posts(id), author TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('PRAGMA table_info(posts)').all().some(column => column.name === 'document')) {
      db.exec('ALTER TABLE posts ADD COLUMN document TEXT');
    }
    if (!db.prepare('PRAGMA table_info(categories)').all().some(column => column.name === 'position')) {
      db.exec('ALTER TABLE categories ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const getCategory = db.prepare('SELECT * FROM categories WHERE id=?');
  const listCategories = db.prepare('SELECT * FROM categories ORDER BY position, id');
  const listSiblings = db.prepare('SELECT id FROM categories WHERE parent_id IS ? AND id != ? ORDER BY position, id');
  const setCategoryPosition = db.prepare('UPDATE categories SET parent_id=?, position=? WHERE id=?');

  return {
    categories: () => listCategories.all(),
    createCategory(name, parentId) {
      name = required(name, '方向名称', 80);
      parentId = parentId || null;
      const result = db.prepare(`
        INSERT INTO categories (name, parent_id, position)
        SELECT ?, ?, COALESCE(MAX(position) + 1, 0)
        FROM categories WHERE parent_id IS ?
      `).run(name, parentId, parentId);
      return getCategory.get(result.lastInsertRowid);
    },
    renameCategory(id, name) {
      const result = db.prepare('UPDATE categories SET name=? WHERE id=?').run(required(name, '方向名称', 80), id);
      if (!result.changes) throw new Error('方向不存在');
    },
    moveCategory(id, { targetId, placement }) {
      if (!['before', 'after', 'inside', 'root'].includes(placement)) throw new Error('移动位置无效');

      db.exec('BEGIN IMMEDIATE');
      try {
        if (!getCategory.get(id)) throw new Error('方向不存在');
        const target = placement === 'root' ? null : getCategory.get(targetId);
        if (placement !== 'root' && !target) throw new Error('目标方向不存在');
        if (target?.id === id) throw new Error('不能移动到自身');
        const parentId = placement === 'inside' ? target.id : target?.parent_id ?? null;
        for (let parent = parentId; parent !== null; parent = getCategory.get(parent).parent_id) {
          if (parent === id) throw new Error('不能移动到自己的子方向');
        }

        const siblings = listSiblings.all(parentId, id).map(category => category.id);
        let index = siblings.length;
        if (placement === 'before' || placement === 'after') {
          index = siblings.indexOf(target.id) + (placement === 'after' ? 1 : 0);
        }
        siblings.splice(index, 0, id);
        siblings.forEach((siblingId, position) => setCategoryPosition.run(parentId, position, siblingId));
        const categories = listCategories.all();
        db.exec('COMMIT');
        return categories;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    deleteCategory(id) {
      if (db.prepare('SELECT 1 FROM categories WHERE parent_id=?').get(id) || db.prepare('SELECT 1 FROM posts WHERE category_id=?').get(id)) throw new Error('请先移走或删除该方向下的子方向和帖子');
      if (!db.prepare('DELETE FROM categories WHERE id=?').run(id).changes) throw new Error('方向不存在');
    },
    posts: () => db.prepare('SELECT posts.id, posts.category_id, posts.title, posts.author, posts.source, posts.content, posts.created_at, categories.name AS category_name, (SELECT count(*) FROM comments WHERE post_id=posts.id) AS comment_count FROM posts JOIN categories ON categories.id=posts.category_id ORDER BY posts.id DESC').all(),
    createPost(data) {
      const title = required(data.title, '标题', 160);
      const rich = data.document !== undefined;
      const author = rich && data.author === undefined ? '团队成员' : required(data.author, '昵称', 40);
      const { content, encoded } = rich
        ? prepareDocument(data.document)
        : { content: required(data.content, '内容', 20000), encoded: null };
      const source = typeof data.source === 'string' ? data.source.trim() : '';
      if (source) { const url = new URL(source); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('请输入有效的网址'); }
      const result = db.prepare('INSERT INTO posts(category_id,title,author,source,content,document) VALUES (?,?,?,?,?,?)').run(data.categoryId, title, author, source, content, encoded);
      return { id: Number(result.lastInsertRowid) };
    },
    updatePostDocument(id, document, { title, categoryId } = {}) {
      const { content, encoded } = prepareDocument(document);
      const newTitle = title === undefined ? null : required(title, '标题', 160);
      if (categoryId !== undefined && (!Number.isSafeInteger(categoryId) || categoryId < 1)) {
        throw new Error('所选方向不存在');
      }
      const result = db.prepare(`
        UPDATE posts SET content=?, document=?,
          title=COALESCE(?, title), category_id=COALESCE(?, category_id)
        WHERE id=?
      `).run(content, encoded, newTitle, categoryId ?? null, id);
      return Boolean(result.changes);
    },
    getPost(id) {
      const post = db.prepare('SELECT posts.*, categories.name AS category_name FROM posts JOIN categories ON categories.id=posts.category_id WHERE posts.id=?').get(id);
      if (!post) return null;
      return { ...post, document: post.document && JSON.parse(post.document), comments: db.prepare('SELECT * FROM comments WHERE post_id=? ORDER BY id').all(id) };
    },
    createComment(postId, author, content) {
      const result = db.prepare('INSERT INTO comments(post_id,author,content) VALUES (?,?,?)').run(postId, required(author, '昵称', 40), required(content, '评论', 10000));
      return { id: Number(result.lastInsertRowid) };
    },
    close: () => db.close()
  };
}
module.exports = { createStore };
