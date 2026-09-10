# 投递手记

个人秋招投递管理网页。电脑和手机浏览器访问同一服务，手动维护公司与岗位、投递进度、测评和面试日程。

## 功能

- 一条记录对应一个公司岗位，支持新增、编辑、删除、搜索以及投递日期和阶段筛选。
- 列表 / 看板切换，统计已投递数量、各阶段数量、流程反馈率和 Offer 数量。
- 固定进度：已收藏、已投递、笔试、一面、二面、HR面、Offer、拒绝。可跳过阶段，历史记录可纠正。
- 每条投递可添加多个日程，支持编辑、完成、取消、恢复和删除。
- 首页提示未来 7 天和已逾期事项，仅站内提醒，不发送推送。
- 所有时间按北京时间输入和显示；服务器以 UTC 存储。
- 无密码、无登录、无注册，打开即用；服务端持久化和多端编辑冲突检测。

网站没有身份验证。部署到公网后，任何能访问网址的人都能查看和修改记录。页面请求保留跨站写入防护，但这不是访问控制。

## 技术结构

Node.js 24 + Express 5 + SQLite；前端为原生 JavaScript 模块和响应式 CSS，无单独构建步骤。仅一个运行服务和一个数据库，适合个人云服务器。

Node 24 的内置 `node:sqlite` 会打印实验性 API 提示，当前项目使用的基础接口已在本地验证；项目限定 Node 24 大版本，升级运行时后应先运行测试。

```text
public/          页面、交互与样式
server/          数据接口、校验与数据库
scripts/         数据库备份
tests/           接口和浏览器端验收测试
deploy/          Nginx HTTPS 反向代理示例
data/            本地数据库（不进入 Git）
REQUIREMENTS.md   已确认的第一版需求
```

## 本地运行

安装 Node.js 24 后，在项目目录执行：

```sh
npm ci
npm start
```

打开 http://127.0.0.1:3000，直接进入投递工作台。首次启动自动创建数据库，不需要初始化密码或配置外部数据库。

可复制 `.env.example` 为 `.env` 修改监听地址或端口。默认仅监听本机；局域网临时测试可将 `HOST` 设为 `0.0.0.0`，手机访问电脑的局域网 IP，需处于同一网络并允许对应端口。正式使用请按下文部署 HTTPS。

从有密码的旧版本更新时，直接重启服务即可。原有投递、流程历史和日程保持不变；旧密码文件和会话不再被使用，旧 `/login` 地址会跳转到首页。

## 云服务器部署（Docker Compose）

服务器需安装 Docker 和 Compose，并准备域名、HTTPS 证书及 Nginx。本项目不自动更改服务器现有配置。

```sh
git clone https://github.com/HY-L-723/Personal_Application_Tracking.git
cd Personal_Application_Tracking
docker compose build
docker compose up -d
```

首次启动自动创建数据库，保存在 `tracker-data` 命名卷，重新构建或重启容器后仍保留。不要使用 `docker compose down -v`，它会删除数据卷。

按 `deploy/nginx.conf.example` 配置反向代理，替换域名和证书路径，检查配置后重新加载 Nginx。Compose 仅将端口映射到服务器的 `127.0.0.1:3000`，外部通过 HTTPS 入口访问。

不使用 Docker 时，也可以在服务器安装 Node.js 24，用进程管理工具运行 `npm start`，配合同样的 HTTPS 反向代理。不需要密码或会话相关环境变量。

更新前先备份，再执行 `git pull`、`docker compose build` 和 `docker compose up -d`。部署环境尚未实测，需结合实际服务器校验端口、证书与文件权限。

## 备份和恢复

本地运行 `npm run backup`，通过 SQLite 在线备份接口将一致性快照保存到 `backups/`，无需停止服务。备份包含私人投递信息，应私下保管，不提交 GitHub。

Docker 部署执行 `docker compose exec tracker node scripts/backup.js`，输出备份文件名。可用 `docker compose cp tracker:/app/backups/文件名.db ./文件名.db` 复制到宿主机，再保存到可靠位置。

恢复时先停止服务，将当前完整数据库文件及同名 `-wal`、`-shm` 文件另存作为回退副本，再将备份放回 `data/tracker.db`（Docker 对应数据卷的 `/app/data/tracker.db`）。恢复时不要保留旧库的 WAL/SHM 文件。确保文件归属运行用户后重新启动，无需恢复任何密码配置。

## 验证

```sh
npm test
npm run check
npm run test:ui
```

接口测试使用独立数据库。浏览器测试默认调用已安装的 Google Chrome，在独立端口 3101 和 `.local/` 测试数据库中运行，覆盖桌面、手机尺寸及非中国时区，不接触个人使用数据库。不带 Chrome 的环境需先安装 Chrome，或调整 `playwright.config.js` 使用已安装的 Chromium。

## 统计与同步约定

- 填写了投递时间的记录才计入已投递数量；不自动推断空缺时间。
- 流程反馈率：已投递记录中，曾进入笔试 / 面试阶段，或当前为 Offer / 拒绝的记录占比，按记录去重；不等同于邮件回复率。
- Offer 数和阶段数量按当前阶段统计，首页统计不随列表筛选变化。
- 流程历史按发生时间及同时间下的录入顺序确定最新状态。记录时间和修订时间独立保留。
- 数据在页面加载、保存后和手动刷新时同步。不提供离线编辑或跨浏览器实时推送。

需求范围见 [REQUIREMENTS.md](REQUIREMENTS.md)。
