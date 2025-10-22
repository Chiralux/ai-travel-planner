# AI Travel Planner (Web) 产品需求文档

## 1. 概述

### 1.1 愿景
- 利用大语言模型与语音交互技术，为旅行者提供端到端的智能行程规划与实时辅助。
- 降低用户在规划、预算、协同与执行旅行时的信息搜集成本，提升旅行体验的可控性与灵活性。

### 1.2 产品范围
- Web 端应用（桌面浏览器 + 移动端浏览器）作为主要交互界面。
- 面向 C 端旅行者的行程规划、预算管理、语音助手及地图探索能力。
- 支撑用户账户体系、云端存储与多端同步。

### 1.3 非目标
- 不提供旅行商品的直接交易功能（如机票/酒店在线预订）。
- 不实现线下导游服务或即时客服。
- 不在 MVP 阶段提供原生 App 客户端。

## 2. 用户画像与场景

### 2.1 用户画像
- **自由行规划者**：25-40 岁，有自由安排旅行的能力，注重体验与性价比，愿意尝试新技术提高效率。
- **亲子家庭主理人**：30-45 岁，需要兼顾多名同行者需求，重视行程安全与舒适度。
- **商务差旅优化者**：28-45 岁，差旅频繁，关注快速规划、预算控制与同步给团队。

### 2.2 关键场景
- **语音快速规划**：用户在移动端浏览器通过语音输入旅行需求（目的地、时间、偏好等），AI 自动生成初版行程，用户可在地图视图中调整。
- **移动端即时调整**：旅途中使用手机浏览器打开 Web 应用，通过语音记录开销、调整行程并同步给同行者。
- **预算监控与提醒**：用户在行程执行中拍照或语音输入消费，系统自动记录并对比预算，推送提醒。

## 3. 核心功能清单与优先级

| 优先级 | 功能模块 | 描述 |
| --- | --- | --- |
| MVP | 智能行程生成 | 基于用户输入生成可编辑行程，含交通/住宿/景点/餐饮建议 |
| MVP | 行程地图展示 | 集成地图 API 显示行程节点、导航与地理信息 |
| MVP | 语音输入（ASR） | 语音转文字，支持需求输入与开销记录 |
| MVP | 预算管理 | 预算设定、开销录入、差异提醒 |
| MVP | 用户注册登录 | 支持邮箱/第三方登录，行程与偏好云端存储 |
| MVP | 设置页 | API Key 管理、偏好设定、语音/通知开关 |
| Enhanced | 多人协同 | 共享行程、权限控制、实时更新 |
| Enhanced | 实时通知 | 预算超支、行程变更、天气提醒推送 |
| Enhanced | 第三方预订链接 | 对接 OTA 或票务平台的深度链接 |
| Enhanced | 多语言支持 | 面向海外用户提供英文/日文等界面 |

## 4. 需求细化

### 4.1 智能行程生成
- 输入：文字/语音方式收集目的地、出行日期、天数、预算、同行人数、偏好标签、特殊需求。
- 处理：BFF 调用大语言模型服务生成行程草案，包含每日主题、活动节点、时间安排、交通与住宿建议。
- 输出：行程时间轴 + 地图标注，可进行手动编辑（删除、添加、重排）。
- 编辑能力：
  - 修改活动节点（名称、时间、地点、备注）。
  - 添加备用方案或备选活动。
  - 支持将 AI 给出的推荐再次 refine。

### 4.2 预算管理
- 预算设定：按行程整体预算，自动按类别（交通/住宿/餐饮/娱乐/购物/其他）分配建议。
- 开销记录：语音或手动输入金额、类别、支付方式、备注；可关联到具体活动。
- 预算分析：显示预算 vs 实际，以饼图/柱状图呈现；重点提示超支类别。
- 导出：MVP 支持 CSV 导出；Enhanced 阶段提供图表导出。

