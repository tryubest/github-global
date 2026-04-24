# GitHub Global —— Technical Design Document

> Construction blueprint. This document is used in conjunction with `docs/PRD.md` v1.1: PRD answers "what to do", this document answers "how to do".

---

## Document Information

| Project | Content |
| --- | --- |
| Document Type | Technical Design |
| Document Version | v1.2 (M0 Implementation Alignment: Next.js 16 / Prisma 6 / Tailwind v4; main text in §11) |
| Aligned PRD | `docs/PRD.md` v1.1 |
| Tech Stack Lock | `.cursor/rules/project-context.mdc` |
| Code Standards | `.cursor/rules/code-style.mdc` |
| Responsible Person | Full-stack Architect / Developer |
| Last Updated | 2026-04-23 |

---

## 0. Design Principles (Before Any Specific Design)

1. **Monolith First (Modular Monolith)**: MVP does not use microservices, but within `lib/`, it is strongly divided by domain (github / translator / queue / auth), allowing any module to be smoothly extracted as an independent service in the future.
2. **Boundaries are Contracts**: All cross-module calls must go through explicit function signatures exported by `lib/*/index.ts`, and cross-module imports of internal files are not allowed.
3. **Platform Abstraction**: A layer of `lib/vcs/` (introduced in P1) is abstracted on top of `lib/github/`, with GitHub being just one implementation of VCS, laying the foundation for F-25 (GitLab / Gitee adaptation).
4. **Database as Queue (MVP Stage)**: Use `TranslationJob.status` + polling worker to simulate a queue, without introducing Redis/Upstash, reducing infrastructure costs (aligned with PRD 6.3).
5. **Idempotency First**: All external side-effect operations (creating branches, creating PRs, webhook processing) must be retryable and dedupable, using `externalId` + unique constraints as a fallback.
6. **Zero Hardcoded Secrets**: `process.env.*` is the only entry point for reading, encapsulated in `lib/env.ts` with zod validation (failure at startup is better than runtime crashes).

---

## 1. System Architecture

### 1.1 Overall Architecture Diagram (C4 Context + Container Combined)

```mermaid
flowchart TB
    subgraph User["👤 用户 (开源作者 / DevRel)"]
        Browser["浏览器"]
    end

    subgraph GH_Platform["🐙 GitHub 平台"]
        GH_OAuth["OAuth Server"]
        GH_App["GitHub App<br/>(Installations)"]
        GH_API["REST / GraphQL API"]
        GH_Webhook["Webhook Publisher"]
    end

    subgraph Vercel["☁️ Vercel (部署单元)"]
        subgraph NextApp["Next.js 16 App"]
            direction TB
            UI["App Router 页面<br/>Server Components"]
            ApiRoutes["API Routes<br/>/api/*"]
            Actions["Server Actions"]
            Middleware["middleware.ts<br/>(会话与 Webhook 签名)"]
        end
        Cron["Vercel Cron<br/>(每分钟拨一下 worker)"]
    end

    subgraph Neon["🗄️ Neon Postgres"]
        DB[("Prisma Schema<br/>User / Installation<br/>Repository / Job / FileTranslation")]
    end

    subgraph OR_Platform["🤖 OpenRouter"]
        LLM["多模型路由<br/>(:free / 付费)"]
    end

    Browser -->|"HTTPS"| UI
    UI -->|"Server Action"| Actions
    UI -->|"fetch / SSE"| ApiRoutes
    Actions -->|"Prisma"| DB
    ApiRoutes -->|"Prisma"| DB
    ApiRoutes -->|"Octokit"| GH_API

    Browser -->|"OAuth 登录跳转"| GH_OAuth
    GH_OAuth -->|"code 回调"| ApiRoutes
    Browser -->|"引导安装"| GH_App
    GH_Webhook -->|"push / installation 事件"| Middleware
    Middleware --> ApiRoutes

    ApiRoutes -->|"OpenAI 兼容协议"| LLM
    Cron -->|"HTTP 调用 /api/worker/tick"| ApiRoutes
    ApiRoutes -->|"入队/出队/更新状态"| DB

    classDef ext fill:#fef3c7,stroke:#f59e0b
    classDef core fill:#dbeafe,stroke:#2563eb
    classDef data fill:#dcfce7,stroke:#16a34a
    class GH_Platform,OR_Platform ext
    class Vercel,NextApp,Cron core
    class Neon,DB data
```

### 1.2 Request Dimension: Sequence Diagrams for Three Key Paths

This section's three **sequence diagrams** describe: who requests whom first, in what order, and for what purpose. Vertical lines (participants) are "roles"; horizontal arrows are "one interaction"; `alt` / `loop` represent branches and repetitions.

#### 1.2.0 Beginner's Guide: What Do the Three Paths Solve?

| Number | Path | One Sentence | What You, as a User, Can Perceive | Relationship with §1.3 Below |
| --- | --- | --- | --- | --- |
| **1.2.1** | Login + Authorize Repository | Prove "which GitHub user you are" and let this app **securely** obtain permission to operate on your repository (OAuth + GitHub App installation). | Click login → jump to GitHub → return to this site → may see "go install App" → after installation, see repository list. | Mainly goes through `app/` pages and `/api/auth/*`, `lib/auth`, `lib/github`; results written to DB's User / Installation / Repository. |
| **1.2.2** | Translation Task & PR | After you click "Start Translation", **background works slowly** (pull files, call model, push branch, open PR), frontend only **polls progress**. | Select repository and language → progress appears → after completion, jump to PR link. | `app/` initiates task; `lib/translator`, `lib/queue` (worker), `lib/github`, OpenRouter; DB records Job / file-level status (design in §3.2 full schema; M0 may not have all tables yet). |
| **1.2.3** | Incremental Translation (Webhook) | When **someone pushes a new commit** in the repository, GitHub **actively notifies** us; we first **quickly acknowledge**, then let Worker **slowly compare and decide whether to start a new translation task**. | After you modify documentation and push, no need to click translation again, system can automatically follow (if enabled). | `middleware` verifies signature; `/api/webhooks/github` stores WebhookEvent in DB; Worker consumes; depends on `lib/github` to compare changes. |

**Common Symbols in Sequence Diagrams (for reference)**

| Symbol | Meaning |
| --- | --- |
| `->>` / `-->>` | Solid line: request; dashed arrow: response (async return often uses `-->>`). |
| `actor` / `participant` | Human/browser/service/database "vertical bar" roles. |
| `autonumber` | Automatically numbers arrows for easy reference in the following text. |
| `alt` / `else` / `end` | Conditional branches: if A is satisfied, go one way, otherwise go the other. |
| `loop` / `end` | Repetition: e.g., "ask for progress every 2 seconds". |
| `Note over X` | Comments: explaining background (not a separate request step). |

> **GitHub Rendering Note**: When local preview is normal but github.com still shows the entire block as code, it's often due to Mermaid syntax pitfalls. Must-avoid items include: **do not use English semicolons `;` in sequence diagram messages**; **do not use angle bracket placeholders** (like `<sha>`); **do not use `id[/多段路径/]` trapezoid nodes** (paths with `/` will break parsing); use fewer **`&`** in `flowchart` labels; avoid **`FK,UK`** comma-concatenated attribute lines in `erDiagram`. Complete list see **`.cursor/rules/docs-mermaid-github.mdc`**.

#### 1.2.1 Login + Authorize Repository (First-time Use)

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant B as 浏览器
    participant N as Next.js
    participant GH as GitHub
    participant DB as Neon

    U->>B: 点击"用 GitHub 登录"
    B->>N: GET /api/auth/github/start
    N-->>B: 302 → github.com/oauth/authorize
    B->>GH: 授权页
    U->>GH: 同意授权
    GH-->>B: 302 → /api/auth/github/callback?code=xxx
    B->>N: GET /api/auth/github/callback?code=xxx
    N->>GH: POST /login/oauth/access_token
    GH-->>N: access_token
    N->>GH: GET /user
    GH-->>N: user profile
    N->>DB: upsert User
    N->>B: Set-Cookie session=jwt，302 → /dashboard
    B->>N: GET /dashboard
    N->>DB: 查 Installations 是否存在
    alt 无 Installation
        N-->>B: 渲染"去安装 GitHub App"引导
        U->>GH: 安装 App 到选定仓库
        GH->>N: POST /api/webhooks/github (installation.created)
        N->>DB: upsert Installation + Repository[]
        GH-->>B: 302 → /dashboard
    else 已有 Installation
        N-->>B: 渲染仓库列表
    end
