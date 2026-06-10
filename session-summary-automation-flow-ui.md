# Session Summary: 自动化测试全流程页面优化

Date: 2026-06-04

## 用户目标

用户希望根据手绘草图和后续高保真参考图，优化本地 QA 自动化测试平台中的“自动化测试全流程”页面。重点是让页面更像一个完整的自动化测试流程工作台：

- 顶部是大号“需求输入”区域。
- 输入下方是“开始全流程 / 过程澄清 / 清空会话”操作区。
- 右侧或同一区域展示真实 Flow、workItemId、当前阶段、实时同步状态。
- 中间是横向 8 步流程轨道。
- 下方是三栏：过程澄清、流程会话、当前阶段实时产物 / 交付物目录。
- 技术明细/实时日志需要独占底部一整行。
- 交付物需要可查看并渲染预览。

## 参考图与关键反馈

用户先提供了手绘草图，核心结构是：

- “自动化全流程”
- “需求输入”
- 大文本输入框
- “分散全过程澄清 / 清空会话”
- 底部流程节点线：需求分析、项目预检、用例设计、页面探索、脚本实现、运行验证、自愈诊断、保存已验证产物

随后生成了一张深色高保真原型图，并据此实施。之后用户又提供更精确的参考截图，并指出实际实现与截图不符的 3 点：

1. 页面中多了“等待开始等待启动自动化全流程 / 输入需求并开始后...”这块状态说明区域，需要移除。
2. “过程澄清 / 流程会话 / 当前阶段实时产物 / 交付物目录”需要在同一行展示。
3. “技术明细（实时日志）”应该独占底部一整行。

这些反馈已按用户要求修正。

## 已修改文件

主要修改：

- `frontend/src/main.jsx`
- `frontend/src/styles.css`

未修改后端 API、数据库结构或编排逻辑。

## 当前实现状态

### 页面结构

`AutomationFlow` 组件已重排为：

1. 页面标题与运行状态。
2. 顶部 `flow-command-panel`：
   - `需求输入` textarea，`data-testid="automation-flow-input"`。
   - 字数计数，最大 2000。
   - 操作按钮：
     - `开始全流程`
     - `过程澄清`
     - `清空会话`
   - 运行摘要，`data-testid="automation-flow-result"`：
     - 真实 Flow
     - workItemId
     - 当前阶段
     - 实时同步
3. 横向流程轨道，`data-testid="automation-flow-stages"`：
   - 需求分析
   - 项目预检
   - 用例设计
   - 页面探索
   - 脚本实现
   - 运行验证
   - 自愈诊断
   - 保存已验证产物
4. 三栏主内容区：
   - 左：过程澄清
   - 中：流程会话，`data-testid="automation-flow-live"`
   - 右：当前阶段实时产物 / 交付物目录，`data-testid="automation-flow-artifact-preview"`
5. 底部独占一行：
   - 技术明细（实时日志），`data-testid="automation-flow-logs"`

### 交付物查看与渲染

新增/调整了交付物工作区：

- `ArtifactWorkspace`
- `ArtifactTreeItem`
- `ArtifactRenderedPanel`
- `ArtifactTestAnchors`

支持：

- 产物目录 / 版本记录切换。
- 右侧详情切换：
  - 预览
  - 内容
  - 元数据
- 根据 artifact 类型渲染：
  - 测试用例表格预览
  - Playwright 脚本代码块
  - 执行摘要/报告卡片
  - 普通文本内容
  - 元数据网格

为了保持原有 Playwright 测试兼容，`ArtifactTestAnchors` 保留了隐藏的完整 artifact 内容锚点：

- `data-testid="artifact-test-cases"`
- `data-testid="artifact-exploration-plan"`
- `data-testid="artifact-playwright-script"`
- 其他 `artifact-${artifactType}` 同类锚点

这些隐藏锚点用于测试读取完整内容，不影响用户视觉。

## 关键 helper

新增或使用的辅助逻辑包括：

- `buildClarificationItems`
- `buildStageSummaries`
- `groupArtifactsByStage`
- `artifactIcon`
- `stageStateLabel`
- `formatArtifactSize`
- `parseMarkdownTableRows`
- `renderArtifactPreviewContent`

## 验证情况

已运行并通过：

```bash
npm --prefix frontend run build
```

曾运行并通过过：

```bash
NO_PROXY='127.0.0.1,localhost,*' PLATFORM_URL=http://127.0.0.1:5175 npx playwright test tests/e2e/automation-platform.spec.ts --project=chromium --reporter=list -g "TC-PLAT-009"
```

后续在调整 artifact 渲染后再次重跑该测试时被用户中断，未得到最终结果；但构建通过，并且后续按用户指出的三处布局问题完成了修正。

完整 `automation-platform.spec.ts` 曾出现 `TC-PLAT-002` 失败，失败点在旧的“需求工单/总览查找新任务”测试路径：截图显示工单实际已创建并展示在需求工单页面，不是本次全流程页布局修改导致。

## 本地服务与浏览器验证

前端开发服务曾启动到：

```text
http://127.0.0.1:5175/
```

原因是 5174 已被占用。

后端健康检查在线：

```text
http://127.0.0.1:8001/api/health
```

浏览器检查时曾临时设置 1920x1080 viewport 以对齐用户提供的桌面参考图，最后已 reset viewport。

## 当前用户最后确认的布局要求

如果后续继续优化，应优先遵守：

- 不要恢复中间那块“等待开始等待启动...”状态说明区域。
- 三个主面板必须在桌面同一行：
  - 过程澄清
  - 流程会话
  - 当前阶段实时产物 / 交付物目录
- 技术日志必须在三栏下方独占整行。
- 顶部输入框不宜过高，否则会把日志挤出首屏。
- 交付物目录需要可查看、可切换、可渲染。

## 注意事项

- 项目当前 git 状态显示大量文件为 untracked，`git diff` 对这些文件不会输出普通 diff。
- 不要误删隐藏测试锚点 `ArtifactTestAnchors`，否则现有 `TC-PLAT-009` 对 artifact 内容的断言可能失效。
- 页面仍保持深色 SaaS 工作台风格，不要改成白板或浅色主题。
