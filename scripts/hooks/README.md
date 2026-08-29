# Git Hooks

## pre-commit 质量门

提交前自动运行 `npm test` 与 `npm run build`，任一失败则拒绝提交。

### 安装方式

将钩子复制到 git 钩子目录：

```
cp scripts/hooks/pre-commit .git/hooks/pre-commit
```

### 跳过方式

紧急情况下可跳过钩子（不建议常规使用）：

```
git commit --no-verify
```