```

**1.2.1 What It's Doing (Plain Language)**  
To use this app to operate documentation on GitHub, you must first complete two things: **(A) Login**—let this site know who you are on GitHub; **(B) Authorization**—let this site access your selected repositories with **GitHub App** identity. OAuth handles (A), installing the App to the repository handles (B). The database will record your `User`, the App's `Installation`, and the list of visible `Repository`.

**Participant Responsibilities**

| Role | What It Is | Role in This Path |
| --- | --- | --- |
| User | Real person | Clicks login, clicks authorization on GitHub, installs App. |
| Browser | Chrome, etc. | Sends HTTP requests on your behalf, saves cookies, follows 302 redirects. |
| Next.js | This site's App + API | Initiates OAuth, exchanges for token, creates session, reads DB, renders pages. |
| GitHub | github.com | Sends OAuth page, sends token, pushes webhook after user installs App. |
| Neon | Postgres Database | Stores User / Installation / Repository, can be reused on next request. |

**Recommended to Compare with the Above Steps (Understand by Stage, No Need to Memorize Numbers)**

| Stage | What Happened | Purpose |
| --- | --- | --- |
| OAuth Start | User clicks login → browser accesses `/api/auth/github/start` → **302** to GitHub authorization page | Hands user over to GitHub for identity and authorization confirmation, this site doesn't touch passwords. |
| User Consent | User clicks authorization on GitHub → GitHub **302** back to `callback?code=` | `code` is a one-time "coupon" that can only be used server-side to exchange for `access_token`. |
| Exchange Token + Pull Info | Next.js uses `code` to exchange for `access_token`, then `GET /user` | Gets stable user identifier (like `githubId`, login), ready to write to `User` table. |
| Store in DB + Session | After `upsert User`, `Set-Cookie`, **302** to `/dashboard` | From now on, browser carries cookies, this site knows "who you are". |
| Enter Console | `GET /dashboard`, check if there's already **Installation** | OAuth alone **cannot** represent that the App is installed in the repository; so branch judgment is needed. |
| Branch: App Not Installed | Page guides to install on GitHub; after user installs, GitHub sends `installation`-like webhook; this site `upsert Installation + Repository[]` | Synchronizes "which repositories can be accessed by this App" into the database. |
| Branch: Already Installed | Directly render repository list | User can continue to select repositories for translation and other operations. |

**Relationship with 1.2.2 / 1.2.3**  
Without 1.2.1, subsequent operations cannot represent users to call GitHub APIs, nor receive webhooks with installation context, **translation and incremental paths will not be established**.

```mermaid
flowchart TB
    subgraph login["阶段 A：OAuth 登录"]
        L1[用户在站点点登录]
        L2[跳转 GitHub 授权]
        L3[带回 code 回调本站]
        L4[换 token 并写入 User + Cookie]
        L1 --> L2 --> L3 --> L4
    end
    subgraph install["阶段 B：GitHub App 安装（首次）"]
        I1[打开控制台 dashboard]
        I2{库里有 Installation 吗}
        I3[引导去 GitHub 安装 App]
        I4[Webhook 同步仓库列表到 DB]
        I5[展示已授权仓库列表]
        I1 --> I2
        I2 -->|否| I3 --> I4 --> I5
        I2 -->|是| I5
    end
    login --> install
```

#### 1.2.2 Translation Task & PR Output

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant B as 浏览器
    participant N as Next.js
    participant W as Worker<br/>(/api/worker/tick)
    participant GH as GitHub
    participant OR as OpenRouter
    participant DB as Neon

    U->>B: 选仓库 + 勾语言，点"开始翻译"
    B->>N: Server Action: createJob
    N->>DB: INSERT TranslationJob (status=pending)<br/>+ FileTranslation(status=queued) × N
    N-->>B: 返回 jobId
    loop 每 2s 轮询直到终态
        B->>N: GET /api/jobs/{id}
        N-->>B: { progress, files[] }
    end

    Note over W: Vercel Cron 每 60s 拨一次
    W->>DB: SELECT pending jobs FOR UPDATE SKIP LOCKED
    W->>DB: UPDATE status=running
    W->>GH: 列出 .md 文件 (Git Tree API)
    loop 每个文件 × 每种语言
        W->>GH: 取文件原文
        W->>OR: POST /chat/completions
        OR-->>W: 译文
        W->>W: AST 校验 (remark) ❗
        W->>GH: 创建/追加 commit 到 i18n/lang-时间戳 分支
        W->>DB: UPDATE FileTranslation: status=succeeded, sourceHash, tokens
    end
    W->>GH: 创建/更新 PR
    W->>DB: UPDATE TranslationJob status=succeeded, prUrl
    B-->>U: 下一次轮询拿到 succeeded，跳转 PR
```

**1.2.2 What It's Doing (Plain Language)**  
A single "Start Translation" by the user will **immediately** create one or more task records in the database, but the **truly time-consuming work** (reading GitHub files, calling LLM, writing back to branch, opening PR) is done **asynchronously** in the **Worker**. The browser uses **short polling** (e.g., every 2 seconds) to ask "is it done yet", avoiding hanging a connection for a long time in serverless. Worker is triggered periodically by **Vercel Cron** (e.g., every minute), **grabbing** pending tasks from the DB to prevent multiple instances from executing the same task.

**Participant Responsibilities**

| Role | What It Is | Role in This Path |
| --- | --- | --- |
| User / Browser | Operator and frontend | Submits "select repository + language"; polls `/api/jobs/:id` for progress. |
| Next.js | Server Action + API | `createJob` writes to DB; provides task query interface. |
| Worker | Mostly `/api/worker/tick` in this design | Called by Cron; pulls GitHub tree, calls OpenRouter, pushes commits, updates PR, writes back to DB. |
| GitHub | Remote repository and API | Provides file content and ability to write branches / PRs. |
| OpenRouter | LLM gateway | Returns translations according to OpenAI compatible protocol. |
| Neon | Database | Records Job, translation status of each file, token usage, etc. |

**Two "Timelines" Running in Parallel (Key to Understanding)**

| Timeline | Who Initiates | What It's Doing |
| --- | --- | --- |
| **User Timeline (Frontend)** | Browser | Server Action creates task → **loop** polls progress → after final state, jumps to PR. |
| **Worker Timeline (Backend)** | Cron → Worker | Takes `pending` from DB → `running` → calls model for each file × language → validates Markdown AST → pushes to `i18n/...` branch → opens/updates PR → Job `succeeded`. |

**What the Worker Inner Loop is Doing (Step by Step)**

| Step | Action | Purpose |
| --- | --- | --- |
| 1 | `SELECT ... FOR UPDATE SKIP LOCKED` | When multiple instances, **only one Worker takes the same task**. |
| 2 | Git Tree API lists `.md` | Knows which files to translate. |
| 3 | Pull original text for each file → OpenRouter → get translation | Actual translation. |
| 4 | remark AST validation | Prevents model from destroying Markdown structure (tables/code blocks/etc.). |
| 5 | commit to dedicated branch | Doesn't directly pollute default branch, uses PR for review. |
| 6 | Update `FileTranslation` / `TranslationJob` | Progress is queryable, billable, retryable. |

**Relationship with 1.2.1 / 1.2.3**  
Depends on permissions obtained in 1.2.1 to read/write repositories; 1.2.3 may **automatically trigger** similar task paths when **source files change** (usually creating new Jobs, rather than making users click again).

```mermaid
flowchart LR
    subgraph front["前台：用户浏览器"]
        F1[Server Action 创建 Job]
        F2[轮询 GET /api/jobs/id]
    end
    subgraph back["后台：Cron + Worker"]
        B1[tick 取 pending Job]
        B2[读 GitHub 文件]
        B3[OpenRouter 翻译]
        B4[写分支 + PR]
        B1 --> B2 --> B3 --> B4
    end
    subgraph db["DB"]
        D[(Job / File 状态)]
    end
    F1 --> D
    F2 --> D
    B1 --> D
    B4 --> D
```

#### 1.2.3 Incremental Translation (Webhook-driven)

```mermaid
sequenceDiagram
    autonumber
    participant GH as GitHub
    participant MW as middleware.ts
    participant N as /api/webhooks/github
    participant DB as Neon
    participant W as Worker

    GH->>MW: POST /api/webhooks/github<br/>X-Hub-Signature-256
    MW->>MW: 校验 HMAC-SHA256
    alt 签名非法
        MW-->>GH: 401
    end
    MW->>N: 转发
    N->>N: 3s 内早返回（防 GitHub 10s 超时）
    N->>DB: INSERT WebhookEvent (raw payload, status=pending)
    N-->>GH: 200 OK
    Note over W: Worker 异步消费 WebhookEvent
    W->>DB: SELECT pending WebhookEvent
    alt event = push
        W->>GH: Compare API: 取变更文件列表
        W->>DB: 与 FileTranslation.sourceHash 比对
        W->>DB: 对变化的文件创建新 TranslationJob
    else event = installation_repositories
        W->>DB: 同步 Repository 表
    end
```

