const fontSizes = ['small', 'large', 'huge'];
const fonts = ['serif', 'monospace'];
const allowedStyles = {
  bold: [true],
  italic: [true],
  underline: [true],
  strike: [true],
  font: fonts,
  size: fontSizes,
  header: [1, 2, 3, 4, 5, 6],
  list: ['ordered', 'bullet'],
  blockquote: [true],
  'code-block': [true, 'plain']
};

function webUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url;
  } catch {
    return null;
  }
  return null;
}

function isImage(value) {
  return Boolean(webUrl(value)) || (
    typeof value === 'string' && value.length <= 2_800_000 &&
    /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}

function isVideoEmbed(value) {
  const url = webUrl(value);
  return url?.origin === 'https://www.youtube-nocookie.com' && /^\/embed\/[\w-]{11}$/.test(url.pathname);
}

function prepareDocument(document) {
  if (!Array.isArray(document?.ops) || document.ops.length > 20000) {
    throw new Error('文档格式无效');
  }

  let textLength = 0;
  let mediaCount = 0;
  const text = [];
  const ops = document.ops.map(op => {
    const insert = op?.insert;
    if (typeof insert === 'string' && insert) {
      textLength += insert.length;
      text.push(insert);
    } else if (insert && typeof insert === 'object' && Object.keys(insert).length === 1) {
      const [type, value] = Object.entries(insert)[0];
      const valid = (type === 'image' && isImage(value)) ||
        (type === 'video' && isVideoEmbed(value)) ||
        (type === 'native-video' && webUrl(value));
      if (!valid) throw new Error('图片或视频地址无效');
      mediaCount += 1;
    } else {
      throw new Error('文档内容无效');
    }

    const attributes = {};
    for (const [key, value] of Object.entries(op.attributes ?? {})) {
      if (key === 'link' && !webUrl(value)) throw new Error('请输入有效的链接');
      if (key !== 'link' && !allowedStyles[key]?.includes(value)) throw new Error('文档包含不支持的格式');
      attributes[key] = value;
    }
    return Object.keys(attributes).length ? { insert, attributes } : { insert };
  });
  if (textLength > 20000) throw new Error('正文最多 20,000 个字符');
  const content = text.join('').trim();
  if (!content && !mediaCount) throw new Error('请填写正文或插入媒体');

  const encoded = JSON.stringify({ ops });
  if (Buffer.byteLength(encoded) > 9_000_000) throw new Error('文档过大，请缩小图片或使用图片链接');
  return { content, encoded };
}

module.exports = { prepareDocument };