### 4.3 语音识别（ASR）
- 支持移动端浏览器调用 Web Speech API 或第三方 ASR（如讯飞）进行语音输入。
- 语音录音流程：点击麦克风 → 录音 → 上传或本地识别 → 展示识别文本 → 用户确认后作为输入。
- 语音安全：录音需获得用户授权，敏感信息不落地保存，仅保留识别文本及 metadata。

### 4.4 地图展示
- 使用高德或百度地图 JS SDK，展示行程地点、路线规划、实时交通信息。
- 功能点：地点搜索、POI 详情弹窗、行程连线（按日分色）。
- 支持定位用户当前位置，提供导航链接（打开地图 App）。

### 4.5 登录与云同步
- 注册/登录支持邮箱密码 + 第三方 OAuth（如 Google/Facebook）。
- 行程数据存储在云端（Supabase 或 Firebase Firestore），支持多设备同步。
- 数据同步策略：
  - 客户端变更先写本地缓存，再触发云端更新。
  - 冲突时以时间戳最新为准，并保留版本历史（最近 5 个版本）。

### 4.6 设置页
- API Key 管理：用户自行输入 LLM、ASR、地图等服务的 Key，仅前端缓存于安全存储（如 IndexedDB + 加密）。
- 偏好设定：默认货币、默认语言、通知方式、预算提示阈值。
- 隐私控制：用户可选择是否收集匿名使用数据。

## 5. 业务流程与页面流程

### 5.1 业务流程概述（文字 BPMN）
1. 用户注册/登录 → 获取 Token → 进入 Dashboard。
2. 创建行程：输入需求（文字/语音） → BFF 调用 LLM → 返回行程草案 → 用户确认/编辑 → 保存。
3. 行程执行：
   - 查看每日行程 → 地图导航。
   - 录入开销（语音/文字） → 更新预算可视化。
4. 设置页：管理 API Key、偏好、隐私 → 保存同步。
5. 云同步：所有写操作通过 BFF → 数据库 → 推送增量更新给客户端。

### 5.2 页面流程
- `Landing` → `Login/Register` → `Trip Dashboard` → `Trip Detail (Timeline + Map)` → `Expense Tracker` → `Settings`。
- 移动端在 `Trip Detail` 页面提供底部语音入口与地图全屏模式。

## 6. 数据模型与字段字典

### 6.1 核心实体

| 实体 | 字段 | 类型 | 描述 |
| --- | --- | --- | --- |
| User | id | string (UUID) | 用户唯一标识 |
|  | email | string | 登录邮箱 |
|  | displayName | string | 显示名称 |
|  | avatarUrl | string | 头像链接（可空） |
|  | createdAt | string (ISO8601) | 注册时间 |
|  | preferences | object | 用户偏好（见下） |
| Preferences | defaultCurrency | string | 默认货币，如 `CNY` |
|  | defaultLanguage | string | 如 `zh-CN` |
|  | budgetAlertThreshold | number | 超支提醒阈值百分比 |
|  | enableUsageTracking | boolean | 是否允许匿名数据收集 |
| Trip | id | string (UUID) | 行程唯一标识 |
|  | userId | string | 所属用户 |
|  | title | string | 行程标题 |
|  | destination | string | 主要目的地 |
|  | startDate | string (ISO8601) | 出发日期 |
|  | endDate | string (ISO8601) | 结束日期 |
|  | partySize | number | 同行人数 |
|  | preferences | array<string> | 偏好标签 |
|  | budget | number | 总预算，单位为默认货币 |
|  | itineraryId | string | 关联行程详情 |
|  | createdAt | string | 创建时间 |
| Itinerary | id | string (UUID) | 行程详情 ID |
|  | tripId | string | 关联 Trip |
|  | days | array<ItineraryDay> | 行程按天拆分 |
| ItineraryDay | date | string (ISO8601) | 日期 |
|  | theme | string | 当日主题 |
|  | activities | array<Activity> | 活动列表 |
| Activity | id | string (UUID) | 活动 ID |
|  | title | string | 活动名称 |
|  | startTime | string (HH:mm) | 开始时间 |
|  | endTime | string (HH:mm) | 结束时间 |
|  | location | object | 地点信息（见下） |
|  | costEstimate | number | 预计费用 |
|  | category | string | `transportation`/`accommodation`/`dining`/`entertainment`/`other` |
|  | notes | string | 备注 |
| Location | name | string | 地点名称 |
|  | address | string | 地址 |
|  | lat | number | 纬度 |
|  | lng | number | 经度 |
| Expense | id | string (UUID) | 开销记录 ID |
|  | tripId | string | 关联行程 |
|  | activityId | string | 可空，关联活动 |
|  | amount | number | 金额 |
|  | currency | string | 货币代码 |
|  | category | string | 同 Activity.category |
|  | method | string | 支付方式 |
|  | recordedBy | string | 用户 ID |
|  | recordedAt | string | 记录时间 |
| VoiceRequest | id | string (UUID) | 语音请求 ID |
|  | tripId | string | 关联行程，可空 |
|  | userId | string | 发起用户 |
|  | transcript | string | 识别文本 |
|  | intent | string | `create_trip`/`update_trip`/`log_expense`/`other` |
|  | createdAt | string | 创建时间 |
| Settings | userId | string | 用户 ID |
|  | llmApiKey | string | 加密存储后的 Key（仅前端持有密文） |
|  | asrApiKey | string | 同上 |
|  | mapApiKey | string | 同上 |
|  | updatedAt | string | 更新时间 |