**1.2.3 What It's Doing (Plain Language)**  
When GitHub events occur in a repository (e.g., **push**, **installation_repositories**), it POSTs a JSON string to your configured URL (Webhook). This site must: **first verify the request really comes from GitHub** (HMAC signature), then **quickly return 200** (GitHub may retry or consider it failed if timeout), store the original payload in `WebhookEvent` table, and let **Worker asynchronously** slowly process—comparing file hashes, deciding whether to create new translation tasks, or synchronizing repository lists.

**Participant Responsibilities**

| Role | What It Is | Role in This Path |
| --- | --- | --- |
| GitHub | Event source | POSTs Webhook on push / installation changes. |
| middleware.ts | Next.js edge/middleware | **Verifies signature**; returns 401 if not passing, protecting against forged requests. |
| `/api/webhooks/github` | API route | Parses payload, **returns early**, writes to `WebhookEvent`. |
| Neon | Database | Persists events, supports retry and audit. |
| Worker | Async consumer | Reads `pending` events, calls GitHub Compare API, updates DB, creates `TranslationJob` if necessary. |

**Why "Return Within 3 Seconds"?**  
GitHub has requirements for Webhook response time (common discussion threshold about **10s**). Translation analysis can be slow, if placed in synchronous HTTP it's easy to timeout; so HTTP is only responsible for **acknowledging + storing in DB**, heavy work is handed to Worker.

**Branch: Two Typical Events**

| Event Type | What Worker is Doing | Business Meaning |
| --- | --- | --- |
| `push` | Compare API to see which files changed → compare with existing `FileTranslation.sourceHash` → only changed ones get new Job | **Incremental translation**: only process changes, control costs. |
| `installation_repositories` | Update `Repository` table | When user adds/removes repository access for App on GitHub, this site's list matches actual permissions. |

**Relationship with 1.2.2**  
1.2.3 usually **ends with "create new TranslationJob"**; actual translation still follows the same set of Worker processing Job logic in 1.2.2 (reusing the same "dequeue → translate → write back" capability).

```mermaid
flowchart TB
    GH[GitHub POST Webhook]
    MW[middleware 校验签名]
    WH_Route["路由 /api/webhooks/github"]
    DB[(WebhookEvent 表)]
    W[Worker 异步处理]
    GH --> MW --> WH_Route
    WH_Route -->|INSERT pending| DB
    WH_Route -->|尽快 200| GH
    W -->|SELECT pending| DB
    W -->|必要时创建 Job| DB
```

### 1.3 Module Layering (Code Level)

**1.3.0 How Beginners Should Understand This Section**  
The diagram above is not "deployment topology", but **where code should be placed and who can depend on whom**: upper layer is responsible for HTTP/UI, middle layer for domain logic (GitHub, translation, queue), bottom layer uniformly uses Prisma to access database. This makes unit testing, replacing implementations (e.g., switching VCS in the future) easier.

**Where the Three Paths Fall in Layering (Compared with §1.2)**

| §1.2 Path | Main Directories Touched (Conceptually) | Explanation |
| --- | --- | --- |
| 1.2.1 Login / Installation | `app/` (pages and `/api/auth`), `lib/auth`, `lib/github`, via `lib/db` to write Prisma | Presentation layer initiates, business layer encapsulates OAuth/App, data layer stores in DB. |
| 1.2.2 Translation + PR | `app/` (Action / polling API), `lib/translator`, `lib/queue`, `lib/github`, `lib/db` | Worker logic placed in `lib/`, triggered by thin wrapper `app/api/worker`. |
| 1.2.3 Webhook | `middleware.ts`, `app/api/webhooks`, `lib/github`, `lib/queue` (consumer), `lib/db` | Verification as early as possible; route layer writes to DB quickly. |
| Read Model / Configuration | `lib/db` + `prisma/` | Schema and migration are the source of structural truth (see §3.2 and current repo `prisma/schema.prisma` may align in phases). |

**Layering Responsibility Table**

| Layer | Path | What to Put | What Not to Put |
| --- | --- | --- | --- |
| Presentation Layer | `app/` | Pages, layouts, Route Handlers, `middleware`, Server Action **entry points** | Don't directly `new PrismaClient()`; don't write complex GitHub call details |
| Business Layer | `lib/*` | Pure logic by domain and external `index.ts` APIs | Don't directly bind specific React components |
| Data Access | `lib/db.ts` | Prisma singleton, (optional) transaction helpers | Business rules should尽量 return to `lib/*` |
| Metadata | `prisma/` | `schema.prisma`, `migrations/` | Don't write runtime business code here |

```mermaid
flowchart LR
    subgraph A["app/ 表现层"]
        A1["(auth)/*"]
        A2["(dashboard)/*"]
        A3["api/*"]
    end
    subgraph B["lib/ 业务层"]
        B1["lib/auth"]
        B2["lib/github"]
        B3["lib/translator"]
        B4["lib/queue"]
        B5["lib/vcs<br/>(P1 抽象)"]
    end
    subgraph C["lib/db.ts 数据层"]
        C1["PrismaClient 单例"]
    end
    subgraph D["prisma/ 元数据"]
        D1["schema.prisma"]
        D2["migrations/"]
    end

    A --> B
    B --> C
    C --> D
    B2 -.P1 重构.-> B5
```

The arrow **`A → B → C → D`** in the diagram above indicates **dependency direction**: pages and APIs depend on business modules, business modules depend on data access, data access corresponds to Prisma metadata. `lib/vcs` dashed line indicates that **P1** will abstract GitHub into generic VCS, current MVP may still mainly use `lib/github`.

**Dependency Rules (Combined with Diagram Above)**

| Allowed | Forbidden (Strict Constraint) |
| --- | --- |
| `app/*` → `lib/*/index` (business entry) | `app/*` **directly** `import @prisma/client` |
| `lib/github` etc. → `lib/db` | `import lib/github/internal/...` **cross-module deep paths** (application side) |
| Each `lib` sub-package only exports APIs declared in `index.ts` | Stacking long strings of Octokit calls in `app` without sinking to `lib/github` |

**Strict Constraint**: `app/` does not directly import `@prisma/client`, must go through `lib/db.ts`; `lib/` sub-modules only expose through root `index.ts`, cross-module deep path references are forbidden.

**Example of "Vertical Slice" of a Request (Helps Connect §1.2 with §1.3)**  
User submits translation form: `app/(dashboard)/...` triggers Server Action → Action calls `lib/translator`'s `createJob(...)` → internally uses `lib/db` transaction to write Job → returns `jobId` to browser; subsequently Cron hits `app/api/worker/tick` → route calls `lib/queue` / `lib/translator` to dequeue and execute → reads/writes remote repository via `lib/github`. Throughout the entire chain, **only below `lib/db` touches Prisma**.

---

## 2. Technology Selection

### 2.1 Frontend

| Domain | Selection | Reason | Abandoned Candidates |
| --- | --- | --- | --- |
| Framework | **Next.js 16 App Router** | Frontend-backend isomorphic, Server Components default reduces hydration cost, Vercel native support | Remix (Vercel support weaker), Vite+Express (two deployment sets troublesome) |
| Language | **TypeScript strict** | Hard requirement for rule files; higher accuracy for multi-person collaboration/AI collaboration hints | Native JS (too low trust in AI-generated code) |
| UI Components | **shadcn/ui** | Code-level copy rather than npm dependency, fully customizable; accessibility guaranteed by底层 primitives (**M0 preset to Base UI**; historical scheme also commonly uses Radix) | MUI (high theme learning cost), Chakra (future maintenance uncertain) |
| Styling | **Tailwind CSS** | Bound to shadcn; utility-first pairs excellently with AI generation | CSS Modules (verbose), styled-components (declining) |
| Icons | **lucide-react** | shadcn default pairing, 2000+ icons全覆盖 | heroicons (fewer icons) |
| Forms | **react-hook-form + zod** | Shares types with backend zod schema, end-to-end type safe | formik (weaker type inference) |
| Real-time Progress | **Short polling (2s)**, upgrade to SSE before GA | Vercel Node Runtime `maxDuration` ≤ 60s, long SSE connections can't last translation duration; short polling is controllable cost and simple implementation | SSE (blocked by serverless duration limit), WebSocket (bidirectional excess) |
| State Management | **React Server Components + URL state +少量 zustand** | Server-side state not on client; zustand only for cross-component UI state (Toast, Modal) | Redux (heavy), Jotai (sufficient but zustand ecosystem larger) |
| Data Fetching | **Server Actions + native fetch** | Next.js 16 Server Actions cover 90% form scenarios; directly await in RSC | SWR/React Query (less necessary in RSC) |

### 2.2 Backend (Still within Next.js)

