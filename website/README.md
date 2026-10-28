# WorkPlan Cloud 官网

纯静态站点，无需构建。

## 本地预览

```bash
cd website
python -m http.server 4180
```

打开 `http://127.0.0.1:4180/`。

## 部署

将 `website/` 目录整体发布到任意静态托管即可（GitHub Pages、Cloudflare Pages、Vercel、Nginx）。

GitHub Pages 示例：

1. 在仓库 Settings → Pages 选择 “Deploy from a branch”。
2. 分支选择 `main`，目录选择 `/website`（如平台支持子目录发布）。
3. 或把 `website/` 内容复制到 Pages 专用分支的根目录。

下载按钮指向 GitHub Releases，Web / 源码按钮指向仓库；如果实际 Web 版部署地址不同，修改 `index.html` 中 `#download` 区块的链接即可。
