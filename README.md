# SkillHub

SkillHub 是一个支持多级方向、富文本文档和昵称评论的技能分享网站。

需要 Node.js 22.13 或更新版本。

```sh
npm ci
npm test
npm start
```

本地入口是 [http://localhost:3000/](http://localhost:3000/)。默认数据库位于 `data/skillhub.sqlite`。服务端可通过 `SKILLHUB_DB` 指定数据库文件，通过 `HOST` 和 `PORT` 指定监听地址。

如需使用云端数据，在本地项目根目录创建 `.env.local`，填入云端网站的完整地址和末尾的斜杠，然后运行 `npm start`。

```dotenv
HOST=127.0.0.1
SKILLHUB_API_ORIGIN=https://skillhub.129-80-166-116.sslip.io/
```

在此模式下，页面、样式和脚本使用本地代码。浏览、发帖、评论和目录操作使用同一套云端 API，因此本地改动数据会同步显示在云端网站上。云端部署可通过反向代理映射到子路径，代理应剥离路径前缀，并转发整个路径下的页面、静态资源和 API。