| Domain | Selection | Reason |
| --- | --- | --- |
| Runtime | **Node.js runtime** (not Edge) | Prisma doesn't fully support Edge; Octokit depends on Node crypto |
| API Style | **Server Actions + REST (`/api/*`)** | Server Actions for internal forms; REST for Webhook/SSE/external calls |
| Input Validation | **zod** (mandatory rules) | Runtime + compile-time dual type safety |
| GitHub SDK | **@octokit/app + @octokit/rest** | Officially maintained; `@octokit/app` natively supports GitHub App authentication (JWT + Installation Token) |
| Webhook Verification | **@octokit/webhooks** | Built-in HMAC-SHA256 signature verification, zero cost for anti-forgery |
| Markdown Parsing | **remark + remark-parse + unified** | Mature AST operations; can precisely isolate code blocks/inline code/URL/images |
| Task Scheduling | **Vercel Cron + DB row-level locks** | `SELECT ... FOR UPDATE SKIP LOCKED` naturally prevents duplicates |
| Logging | **pino** (local) + **Vercel Logs** (online) | Structured JSON, convenient for future connection to Datadog/Logtail |
| Error Reporting | **@sentry/nextjs** (P1 connection) | Source map upload + breadcrumbs, highest cost-effectiveness |

### 2.3 Database & ORM

| Item | Selection | Reason |
| --- | --- | --- |
| DBMS | **Neon Postgres** | Serverless, branching functionality (dev/stage/prod isolation), free quota enough for MVP |
| ORM | **Prisma** | Schema as documentation; `prisma migrate` migration chain complete; TypeScript types auto-generated |
| Connection Pool | **Neon built-in pooler (`-pooler` endpoint)** | No need for self-built PgBouncer; Serverless functions naturally multi-connection |
| Migration Strategy | `prisma migrate dev` (local) → `prisma migrate deploy` (Vercel build hook) | Zero downtime, versioned, rollbackable |
| Backup | Neon automatic snapshots (7 days, Free Tier) | Enough for MVP stage; upgrade to Pro before GA for 30 days PITR |

### 2.4 Third-party Services

| Service | Purpose | Cost Strategy | Alternative Plan |
| --- | --- | --- | --- |
| **GitHub App** | OAuth login + repository read/write permissions | Free | None (core dependency) |
| **OpenRouter** | Multi-model unified access | Learning period all use `:free` suffix; after GA allow users to bring their own key | Direct connection to OpenAI/Anthropic (abandoned, loses routing flexibility) |
| **Neon** | Postgres | Free Tier; upgrade to Launch Plan before GA | Supabase (alternative) |
| **Vercel** | Deployment | Hobby starting point; upgrade to Pro for commercial use | Cloudflare Pages (alternative, but Next.js adaptation slightly worse) |
| **cloudflared** | Local Webhook debugging | Free | ngrok (free version session limit) |
| **Stripe** (P2) | Subscription billing | Percentage of transaction amount | Paddle (Merchant of Record, compliance saves worry) |
| **Sentry** (P1) | Error monitoring | Free 5k events/month | Vercel native logs (sufficient but no alerts) |

### 2.5 Toolchain

| Item | Selection |
| --- | --- |
| Package Management | **pnpm** (mandatory rule, workspace friendly) |
| Lint | ESLint + `@typescript-eslint` + `eslint-plugin-import` (enforce dependency direction by layer) |
| Formatting | Prettier + `prettier-plugin-tailwindcss` |
| Git Hooks | Husky + lint-staged |
| Commit Convention | Conventional Commits + commitlint |
| Testing | **Vitest** (unit) + **Playwright** (E2E, P1) |

---

## 3. Data Model Design

### 3.1 ER Diagram

```mermaid
erDiagram
    User ||--o{ Installation : owns
    User ||--o{ Session : has
    Installation ||--o{ Repository : includes
    Repository ||--o{ TranslationJob : triggers
    Repository ||--o{ RepoConfig : configures
    TranslationJob ||--o{ FileTranslation : contains
    TranslationJob }o--|| AiModel : uses
    Repository ||--o{ Glossary : owns
    Repository ||--o{ WebhookEvent : receives
    FileTranslation }o--o{ TranslationMemory : contributes

    User {
        string id PK
        int githubId UK
        string login
        string name
        string avatarUrl
        string accessTokenEnc "OAuth token (加密)"
        datetime createdAt
        datetime updatedAt
    }
    Session {
        string id PK
        string userId FK
        string tokenHash UK
        datetime expiresAt
    }
    Installation {
        string id PK
        int githubInstallationId UK
        string userId FK
        string accountLogin
        string accountType "User|Organization"
        datetime suspendedAt "可空"
        datetime createdAt
    }
    Repository {
        string id PK
        int githubRepoId UK
        string installationId FK
        string fullName "仅展示，不做唯一"
        string defaultBranch
        bool private
        bool isEnabled "是否开启自动增量"
        datetime createdAt
    }
    RepoConfig {
        string id PK
        string repositoryId UK
        string[] defaultTargetLangs "用户偏好语言"
        json ignoreGlobs "glob 规则 JSON 数组"
        string glossaryPath ".github/i18n.yaml"
        string branchStrategy "append|new-each"
        int dailyCharLimit
    }
    TranslationJob {
        string id PK
        string repositoryId FK
        string userId FK "触发者"
        string status "pending|running|succeeded|failed|cancelled"
        string trigger "manual|webhook|retry"
        string commitSha "对应的原文 commit"
        string[] targetLangs
        string modelId
        string branchName "i18n/zh-CN-2026xxxx"
        string prUrl
        int totalFiles
        int doneFiles
        int failedFiles
        string errorMessage
        datetime queuedAt
        datetime startedAt
        datetime finishedAt
    }
    FileTranslation {
        string id PK
        string jobId FK
        string repositoryId FK
        string path "README.md"
        string lang "zh-CN"
        string sourceHash "原文 SHA-256"
        string translatedHash "译文 SHA-256"
        int tokensIn
        int tokensOut
        int durationMs
        string status "queued|running|succeeded|failed|skipped"
        string skipReason "hash-match|ignored|oversized"
        string errorMessage
        datetime startedAt
        datetime finishedAt
    }
    AiModel {
        string id PK
        string displayName
        bool isFree
        int contextWindow
        decimal pricePerMTokenIn
        decimal pricePerMTokenOut
        bool enabled
    }
    Glossary {
        string id PK
        string repositoryId FK
        string source "Agent"
        string lang "zh-CN"
        string target "智能体"
        string scope "repo|global"
    }
    WebhookEvent {
        string id PK
        string deliveryId UK "X-GitHub-Delivery"
        string eventType "push|installation|installation_repositories"
        string installationId FK "可空"
        json payload "压缩后的原始载荷"
        string status "pending|processed|failed"
        string errorMessage
        datetime receivedAt
        datetime processedAt
    }
    TranslationMemory {
        string id PK
        string repositoryId FK "可空=全局 TM"
        string sourceLang
        string targetLang
        string sourceText
        string targetText
        string sourceHash UK "sha256(source)"
        int hitCount
        datetime lastUsedAt
        datetime createdAt
    }
```

### 3.2 Prisma Schema (Directly Implementable)

