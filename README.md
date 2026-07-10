# Freelab 自媒体分享会网站

这是一个可直接部署到 GitHub Pages 的静态网站。

## 本地预览

直接打开 `index.html` 即可；如果希望用本地服务预览：

```bash
python3 -m http.server 8080
```

然后访问 `http://localhost:8080`。

## 文本编辑模式

- 在页面按 `e`，输入编辑口令后进入文本编辑模式。
- 默认编辑口令：`252515`
- 修改文字后会自动保存到当前浏览器的 `localStorage`，刷新页面后仍会保留。
- 工具条里的「恢复原文」会清除当前浏览器保存的修改，回到 HTML 文件里的原始文字。
- 这是静态网站里的前端保护，适合防止访客误触。若要让线上内容只能由你真正发布修改，需要接入带登录权限的后台、CMS 或 GitHub 部署流程。

## GitHub Pages 部署

1. 新建一个 GitHub 仓库。
2. 上传本目录全部文件，包括 `index.html`、`styles.css`、`script.js` 和 `assets/`。
3. 在仓库 `Settings -> Pages` 中选择 `Deploy from a branch`。
4. Branch 选择 `main`，目录选择 `/root`，保存后等待 Pages 生成链接。

## 内容说明

- 原稿标题层级已保留为页面中的 `h1`、`h3`、`h5`。
- 正文已做概括精简，没有整段照搬原稿。
- `【case】` 对应内容已替换为图片画廊和可点击预览。
