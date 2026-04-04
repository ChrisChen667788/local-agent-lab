# 中文贡献者快速入门指南

> 本指南帮助中文贡献者快速搭建开发环境并提交第一个 PR。

## 环境要求

- macOS（Apple Silicon 推荐）
- Xcode Command Line Tools：`xcode-select --install`
- Node.js >= 18：推荐使用 `brew install node`
- pnpm：`npm install -g pnpm`

## 快速开始

### 1. Fork 并克隆仓库

```bash
# 在 GitHub 页面点击 Fork
git clone https://github.com/你的用户名/local-agent-lab.git
cd local-agent-lab
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 本地运行

```bash
pnpm dev
```

打开浏览器访问 `http://localhost:3000`。

### 4. 创建分支

```bash
git checkout -b fix/你的修改描述
# 或
git checkout -b feat/你的功能描述
```

### 5. 提交修改

```bash
git add .
git commit -m "类型: 简短描述"
```

提交信息建议使用英文，常见类型：
- `feat:` 新功能
- `fix:` 修复
- `docs:` 文档
- `refactor:` 重构
- `test:` 测试
- `chore:` 构建/工具

### 6. 推送并创建 PR

```bash
git push origin fix/你的修改描述
```

然后在 GitHub 上创建 Pull Request。

## 如何寻找适合新手的 Issue

1. 查看标记为 `good first issue` 的 Issue
2. 查看 `CONTRIBUTING.md` 了解贡献指南
3. 不确定的地方可以直接在 Issue 中提问

## 常见问题

### 安装依赖失败
尝试清除缓存后重试：
```bash
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### 运行报错
确认 Node.js 版本 >= 18：
```bash
node --version
```

### PR 被要求修改
这是正常流程，根据 review 意见修改后 push 新的 commit 即可。

## 有用的链接

- [贡献指南](../CONTRIBUTING.md)
- [行为准则](../CODE_OF_CONDUCT.md)
- [安全政策](../SECURITY.md)
- [英文 README](../README.md)