```prisma
// prisma/schema.prisma
generator client {
  provider      = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  directUrl  = env("DATABASE_URL_UNPOOLED") // Neon migration 用非池化连接
  extensions = [pgcrypto, citext]
}

// ---------- 认证 ----------
model User {
  id              String         @id @default(cuid())
  githubId        Int            @unique
  login           String
  name            String?
  email           String?        @db.Citext
  avatarUrl       String?
  accessTokenEnc  String         // AES-256-GCM 加密后的 OAuth token
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  sessions        Session[]
  installations   Installation[]
  jobs            TranslationJob[]

  @@index([login])
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  tokenHash String   @unique           // 存 sha256(opaque token)，cookie 里是原文
  expiresAt DateTime
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

// ---------- GitHub App ----------
model Installation {
  id                    String       @id @default(cuid())
  githubInstallationId  Int          @unique
  userId                String
  accountLogin          String
  accountType           String       // "User" | "Organization"
  suspendedAt           DateTime?
  createdAt             DateTime     @default(now())
  updatedAt             DateTime     @updatedAt

  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  repositories Repository[]

  @@index([userId])
}

model Repository {
  id             String       @id @default(cuid())
  githubRepoId   Int          @unique            // GitHub 侧全局唯一，transfer 后不变
  installationId String
  fullName       String                          // "owner/repo"，展示用，不作唯一键（repo 可 transfer）
  defaultBranch  String       @default("main")
  private        Boolean      @default(false)
  isEnabled      Boolean      @default(false)    // 是否订阅增量翻译（运行态开关，保留在主表）
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  installation  Installation     @relation(fields: [installationId], references: [id], onDelete: Cascade)
  jobs          TranslationJob[]
  files         FileTranslation[]
  config        RepoConfig?
  glossary      Glossary[]
  memories      TranslationMemory[]

  @@index([installationId])
  @@index([fullName])                            // 搜索 / 展示用
}

model RepoConfig {
  id                   String   @id @default(cuid())
  repositoryId         String   @unique
  defaultTargetLangs   String[] @default([])              // 用户偏好的目标语言集合（从 Repository 迁入）
  ignoreGlobs          Json     @default("[]")
  glossaryPath         String   @default(".github/i18n.yaml")
  branchStrategy       String   @default("append")       // "append" | "new-each"
  dailyCharLimit       Int      @default(500000)
  updatedAt            DateTime @updatedAt

  repository Repository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)
}

// ---------- 翻译核心 ----------
model TranslationJob {
  id             String    @id @default(cuid())
  repositoryId   String
  userId         String
  status         String    @default("pending")   // pending|running|succeeded|succeeded_with_errors|failed|cancelled
  trigger        String    @default("manual")    // manual|webhook|retry
  commitSha      String?                          // 触发时的 HEAD SHA
  targetLangs    String[]
  modelId        String
  branchName     String?
  prUrl          String?
  totalFiles     Int       @default(0)
  doneFiles      Int       @default(0)
  failedFiles    Int       @default(0)
  errorMessage   String?
  queuedAt       DateTime  @default(now())
  startedAt      DateTime?
  finishedAt     DateTime?

  repository Repository        @relation(fields: [repositoryId], references: [id], onDelete: Cascade)
  user       User              @relation(fields: [userId], references: [id])
  files      FileTranslation[]

  @@index([status, queuedAt])       // worker 拉任务用
  @@index([repositoryId, queuedAt])
}

model FileTranslation {
  id              String   @id @default(cuid())
  jobId           String
  repositoryId    String
  path            String
  lang            String
  sourceHash      String                       // sha256(原文)
  translatedHash  String?                      // sha256(译文)
  tokensIn        Int      @default(0)
  tokensOut       Int      @default(0)
  durationMs      Int      @default(0)
  status          String   @default("queued")  // queued|running|succeeded|failed|skipped
  skipReason      String?                      // hash-match|ignored|oversized
  errorMessage    String?
  startedAt       DateTime?
  finishedAt      DateTime?
  createdAt       DateTime @default(now())

  job         TranslationJob @relation(fields: [jobId], references: [id], onDelete: Cascade)
  repository  Repository     @relation(fields: [repositoryId], references: [id], onDelete: Cascade)

  // 同一仓库/语言/路径，最新的 sourceHash 唯一 → 增量判断
  @@index([repositoryId, path, lang, createdAt(sort: Desc)])
  // 增量翻译热路径：给定 (repo, path, lang, newHash)，EXISTS 命中 O(1) 跳过
  @@index([repositoryId, path, lang, sourceHash])
  @@index([jobId, status])
}

model Model {
  id                 String   @id                // "z-ai/glm-4.5-air:free"
  displayName        String
  isFree             Boolean  @default(false)
  contextWindow      Int
  pricePerMTokenIn   Decimal? @db.Decimal(10, 4)
  pricePerMTokenOut  Decimal? @db.Decimal(10, 4)
  enabled            Boolean  @default(true)
  updatedAt          DateTime @updatedAt
}

// ---------- 配置与长期资产 ----------
model Glossary {
  id           String   @id @default(cuid())
  repositoryId String
  source       String
  lang         String
  target       String
  scope        String   @default("repo")   // repo|global
  createdAt    DateTime @default(now())

  repository Repository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)

  @@unique([repositoryId, source, lang])
}

model TranslationMemory {
  id           String   @id @default(cuid())
  repositoryId String?                        // null = 全局 TM
  sourceLang   String
  targetLang   String
  sourceText   String   @db.Text
  targetText   String   @db.Text
  sourceHash   String   @unique                // sha256(sourceText + sourceLang + targetLang)
  hitCount     Int      @default(0)
  lastUsedAt   DateTime @default(now())
  createdAt    DateTime @default(now())

  repository Repository? @relation(fields: [repositoryId], references: [id], onDelete: SetNull)

  @@index([sourceLang, targetLang])
}

// ---------- Webhook 审计 ----------
model WebhookEvent {
  id             String   @id @default(cuid())
  deliveryId     String   @unique             // X-GitHub-Delivery（GitHub 保证全局唯一 → 天然幂等 key）
  eventType      String                        // push|installation|installation_repositories|...
  installationId String?
  payload        Json                          // gzip 前先 base64？→ MVP 直存 json 省事
  status         String   @default("pending")  // pending|processed|failed|ignored
  errorMessage   String?
  receivedAt     DateTime @default(now())
  processedAt    DateTime?

  @@index([status, receivedAt])
}
```

### 3.3 Key Field Design Explanation (Why Designed This Way)

| Field | Decision | Reason |
| --- | --- | --- |
| `User.accessTokenEnc` | AES-256-GCM symmetric encryption storage | OAuth token once leaked directly equals user account being stolen; symmetric encryption + `ENCRYPTION_KEY` environment variable separation is the lowest cost solution |
| `Session.tokenHash` | Store hash not plaintext | Even if database is breached, attacker can't login with hash; original token stored in cookie |
| `FileTranslation.sourceHash` | SHA-256(original text) | F-13 incremental judgment core: same `(repositoryId, path, lang)` if new sourceHash matches latest one → skip |
| `WebhookEvent.deliveryId UNIQUE` | Use GitHub's X-GitHub-Delivery as idempotency key | GitHub will redeliver (timeout retries), UNIQUE constraint lets duplicate events be rejected at DB layer |
| `TranslationJob.status` string literal | Not using enum | Rule `code-style.mdc` line 13; migration flexible, Prisma + TS union type still retains type safety |
| `TranslationMemory.sourceHash UNIQUE` | Same text hit O(1) | TM query is translation hot path, index must be extremely simple |
| `Repository.installationId` instead of `userId` | Follow GitHub's permission model | Repository operation rights depend on Installation Token not user token; when Installation is revoked, entire repository automatically invalidates |

---

## 4. Core API Interface Design

### 4.1 Interface Conventions

- **Base URL**: `https://<domain>/api`
- **Authentication**: Cookie `session` → middleware extracts `userId` and injects into `request.ctx`
- **Content Type**: `application/json` (except Webhook, preserved as-is)
- **Input Validation**: **All** use zod schema, validation failure returns 422
- **Error Format**:
  ```json
  { "error": { "code": "REPO_NOT_FOUND", "message": "...", "details": {} } }
  ```
- **Idempotency**: All `POST` accept optional `Idempotency-Key` header, same result returned within 24h for same key

### 4.2 Authentication Domain

| Method | Path | Input | Return | Description |
| --- | --- | --- | --- | --- |
| GET | `/api/auth/github/start` | `?redirect=/dashboard` | 302 | Initiate OAuth, state written to httpOnly cookie to prevent CSRF |
| GET | `/api/auth/github/callback` | `?code&state` | 302 | Exchange token, create session, redirect back |
| POST | `/api/auth/logout` | - | 204 | Clear Session table + expired cookie |
| GET | `/api/auth/me` | - | `{ user }` | Current logged-in user |

### 4.3 Repository Domain

| Method | Path | Input | Return | Description |
| --- | --- | --- | --- | --- |
| GET | `/api/repos` | `?installationId&page&size` | `{ items, nextCursor }` | List repositories authorized by current user (from local DB, periodically synced from GitHub) |
| POST | `/api/repos/sync` | `{ installationId }` | `{ synced: number }` | Manually trigger pulling latest repository list from GitHub |
| GET | `/api/repos/:id` | - | `{ repo, config, glossaryCount }` | Single repository details |
| PATCH | `/api/repos/:id` | `{ isEnabled?, targetLangs?, config? }` | `{ repo }` | Update subscription status / target language / configuration |
| GET | `/api/repos/:id/files` | `?ref` | `{ files: [{ path, size }] }` | Preview all `.md` files in repository (calls GitHub Tree API) |

### 4.4 Translation Task Domain

| Method | Path | Input (zod) | Return | Description |
| --- | --- | --- | --- | --- |
| POST | `/api/jobs` | `{ repositoryId, targetLangs[], modelId?, pathGlob? }` | `{ jobId, totalFiles }` | Create manual task, **only writes to DB**, worker processes asynchronously |
| GET | `/api/jobs/:id` | - | `{ job, progress, files: [{path, lang, status}] }` | Snapshot query, frontend polls every 2s, stops when task reaches final state (succeeded/failed/cancelled) |
| ~~GET `/api/jobs/:id/stream`~~ | - | - | - | **Not done in MVP**: Node Runtime `maxDuration` limit causes SSE disconnection, use short polling instead; evaluate after GA |
| GET | `/api/jobs/:id/files` | `?status&lang` | `{ items }` | Granular view of each file's result |
| POST | `/api/jobs/:id/cancel` | - | `{ job }` | Mark as cancelled; files already running will finish then stop |
| POST | `/api/jobs/:id/retry` | `{ onlyFailed?: boolean }` | `{ newJobId }` | Create retry task based on original task configuration |

