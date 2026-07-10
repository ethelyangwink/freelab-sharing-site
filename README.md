# Freelab 自媒体分享会网站

这是一个可直接部署到 GitHub Pages 的静态网站。

## 本地预览

直接打开 `index.html` 即可；如果希望用本地服务预览：

```bash
python3 -m http.server 8080
```

然后访问 `http://localhost:8080`。

如果要在页面里编辑文字，并希望修改写回本地源码，使用专门的编辑服务：

```bash
node tools/editor-server.mjs
```

然后访问 `http://localhost:8080`。

## 文本编辑模式

- 在页面按 `e`，输入编辑口令后进入文本编辑模式。
- 默认编辑口令：`252515`
- 修改文字时，页面会先自动记到当前浏览器。
- 「暂存」会确认当前修改已经先放到浏览器，适合中途暂停。
- 通过 `node tools/editor-server.mjs` 打开页面时，「保存并备份」会同时保存到 `page-backups/text-edits.json`，并同步写回 `index.html`。
- 在 GitHub Pages 线上页面编辑时，要把修改留到本机，使用工具条里的「保存并备份」或「导出备份」。
- 「保存并备份」适合 Chrome / Edge：第一次点击时选择本地 `text-edits.json`，之后再次点击会直接写入这个文件，并退出编辑模式。
- 「导出备份」适合所有浏览器：点击后下载 `text-edits.json`，后续可以用同步脚本把它写回 `index.html`。
- 如果改过文字后没有点「暂存」「保存并备份」或「导出备份」，退出编辑模式或关闭网页时会弹窗提醒。
- 工具条里的「恢复原文」会清除当前浏览器保存的修改，回到 HTML 文件里的原始文字。
- 这是静态网站里的前端保护，适合防止访客误触。若要让线上内容只能由你真正发布修改，需要接入带登录权限的后台、CMS 或 GitHub 部署流程。

## 改排版前同步文字

如果上一次是在页面里改过文字，这次准备改 CSS、排版或图片位置，先执行：

```bash
node tools/sync-text-edits.mjs
```

这个命令会把 `page-backups/text-edits.json` 里的最新文字同步进 `index.html`。之后再改 `styles.css` 或页面结构，就会基于最新文本继续改。

如果备份来自 GitHub Pages 页面导出的下载文件，也可以直接指定文件路径：

```bash
node tools/sync-text-edits.mjs ~/Downloads/text-edits.json
```

更推荐把线上页面绑定到本项目的 `page-backups/text-edits.json`。这样线上页面保存后，本地改排版前只需要执行默认同步命令。

## GitHub Pages 部署

1. 新建一个 GitHub 仓库。
2. 上传本目录全部文件，包括 `index.html`、`styles.css`、`script.js` 和 `assets/`。
3. 在仓库 `Settings -> Pages` 中选择 `Deploy from a branch`。
4. Branch 选择 `main`，目录选择 `/root`，保存后等待 Pages 生成链接。

## 内容说明

- 原稿标题层级已保留为页面中的 `h1`、`h3`、`h5`。
- 正文已做概括精简，没有整段照搬原稿。
- `【case】` 对应内容已替换为图片画廊和可点击预览。