### 6.2 关系说明
- User : Trip = 1 : N
- Trip : Itinerary = 1 : 1
- Itinerary : ItineraryDay = 1 : N
- ItineraryDay : Activity = 1 : N
- Trip : Expense = 1 : N
- Trip : VoiceRequest = 1 : N

## 7. API 契约（BFF 层）

所有接口返回 `application/json`，时间使用 ISO8601 字符串。

### 7.1 `POST /api/itineraries`

请求：
```json
{
  "tripId": "b6b69f5a-1f4b-4d80-98b0-5f3c6b4f0ad3",
  "prompt": {
    "destination": "日本东京",
    "startDate": "2025-03-01",
    "endDate": "2025-03-05",
    "budget": 10000,
    "partySize": 3,
    "preferences": ["美食", "动漫"],
    "specialNotes": "带孩子，偏好亲子活动"
  }
}
```

响应：
```json
{
  "itineraryId": "c0a3c1d8-092e-4e1f-8b4d-c7344a5b8d2f",
  "days": [
    {
      "date": "2025-03-01",
      "theme": "抵达与城市初探",
      "activities": [
        {
          "id": "a1",
          "title": "抵达成田机场",
          "startTime": "09:00",
          "endTime": "10:30",
          "location": {
            "name": "成田国际机场",
            "address": "",
            "lat": 35.7719,
            "lng": 140.3929
          },
          "costEstimate": 0,
          "category": "transportation",
          "notes": "建议购买 Suica 卡"
        }
      ]
    }
  ]
}
```

### 7.2 `POST /api/asr`

请求：
```json
{
  "audioUrl": "https://example.com/upload/20250301-voice-01.wav",
  "locale": "zh-CN",
  "context": "trip"
}
```

响应：
```json
{
  "transcript": "我想去东京，三月一号出发玩五天，预算一万元，带孩子",
  "intent": "create_trip",
  "confidence": 0.93
}
```

### 7.3 `GET /api/trips`

请求参数（query）：`?page=1&pageSize=10`

响应：
```json
{
  "items": [
    {
      "id": "b6b69f5a-1f4b-4d80-98b0-5f3c6b4f0ad3",
      "title": "东京亲子游",
      "destination": "日本东京",
      "startDate": "2025-03-01",
      "endDate": "2025-03-05",
      "partySize": 3,
      "budget": 10000,
      "preferences": ["美食", "动漫"],
      "createdAt": "2025-01-15T10:00:00Z"
    }
  ],
  "page": 1,
  "pageSize": 10,
  "total": 4
}
```