### 4.5 Terminology Domain

| Method | Path | Input | Description |
| --- | --- | --- | --- |
| GET | `/api/repos/:id/glossary` | `?lang` | List |
| POST | `/api/repos/:id/glossary` | `{ entries: [{ source, lang, target }] }` | Batch add/overwrite |
| DELETE | `/api/repos/:id/glossary/:entryId` | - | Delete single entry |
| POST | `/api/repos/:id/glossary/sync-from-file` | `{ path: ".github/i18n.yaml" }` | Pull from repository YAML and overwrite (P1) |

### 4.6 Webhook Domain

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/webhooks/github` | GitHub all events entry point, must pass `middleware.ts` for signature verification; **return 200 within 3 seconds**, real logic goes through WebhookEvent async processing |

Whitelist of events to process:

| Event | Processing Logic |
| --- | --- |
| `installation.created` | Store Installation + sync repositories |
| `installation.deleted` | Cascade soft delete (keep history, but mark Installation as `suspendedAt`) |
| `installation.suspend` / `unsuspend` | Update `suspendedAt` |
| `installation_repositories.added/removed` | Sync Repository table |
| `push` (default branch) | If `Repository.isEnabled = true` → create webhook-triggered TranslationJob |
| Others | Ignore |

### 4.7 Worker & Internal Domain

| Method | Path | Protection Method | Description |
| --- | --- | --- | --- |
| POST | `/api/worker/tick` | `x-cron-secret` header verification | Vercel Cron calls every minute; pulls pending tasks to run; **single execution ≤ 50s** (prevent Vercel 60s timeout) |
| POST | `/api/worker/webhooks/drain` | Same as above | Consumes `WebhookEvent` (isolated from translation worker to avoid mutual blocking) |

### 4.8 Server Actions (Form-first Scenarios)

Placed in `app/(dashboard)/_actions/*.ts`, not going through `/api`:

- `createTranslationJobAction(input)` → "Start Translation" button form
- `updateRepoConfigAction(input)` → Repository settings page
- `upsertGlossaryAction(input)` → Terminology editing

**Why Split**: Server Actions come with progressive enhancement (works without JS), first choice for form scenarios; SSE / cross-end calls / Webhooks can only go through REST.

### 4.9 zod schema example (createJob)

```ts
// app/api/jobs/route.ts
import { z } from "zod";

export const createJobSchema = z.object({
  repositoryId: z.string().cuid(),
  targetLangs: z.array(z.enum(["zh-CN", "ja", "es", "fr", "de", "ru"])).min(1).max(7),
  modelId: z.string().optional(),          // 不传走 .env 默认
  pathGlob: z.string().optional(),          // 例："docs/**/*.md"
});

export type CreateJobInput = z.infer<typeof createJobSchema>;
```

---

## 5. Core Algorithms & Key Implementation Decisions

### 5.1 Protective Markdown Translation (F-05 / F-16)

```mermaid
flowchart LR
    A[原文 .md] --> B[remark parse → AST]
    B --> C["遍历 AST：<br/>代码块/行内代码/URL/图片 → 占位符 P1"]
    C --> D[抽出纯文本片段]
    D --> E["分段<br/>(按标题与段落，约 context 上限的 60%)"]
    E --> F[逐段调 OpenRouter]
    F --> G[译文回填占位符]
    G --> H[remark stringify → 新 .md]
    H --> I{AST 对齐校验}
    I -- 通过 --> J[写入仓库]
    I -- 失败 --> K[本文件回滚，记录 errorMessage]
