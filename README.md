# 投递手记

个人秋招投递管理网页。电脑和手机浏览器访问同一服务，手动维护公司与岗位、投递进度、测评和面试日程。

## 功能

- 一条记录对应一个公司岗位，支持新增、编辑、删除、搜索以及投递日期和阶段筛选。
- 列表 / 看板切换，统计已投递数量、各阶段数量、流程反馈率和 Offer 数量。
- 固定进度：已收藏、已投递、笔试、一面、二面、HR面、Offer、拒绝。可跳过阶段，历史记录可纠正。
- 每条投递可添加多个日程，支持编辑、完成、取消、恢复和删除。
- 首页提示未来 7 天和已逾期事项，仅站内提醒，不发送推送。
- 所有时间按北京时间输入和显示；服务器以 UTC 存储。
- 个人密码登录，无注册；服务端持久化、会话过期、登录限流、CSRF 验证和多端编辑冲突检测。

## 技术结构

Node.js 24 + Express 5 + SQLite；前端为原生 JavaScript 模块和响应式 CSS，无单独构建步骤。仅一个运行服务和一个数据库，适合个人云服务器。

Node 24 的内置 `node:sqlite` 会打印实验性 API 提示，当前项目使用的基础接口已在本地验证；项目限定 Node 24 大版本，升级运行时后应先运行测试。

```text
public/          页面、交互与样式
server/          登录、数据接口、校验与数据库
scripts/         密码设置和数据库备份
tests/           接口和浏览器端验收测试
deploy/          Nginx HTTPS 反向代理示例
data/            本地密码哈希和数据库（不进入 Git）
REQUIREMENTS.md   已确认的第一版需求
```

## 本地运行

安装 Node.js 24 后，在项目目录执行：

```sh
npm ci
npm run setup
npm start
```

打开 http://127.0.0.1:3000，输入设置的密码。密码至少 10 个字符，设置时不回显。不需要配置外部数据库。

也可运行 `npm run setup -- --generate` 生成随机密码，保存在 `data/initial-password.txt`。该文件和整个 `data/` 都被 Git 忽略。若本地已由开发流程初始化，直接运行 `npm start`，读取该密码文件即可登录。

可复制 `.env.example` 为 `.env` 修改监听地址或端口。默认仅监听本机；局域网临时测试可将 `HOST` 设为 `0.0.0.0`，手机访问电脑的局域网 IP，需处于同一网络并允许对应端口。正式使用请按下文部署 HTTPS。

重置密码：先停止服务，运行 `npm run setup -- --reset`，再重新启动。投递数据保留，已有会话失效。原随机密码文件不再代表新密码。

## 云服务器部署（Docker Compose）

服务器需安装 Docker 和 Compose，并准备域名、HTTPS 证书及 Nginx。本项目不自动更改服务器现有配置。

```sh
git clone https://github.com/HY-L-723/Personal_Application_Tracking.git
cd Personal_Application_Tracking
docker compose build
docker compose run --rm tracker node scripts/setup.js
docker compose up -d
```

首次密码设置命令交互输入，不在命令行参数中传密码。数据库保存在 `tracker-data` 命名卷，重新构建或重启容器后仍保留。不要使用 `docker compose down -v`，它会删除数据卷。

按 `deploy/nginx.conf.example` 配置反向代理，替换域名和证书路径，检查配置后重新加载 Nginx。Compose 仅将端口映射到服务器的 `127.0.0.1:3000`，外部通过 HTTPS 入口访问。

生产配置 `COOKIE_SECURE=true`，因此直接用 HTTP 登录不会持久保存会话。`TRUST_PROXY=1` 只适用于应用端口只能经单层可信代理访问的上述拓扑；不要向公网直接开放该端口。

不使用 Docker 时，也可以在服务器安装 Node.js 24，按本地步骤初始化，用进程管理工具运行 `npm start`，配合同样的 HTTPS 反向代理。此时设置 `COOKIE_SECURE=true`，按实际代理情况设置 `TRUST_PROXY`。

更新前先备份，再执行 `git pull`、`docker compose build` 和 `docker compose up -d`。部署环境尚未实测，需结合实际服务器校验端口、证书与文件权限。

## 备份和恢复

本地运行 `npm run backup`，通过 SQLite 在线备份接口将一致性快照保存到 `backups/`，无需停止服务。备份包含私人投递信息，应私下保管，不提交 GitHub。

Docker 部署执行 `docker compose exec tracker node scripts/backup.js`，输出备份文件名。可用 `docker compose cp tracker:/app/backups/文件名.db ./文件名.db` 复制到宿主机，再保存到可靠位置。

恢复时先停止服务，将当前完整数据库文件及同名 `-wal`、`-shm` 文件另存作为回退副本，再将备份放回 `data/tracker.db`（Docker 对应数据卷的 `/app/data/tracker.db`）。恢复时不要保留旧库的 WAL/SHM 文件。确保文件归属运行用户后重新启动。密码配置 `auth.json` 独立保存，换机恢复时也可重新执行密码设置。恢复备份后建议重置密码使备份中的旧会话失效。

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