### 7.4 `POST /api/trips`

请求：
```json
{
  "title": "东京亲子游",
  "destination": "日本东京",
  "startDate": "2025-03-01",
  "endDate": "2025-03-05",
  "partySize": 3,
  "preferences": ["美食", "动漫"],
  "budget": 10000
}
```

响应：
```json
{
  "id": "b6b69f5a-1f4b-4d80-98b0-5f3c6b4f0ad3",
  "itineraryId": null
}
```

### 7.5 `POST /api/expenses`

请求：
```json
{
  "tripId": "b6b69f5a-1f4b-4d80-98b0-5f3c6b4f0ad3",
  "activityId": "a1",
  "amount": 350,
  "currency": "CNY",
  "category": "dining",
  "method": "credit_card",
  "recordedAt": "2025-03-01T18:30:00+09:00"
}
```

响应：
```json
{
  "id": "e1",
  "tripId": "b6b69f5a-1f4b-4d80-98b0-5f3c6b4f0ad3",
  "amount": 350,
  "currency": "CNY",
  "category": "dining",
  "recordedAt": "2025-03-01T18:30:00+09:00"
}
```

## 8. 非功能需求
- **性能**：行程生成 API 响应时间目标 < 8s；列表类接口 < 500ms。
- **可用性**：服务可用性 99%，关键接口支持自动重试与降级。
- **可用性（UX）**：移动端首屏加载 < 3s，交互反馈 < 200ms。
- **监控**：接入日志与指标采集（请求量、失败率、响应时间）；关键操作植入埋点。
- **隐私安全**：遵循 GDPR/中国个人信息保护要求；最小化存储用户数据；语音文件不长期保存。
- **密钥管理**：不在代码中硬编码 Key；前端输入后通过浏览器安全存储；BFF 仅在需要时代理调用。

## 9. 成功指标与验收标准
- MAU >= 1,000，注册→首个行程创建转化率 >= 60%。
- 平均行程生成满意度（问卷/打分）>= 4.2/5。
- 语音识别准确率（人工抽检）>= 90%。
- 预算记录功能至少 50% 行程用户使用一次以上。
- 系统关键接口错误率 < 1%。
- 验收条件：完成 MVP 功能端到端流程；通过跨浏览器测试（Chrome/Safari/Edge/移动端 Chrome）；完成必要监控与告警配置。

## 10. 风险与应对
- **模型输出质量波动**：建立提示模板与温度配置、提供用户反馈机制快速迭代。
- **第三方 API 限额**：引入 Key 管理与限流策略；预置备选服务供应商。
- **语音识别在嘈杂环境失效**：提供文本输入备选；在 UI 上提示环境要求。
- **数据隐私违规风险**：严格遵循数据最小化，提供一键删除账户数据能力。
- **地图 API 国际使用限制**：根据访问地区自动切换备选地图或提示限制。

## 11. 版本规划与里程碑（两周）

| 周次 | 里程碑 | 交付内容 |
| --- | --- | --- |
| Week 1 | MVP 架构搭建 | 完成设计稿、BFF 与前端框架搭建、用户登录/注册、设置页 API Key 输入、地图基础集成 |
| Week 2 | MVP 功能闭环 | 完成行程生成（LLM 调用）、语音输入流程、预算记录、数据存储与同步、监控与验收测试 |

## 12. 附录

### 12.1 术语表
- **BFF**：Backend for Frontend，针对前端需求定制的后端服务层。
- **LLM**：Large Language Model，用于行程与预算生成。
- **ASR**：Automatic Speech Recognition，语音转文字。
- **POI**：Point of Interest，兴趣点地点。

### 12.2 参考
- 高德地图 JS API 文档
- 科大讯飞语音识别开放平台
- Supabase 文档
- Firebase Authentication & Firestore 文档