```

**Key Points**:
- Placeholder `{{P1}}/{{P2}}` is 100 times more reliable than "praying the model doesn't modify code blocks"
- AST alignment validation: original/translation AST's "non-text node skeleton" must be completely identical (heading levels, list structure, code block count), otherwise considered destroyed
- When segmenting, retain **last 3 sentences of previous paragraph + first 2 sentences of next paragraph** as context window to avoid proper noun translation drift

**PR Output Strategy (Partial Failure Scenarios)**:
- As long as ≥ 1 file in this task translates successfully, create/update PR; complete failure (0 successful) does not create PR, task marked as `failed`
- PR description uses a table listing each file's status: `✅ 已翻译 / ⏭️ 跳过(hash未变) / ❌ 失败(原因)`
- Failed files have `[重试]` link at end of table row → deep link to `/dashboard/jobs/:id?retry=<filePath>`, one-click create onlyFailed retry task (corresponds to §4.4's `POST /api/jobs/:id/retry`)
- When `TranslationJob.failedFiles > 0`, `status=succeeded_with_errors` (new status value), UI shows yellow badge warning on task card

### 5.2 Concurrency & Rate Limiting

| Scenario | Strategy |
| --- | --- |
| Parallel translation of files within single worker tick | `Promise.allSettled` + `p-limit(5)` (avoid instant burst to OpenRouter) |
| Daily character limit per repository | `RepoConfig.dailyCharLimit`, tasks exceeding limit directly `status=failed, errorMessage='daily_limit_exceeded'` |
| OpenRouter 429 | Exponential backoff 3 times (1s/3s/9s); still fails switch to backup model; still fails mark file failed |
| Task-level lock | No lock, worker uses `FOR UPDATE SKIP LOCKED` to ensure same job not pulled by two ticks simultaneously |

### 5.3 Incremental Translation Core SQL (F-13)

```sql
-- 给定 (repositoryId, path, lang, newSourceHash)，直接探测是否存在已成功的同哈希记录
SELECT EXISTS (
  SELECT 1 FROM "FileTranslation"
  WHERE "repositoryId" = $1
    AND "path" = $2
    AND "lang" = $3
    AND "sourceHash" = $4
    AND "status" = 'succeeded'
) AS hit;
-- 命中则跳过翻译（status='skipped', skipReason='hash-match'）
```

Uses `@@index([repositoryId, path, lang, sourceHash])` composite index, hits O(1); more stable than "get latest one then compare": even if there were historical translation failures, new hash can make correct decision.

---

## 6. Security Design

### 6.1 Authentication & Session

| Item | Solution |
| --- | --- |
| Session Carrier | httpOnly + Secure + SameSite=Lax cookie; `token` = 32 bytes random → `Session.tokenHash = sha256(token)` |
| Validity Period | Sliding 7 days, sensitive operations (like deleting repository) require `within_30min` secondary confirmation |
| CSRF | Server Actions use Next.js native protection; REST POST restricts to same-origin + `Origin` validation |
| XSS | React自带转义; forbid `dangerouslySetInnerHTML`; Markdown rendering uses `react-markdown` + `rehype-sanitize` |

### 6.2 Secret Management

| Category | Storage |
| --- | --- |
| GitHub App Private Key (`.pem`) | Vercel environment variable `GITHUB_APP_PRIVATE_KEY` (base64 encoded into one line), locally placed in `D:\hyd001\secrets\` external directory |
| OAuth Client Secret | `GITHUB_OAUTH_CLIENT_SECRET` environment variable |
| Webhook Secret | `GITHUB_WEBHOOK_SECRET`; verified using `@octokit/webhooks` |
| Database URL | `DATABASE_URL` (pooled) + `DATABASE_URL_UNPOOLED` (migration) |
| OpenRouter API Key | `OPENROUTER_API_KEY` |
| Symmetric Encryption Master Key | `ENCRYPTION_KEY` (32 bytes base64), used to encrypt `User.accessTokenEnc` |
| Cron Invocation Key | `CRON_SECRET`, `/api/worker/*` route strictly verifies |

**Hard Constraints**:
- `.env.local` never enters git (`.gitignore` already covers)
- `.env.example` only writes key names + example formats into git
- `lib/env.ts` validates all required items at startup using zod, missing directly crashes

### 6.3 Webhook Security

- `middleware.ts` for `/api/webhooks/github` **only one** request before release verify `X-Hub-Signature-256` (HMAC-SHA256)
- Return 401 if verification fails, **do not store in DB, do not write log body**
- `X-GitHub-Delivery` UNIQUE prevents replay

### 6.4 Permission Check Matrix (Authorization Model)

Permission check points for each business operation:

| Operation | Verification |
| --- | --- |
| View repository details | `Repository.installation.userId === ctx.userId` |
| Create translation task | Same as above + `Installation.suspendedAt IS NULL` + **`Repository.private === false`** (MVP only public repositories; frontend filters untrusted, backend must reject) |
| View Job | `Job.repository.installation.userId === ctx.userId` |
| Webhook processing | Do not verify user (GitHub identity) → use signature verification + installation_id matching |

Encapsulated in `lib/auth/guards.ts`, each handler calls first line to avoid scattering everywhere.

### 6.5 Data Compliance

| Item | Measures |
| --- | --- |
| Data Minimization | MVP retains original/translated text for debugging; before GA change to only store hash + statistics (aligned with PRD 6.1) |
| GDPR Data Deletion | Provide `/dashboard/settings/delete-account` entry, cascade delete User → Session / Installation / Job's `userId` set to null (retain anonymized metadata needed for audit) |
| Private Repositories | MVP **only allows public repositories** (PRD open issue tends to this solution), frontend filters `private=true` when checking |
| Log Desensitization | pino configures `redact: ['req.headers.authorization', 'req.cookies', '*.accessToken*']` |

---

## 7. Deployment Plan

### 7.1 Environment Topology

```mermaid
flowchart LR
    Dev["本地开发<br/>localhost:3000"] -->|cloudflared tunnel| WebhookURL["https://dev-tunnel.<br/>trycloudflare.com"]
    Dev --> NeonDev[("Neon branch:<br/>dev")]

    Preview["Vercel Preview<br/>(每次 PR 自动)"] --> NeonPreview[("Neon branch<br/>preview + commit 短 SHA")]

    Prod["Vercel Production<br/>github-global.app"] --> NeonProd[("Neon branch:<br/>main")]

    GH["GitHub App"] -.Webhook.-> WebhookURL
    GH -.Webhook.-> Prod
```

- **Neon Branch Strategy**: Each Vercel Preview automatically creates a Neon branch (through Vercel ↔ Neon integration), code merge to main branch then branch automatically destroyed → **Preview environment always has independent database**
- **GitHub App Dual Setup**: `GitHub Global Dev` + `GitHub Global Prod` two Apps, avoid development webhook polluting production data

### 7.2 CI/CD

```mermaid
flowchart LR
    PR["PR 推送"] --> Lint["eslint + tsc --noEmit"]
    Lint --> Test["vitest 单测"]
    Test --> Build["next build + prisma generate"]
    Build --> Preview["Vercel Preview 部署"]
    Preview --> Review["人工 Review"]
    Review --> Merge["合并到 main"]
    Merge --> Migrate["prisma migrate deploy，Vercel build hook"]
    Migrate --> Deploy["Vercel Production 部署"]
    Deploy --> Smoke["E2E smoke，Playwright P1"]
```

> The node text in the above diagram is all wrapped in quotes to avoid **`--noEmit`**'s **`--`** being parsed as flowchart edge syntax (when not wrapped in quotes, it causes the entire diagram to fail to render on GitHub). `next build` and `prisma generate` are usually executed in order within the same build on Vercel.

### 7.3 Environment Variable List (`.env.example`)

```env
# --- 数据库 ---
DATABASE_URL=postgresql://user:pwd@ep-xxx-pooler.neon.tech/db?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://user:pwd@ep-xxx.neon.tech/db?sslmode=require

# --- GitHub App ---
GITHUB_APP_ID=1439734
GITHUB_APP_CLIENT_ID=Iv23liZuUcTmF6FFrSck
GITHUB_APP_CLIENT_SECRET=xxxxxxxxxxxx
GITHUB_APP_PRIVATE_KEY_BASE64=LS0tLS1CRUdJTi...
GITHUB_APP_WEBHOOK_SECRET=xxxxxxxxxxxx

# --- OpenRouter ---
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxx
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
TRANSLATION_MODEL_PRIMARY=z-ai/glm-4.5-air:free
TRANSLATION_MODEL_FALLBACK=qwen/qwen-2.5-72b-instruct:free

# --- 会话 / 加密 ---
ENCRYPTION_KEY=base64:xxxxxxxxxxxx   # 32 bytes
SESSION_SECRET=base64:xxxxxxxxxxxx

# --- Worker ---
CRON_SECRET=xxxxxxxxxxxx

# --- App ---
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 7.4 Vercel Configuration

- **Runtime**: All routes default to Node.js; only `app/(marketing)/` static pages use Edge
- **Function Timeout**: `/api/worker/tick` set to `maxDuration: 60`; others default to 10s
- **Cron Trigger Method (MVP)**: **Do not use Vercel Cron**, instead use **GitHub Actions scheduled task** to `curl` two worker endpoints every minute
  - Reason: Vercel Hobby free version Cron only supports `daily` level, `* * * * *` requires Pro upgrade ($20/month); GitHub Actions is free and unlimited frequency for public repositories
  - After GA, if more reliable scheduling is needed, evaluate upgrading Vercel Pro or migrating to Upstash QStash
- **Worker Endpoint Protection**: `x-cron-secret: $CRON_SECRET` must match, otherwise 401
- **GitHub Actions Configuration** (`.github/workflows/worker-tick.yml`):

  ```yaml
  name: Worker Tick
  on:
    schedule:
      - cron: "* * * * *"   # 每分钟
    workflow_dispatch:
  concurrency:
    group: worker-tick
    cancel-in-progress: false
  jobs:
    tick:
      runs-on: ubuntu-latest
      steps:
        - name: Tick translation worker
          run: |
            curl -fsS -X POST "$APP_URL/api/worker/tick" \
              -H "x-cron-secret: $CRON_SECRET" || true
            curl -fsS -X POST "$APP_URL/api/worker/webhooks/drain" \
              -H "x-cron-secret: $CRON_SECRET" || true
          env:
            APP_URL: ${{ secrets.APP_URL }}
            CRON_SECRET: ${{ secrets.CRON_SECRET }}
  ```

  > Note: GitHub Actions cron minimum granularity is minute, and occasionally has delays during peak hours (worst 5~15 minutes), MVP can accept.

### 7.5 Credential Management Matrix

Strictly isolate credentials across three environments to avoid "development accidentally writing to production" accidents:

| Environment | GitHub App | Neon Postgres | Webhook Tunnel | Variable Storage |
| --- | --- | --- | --- | --- |
| **Local Development** | `GitHub Global Dev` App | Neon branch `dev` | `cloudflared tunnel` temporary domain | `.env.local` (`.gitignore`屏蔽) |
| **Vercel Preview** | Same Dev App | Neon branch `preview-<sha>` (Vercel-Neon integration auto creates/deletes) | Vercel Preview domain | Vercel Preview Environment Variables |
| **Vercel Production** | `GitHub Global Prod` App | Neon branch `main` | Custom domain (e.g. `github-global.app`) | Vercel Production Environment Variables |

**Hard Constraints**:
- Two GitHub Apps (Dev / Prod) have separate `APP_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `PRIVATE_KEY`, `WEBHOOK_SECRET`, **not shared**
- `CRON_SECRET`, `ENCRYPTION_KEY` three environments **each independently generated**, not reused across environments
- Vercel environment variables configured by Environment dimension (Development / Preview / Production)
- `.pem`, `D:\hyd001\secrets\` three environments **each independent**, not reused across environments
- `base64 -w0` private key original text only kept locally in `GITHUB_APP_PRIVATE_KEY_BASE64`; before entering Vercel, use `@sentry/nextjs` to compress into single line and put into `TranslationJob`

### 7.6 Observability

| Layer | Solution | Stage |
| --- | --- | --- |
| Request Logs | Vercel Logs (default) | MVP |
| Structured Logs | pino → stdout → Vercel Logs | MVP |
| Error Monitoring | Sentry `@sentry/nextjs` | P1 |
| Business Metrics | `TranslationJob` / `FileTranslation` direct SQL query → Grafana Cloud (free plan) | P1 |
| Alerts | Sentry alert emails + Vercel deployment failure webhook | P1 |
| Audit | `WebhookEvent` + `TranslationJob` table as audit log | MVP |

---

## 8. Directory Structure Convention (Start with This Skeleton)

```
Document translation/
├── app/
│   ├── (marketing)/              # 未登录公开页（静态，Edge）
│   │   ├── page.tsx              # 首页
│   │   └── pricing/page.tsx
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── (dashboard)/              # 需要登录，走 middleware 保护
│   │   ├── layout.tsx
│   │   ├── repos/
│   │   │   ├── page.tsx
│   │   │   └── [id]/
│   │   │       ├── page.tsx
│   │   │       └── settings/page.tsx
│   │   ├── jobs/
│   │   │   └── [id]/page.tsx
│   │   └── _actions/             # Server Actions
│   ├── api/
│   │   ├── auth/
│   │   │   └── github/
│   │   │       ├── start/route.ts
│   │   │       └── callback/route.ts
│   │   ├── repos/
│   │   ├── jobs/
│   │   ├── webhooks/github/route.ts
│   │   └── worker/
│   │       ├── tick/route.ts
│   │       └── webhooks/drain/route.ts
│   └── layout.tsx
├── middleware.ts                 # ⚠️ 根目录，和 app/ 平级；会话注入 + webhook 签名校验
├── lib/
│   ├── env.ts                    # zod 校验所有环境变量
│   ├── db.ts                     # PrismaClient 单例
│   ├── auth/
│   │   ├── index.ts
│   │   ├── oauth.ts
│   │   ├── session.ts
│   │   └── guards.ts
│   ├── github/
│   │   ├── index.ts
│   │   ├── app-client.ts         # @octokit/app 封装
│   │   ├── installation.ts
│   │   ├── repo.ts               # 列文件、读文件、创建分支/PR
│   │   └── webhooks.ts
│   ├── translator/
│   │   ├── index.ts
│   │   ├── openrouter.ts
│   │   ├── markdown-protect.ts   # remark AST 保护
│   │   ├── chunk.ts              # 分段策略
│   │   ├── prompt.ts
│   │   └── validator.ts          # AST 对齐校验
│   ├── queue/
│   │   ├── index.ts
│   │   ├── enqueue.ts
│   │   ├── worker.ts
│   │   └── webhook-consumer.ts
│   └── vcs/                      # P1: GitHub/GitLab/Gitee 适配器抽象
├── components/
│   ├── ui/                       # shadcn 生成
│   ├── repos/
│   ├── jobs/
│   └── shared/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── docs/
│   ├── PRD.md
│   ├── TechDesign.md             # 本文件
│   └── handoff-*.md
├── tests/
│   ├── unit/
│   └── e2e/                      # P1
├── .cursor/rules/
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── next.config.mjs
├── tailwind.config.ts
├── vercel.json
└── README.md
```

---

## 9. Implementation Roadmap (Aligned with PRD Milestones)

| Phase | Aligned PRD | Corresponding Section in This Document | Technical Deliverables |
| --- | --- | --- | --- |
| **M0 Scaffold** | Week 1 | §2 + §7 + §8 | Next.js **16** init, Prisma **6** init, Tailwind **v4**, shadcn init, env validation, `lib/db.ts`, CI running |
| **M1 Core Path** | Weeks 2-3 | §3 (User/Installation/Repository) + §4.2 + §4.3 | OAuth login working, GitHub App installation callback, repository list display |
| **M2 MVP** | Weeks 4-6 | §3 (TranslationJob/FileTranslation) + §4.4 + §4.7 + §5.1 | Manual translation trigger, worker closed loop, PR creation |
| **M3 Beta** | Week 7 | §7.1 + §7.2 | Production deployment, Prod App creation, 20 seed users |
| **M4 Incremental** | Weeks 8-10 | §4.6 + §5.3 | Webhook + hash comparison + terminology |
| **M5 Monetization** | Weeks 11-14 | (Not expanded in this document, subsequent DesignDoc added) | Stripe, usage dashboard |

When each phase is completed, check the corresponding section in this document; if there are changes, add a "v1.x change description" subsection at the end of the section, do not delete old content.

---

## 10. Decision Record (Locked, Effective in v1.1)

| Number | Issue | ✅ Decision | Impact Scope |
| --- | --- | --- | --- |
| TD-01 | Does MVP allow private repositories? | **No, only public repositories**. Backend must强制校验 `Repository.private === false` when creating task, frontend only does UX filtering | §6.4 Authorization Matrix, §6.5 Compliance |
| TD-02 | Terminology storage location? | **Repository内 `.github/i18n.yaml` + platform DB bidirectional sync**, repository YAML as authoritative source, platform UI as editing entry | §4.5 + new `/api/repos/:id/glossary/sync-from-file` |
| TD-03 | Translation PR append to same branch or new each time? | **Append to same branch** (`RepoConfig.branchStrategy = "append"` as default); `new-each` retained as advanced option, UI not exposed yet | §5.1 Output Path |
| TD-04 | Introduce Sentry in M2? | **No, connect in M3 Beta**. M0/M1/M2 use Vercel Logs + pino structured logs as fallback | §7.6 Observability Rhythm |
| TD-05 | Split Worker into independent Vercel project? | **No, MVP same project triggered by GitHub Actions scheduled cron**; before GA evaluate migration to Inngest / QStash and split into independent Worker project | §1.1 Architecture Evolution, §7.4 Cron Solution |
| TD-06 | Worker scheduled trigger method | **GitHub Actions `* * * * *` cron → curl `/api/worker/tick` and `/api/worker/webhooks/drain`** (Vercel Hobby doesn't support per-minute cron, switch back after Pro upgrade) | §7.4 |
| TD-07 | Translation progress frontend real-time | **MVP frontend 2s short polling** `/api/jobs/:id`; SSE pushed to GA for evaluation (Serverless `maxDuration` limit makes long SSE connections unreliable) | §2.1 Frontend, §4.4 API |
| TD-08 | Free translation model selection | **Main model `z-ai/glm-4.5-air:free`, backup `qwen/qwen3-next-80b-a3b-instruct:free`, `openai/gpt-oss-120b:free`**. DeepSeek `:free` has been delisted, avoid using | §2.4, `.env.example` |

---

## 11. Document Maintenance

- This file = Construction blueprint. **Any technology selection / data model changes must first change this file, then change code**,把关 through PR review
- Division of labor with PRD: PRD explains "why to do, what to do", this file explains "how to do, what to use"
- For major version changes (v1 → v2), keep old version in `docs/archive/TechDesign-v1.md`

### v1.2 Change Description (2026-04-22, M0 Scaffold实测对齐)

| Item | Original Document Expression (v1.1) | Repository Actual (based on `package.json`) | Handling |
| --- | --- | --- | --- |
| Next.js | Multiple places written as **15** | **16.2.4** (`create-next-app@latest` default) | Unified to **16** throughout; architecture diagram subgraph updated |
| React / Tailwind | Minor versions not pinned | **React 19.2.x**, **Tailwind CSS v4** (PostCSS plugin chain) | §9 M0 deliverables补充 |
| Prisma | §3.2 example is generic writing | **Prisma 6.19.x**; **not** following Prisma 7 (`schema.prisma` no longer writes `url` / `directUrl` inside) | M0~M2 lock to 6.x; upgrade to 7 requires separate design change |
| shadcn | Radix expression as main | Current is **base-nova + `@base-ui/react`** (CLI default preset) | Tech stack still expressed as "shadcn/ui ecosystem"; component implementation based on generated code |
| lucide-react | No version pinned | Must use **official `0.4xx`**; do not use npm **`^1.8.0` homonymous package** (missing `Github` etc. exports) | Written into rules / handoff, avoid stepping on pit again |

> This TechDesign **v1.2** is consistent with current repository M0 implementation; §10 TD-01~08 still effective. Only change version number and "change description" in future, do not delete v1.1 historical conclusions.

### v1.2 Addition (2026-04-23, Document Readability)

- **§1.2**: Added **1.2.0** (three paths overview table, sequence diagram symbols explanation, Mermaid notes); added plain language explanation, participant table, step-by-step/dual timeline table after each **1.2.1～1.2.3** section, each with an additional **supplementary** flow diagram (coexists with original sequence diagram for linear reading).
- **§1.3**: Added **1.3.0**, comparison table with §1.2, layering responsibility table, dependency rules table and "vertical slice" example explanation; **did not modify** original container layering diagram, only added text and table interpretation.

### v1.2 Addition (2026-04-23, GitHub Mermaid Compatibility)

- Corrected **§1.1** subgraph id (`GH_Platform` / `OR_Platform`) to match `class` reference; `&` changed to "and".
- **§1.2.2** sequence diagram: `/api/jobs/:id` → `{id}`; `i18n/<lang>-<ts>` → pure text branch name description.
- **§1.2.3** supplementary flow diagram: `API[/api/webhooks/github]` changed to quoted rectangle node to avoid trapezoid syntax conflict with path slashes.
- **§3.1** ER: `Model` → `AiModel`; `repositoryId FK,UK` → single line `UK`; simplified `ignoreGlobs` and model id example string.
- **§5.1** flow diagram: removed `{{P1}}` double curly braces from node text.
- **§7.1**: `preview-<sha>` changed to description without angle brackets.
- **§7.2**: CI/CD flow diagram `Lint[eslint + tsc --noEmit]` not quoted causing **`--`** to be parsed as edge syntax; changed to all **`id["…"]`** nodes and omitted error-prone `<br/>`.
- Added Cursor rule **`.cursor/rules/docs-mermaid-github.mdc`**, follow this file when modifying Mermaid in `docs/**/*.md` later.