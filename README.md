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

## 现有 Docker 服务器部署（无需 Compose）

服务器已有 Docker 时，在本机项目目录运行：

```powershell
.\deploy\Deploy-Server.ps1 -ServerAddress 服务器IP
```

默认 SSH 用户 ubuntu、端口 22、网站端口 3003；可用 -UserName、-SshPort、-AppPort 修改。上传和执行时按终端提示输入 SSH 密码，必要时还需 sudo 密码，密码不会写入文件。

脚本只打包已提交源码，不包含本地数据库，首次部署数据库为空。无需服务器安装 Node.js 或连接 GitHub；构建仍需访问 Docker 镜像源和 npm 仓库。可添加 -PrepareOnly 仅打包，不连接服务器。

使用独立容器 personal-application-tracking 和命名卷 pat-tracker-data、pat-tracker-backups。部署前检查端口、同名容器和卷，不修改已有网站、Nginx、防火墙或云安全组。已有不同版本的容器时停止，需另行安排备份和升级。

成功后访问 http://服务器IP:3003/，云安全组若有限制需允许 TCP 3003。后续可为此端口配置域名和 HTTPS。此方式备份使用 sudo docker exec personal-application-tracking node scripts/backup.js。

### 服务器无法访问 Docker Hub 时

使用本机准备离线包，再上传到服务器：

```powershell
.\deploy\Deploy-Server.ps1 -ServerAddress 服务器IP -Offline
```

此模式在本机下载官方 Node.js 镜像并安装生产依赖，压缩后上传；服务器只导入镜像并以禁用网络的模式构建，不访问 Docker Hub 或 npm，不更改全局镜像源。当前离线包面向 Linux amd64 服务器，适用于本项目无原生扩展的生产依赖。

本机需要能连接 GitHub、Docker Hub 和 npm。镜像下载使用固定版本、校验 SHA-256 的 Google go-containerregistry 工具，文件保存在被 Git 忽略的 .local/offline。可追加 -PrepareOnly 先验证打包而不连接服务器。

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

### 快捷进度与待办工作台

投递列表、手机卡片、看板和待办卡片上的状态下拉框可以直接修改岗位进度。选择后自动保存，按服务器当前时间新增流程历史；不改变原备注、岗位链接或投递时间。历史时间可在详情中纠正。发生并发修改时提示刷新，不覆盖其他页面的更新。测评沿用固定流程的“笔试”值，下拉框显示“笔试 / 测评”。

导航中的“待办”（`/#todos`）复用已有日程数据，导入或手动新增的测评截止、笔试、面试等时间会自动出现。支持公司／岗位／事项搜索、类型筛选、逾期／今天／未来7天／已完成／已取消分组查看；卡片展示关联岗位的当前进度，可完成、取消、恢复、编辑时间或打开日程链接。完成日程不会自动推进岗位阶段。

“进行中 · 待补时间”列出笔试或面试阶段但没有待完成日程的岗位，可直接补充安排。仅存在于备注中的日期不被解析为精确时间，也不会自动制造截止提醒。时间均按北京时间处理。新功能不变更数据库结构。

### 本次前端更新上线

已有无 Compose 部署，可从最初离线版本更新本次界面：

```powershell
.\deploy\Update-Web.ps1 -ServerAddress 111.229.141.44
```

按提示输入 SSH／sudo 密码。脚本只上传已提交的前端源码，复用服务器当前镜像，服务器不需访问 Docker Hub 或 npm。先检查容器归属、版本、挂载和健康，再构建镜像、备份 SQLite、切换容器；旧容器保留为停止状态，健康检查失败时尝试恢复。整个过程不删除数据卷，也不更改其他服务。切换有短暂中断，请暂勿同时编辑记录。

默认基线为 `1fd04328328997e50b0f204c2d676b756d95bd23`。后续纯前端更新可显式设置 `-BaseRevision` 为服务器当前完整提交号；如后端或依赖相对基线发生变化，本脚本拒绝打包，需采用完整升级方案。`-PrepareOnly` 只生成包，不连接服务器。请不要对已部署实例重复使用首次部署命令来替代升级。

部署决策及回退路径可使用 `bash tests/update-web.test.sh` 在不访问服务器或 Docker 守护进程的情况下验证。

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
