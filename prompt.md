我们当前项目的核心是智能 DDL 管理系统，不希望把它强行改成聊天机器人。但课程要求体现 Agent 能力，因此需要在现有功能上增加一个真正具备 Agent 闭环的新模块。

请不要推翻现有项目，而是在当前 Inbox、LLM 抽取、Planner、Risk Checker、SQLite 和展示界面的基础上，新增 DeadlineAgent。

DeadlineAgent 的目标是：主动帮助用户保证 DDL 尽量按时完成。

它应该具备以下能力：

1. Observe：读取当前任务、DDL、计划、风险、今日时间和未完成任务。
2. Plan：判断今天应该优先处理什么，哪些任务存在延期风险。
3. Act：调用已有工具，包括任务抽取、日程规划、风险检查、重新排程、导出 ICS、发送提醒。
4. Verify：执行后重新检查是否仍然有时间缺口或高风险任务。
5. Memory：保存简单用户偏好，例如每日最大工作量、偏好工作时间、提醒频率。
6. Trace：记录每一步 Agent 决策过程，便于在前端展示和课程答辩。

请优先实现一个最小闭环：

- 用户点击“运行今日 Agent 巡检”；
- Agent 读取所有任务；
- Agent 判断今日优先任务；
- Agent 发现高风险 DDL；
- Agent 调用重新规划工具；
- Agent 输出今日建议；
- Agent 生成 Agent Trace；
- 前端展示 Agent 的观察、行动和结果。

请新增以下文件：

src/agent/deadline_agent.py
src/agent/agent_state.py
src/agent/agent_tools.py
src/agent/agent_memory.py
src/agent/agent_trace.py

请尽量复用现有 planner.py、risk_checker.py、extractors.py、calendar_exporter.py，不要重写核心逻辑。

同时新增测试，验证：
1. Agent 能读取任务；
2. Agent 能发现高风险任务；
3. Agent 能调用重新规划；
4. Agent 能生成 Trace；
5. 原有测试不受影响。