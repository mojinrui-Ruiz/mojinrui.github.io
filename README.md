# 莫晋睿 · 个人主页

| 文件 | 内容 |
| --- | --- |
| `data.js` | 网站上所有文字：自我介绍、经历、项目、数字、AI 分身的推荐问题 |
| `index.html` | 页面样式和交互，一般不用动 |
| `media/` | 图片和视频：项目视频、封面、校徽 |

## 改文字（在 GitHub 网页上直接改）

1. 打开仓库里的 `data.js`，点右上角铅笔图标（Edit this file）。
2. 用 Ctrl+F（Mac 是 Cmd+F）搜索要改的文字，直接改。
   只改引号 `" "` 里面的内容，不要删引号、逗号和括号。
3. 点右上角 **Commit changes** 保存。一两分钟后刷新网站就能看到。

## 加校徽

把两张校徽图片上传到 `media` 文件夹，文件名必须是：

- `logo-edinburgh.png`：爱丁堡大学
- `logo-uic.png`：UIC

上传方法：打开 `media` 文件夹，点 **Add file → Upload files**，拖进图片，再点 **Commit changes**。
建议用正方形、透明背景的 PNG。没上传时，网站显示 UoE / UIC 字样代替。

## 换视频或封面

同样上传到 `media`，用同一个文件名覆盖即可：`memory-tree.mp4`（视频）、`memory-tree.jpg`（封面）。

## 大改动

让 Claude 改好后重新打包，把新文件上传到仓库覆盖旧的。
