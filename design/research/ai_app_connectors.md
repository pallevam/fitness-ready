# AI-app connectors: scheduling, mobile, distribution, auth (checked 2026-11-13)

OpenAI help-center quotes are search-index excerpts (pages returned 403); recheck live.

| # | Claim | ChatGPT | Claude |
|---|---|---|---|
| 1/2 | Scheduled prompts exist on mobile | Confirmed (Free has limits) | Confirmed (paid plans only, Cowork) |
| 1/2 | Scheduled run can call a *third-party custom* MCP connector | **Unclear** (docs name only "supported apps" such as Gmail/Slack/GitHub) | Confirmed in substance ("any connectors… set up in Cowork") |
| 1/2 | Push notification on run | Confirmed (Push/Email setting) | Unclear for scheduled runs specifically |
| 3 | Custom remote MCP usable from phone | Unclear (desktop/web for setup; full MCP on Business/Ent) | Confirmed (add on web, use on iOS/Android; Free = 1 custom connector) |
| 4 | Public directory with review + privacy policy | Confirmed; **PHI banned** | Confirmed; healthcare is "high-risk" |
| 5 | OAuth | Confirmed (OAuth 2.1, PKCE, CIMD/DCR) | Confirmed (OAuth 2.0; auto-register or own client) |

## Quotes

**ChatGPT (help.openai.com/en/articles/10291617)**
- "Scheduled tasks can use supported apps, including Gmail, Slack, and GitHub, when those apps are available for your account or workspace."
- "Active task limits depend on the plan: 3 for Free and Go, 5 for Plus, 10 for Business and Edu, and 15 for Pro and Enterprise."
- "To manage task notifications, go to Settings > Notifications and select Push, Email, or both."
- (help.openai.com/en/articles/12584461) Excerpt: full MCP is "only available to Business and Enterprise/Edu users"; "Pro users can connect custom MCP servers with read/fetch permissions."
- (developers.openai.com/apps-sdk/app-submission-guidelines/) "All plugin submissions must come from verified individuals or organizations"; "must include a clear, published privacy policy"; "Do not collect, solicit, or process… Protected health information (PHI)".
- (developers.openai.com/apps-sdk/build/auth) "implement an OAuth 2.1 flow that conforms to the MCP authorization spec"; "authorization code + PKCE flow"; "Prefer providers that support CIMD… DCR is still supported."

**Claude**
- (support.claude.com/en/articles/13854387) "Scheduled tasks run remotely, so they run on their cadence even when your computer is asleep"; tasks use "any connectors and plugins you've set up in Cowork."
- (support.claude.com/en/articles/15520349) Web and mobile: "Pro, Max, Ultra, and Team plans (in beta on Team)"; "When Claude finishes a task or needs your input, you'll get a notification on your phone." (not scheduled-specific)
- (support.claude.com/en/articles/11176164) Once connected on web/desktop, a connector "will be available to use the next time you log in to your account on Claude for iOS or Android"; "Free users are limited to one custom connector."
- (support.claude.com/en/articles/11175166) OAuth client options: "Use Claude's published identity (Recommended)," "Register automatically," or "Use your own OAuth client."
- (support.claude.com/en/articles/13145358) "must use secure OAuth 2.0"; "must provide a clear, accessible privacy policy link"; "high-risk use cases around legal, healthcare…". Submission: claude.com/docs/connectors/building/submission.

## Implications for proactive delivery and distribution

- **Claude is the safer first target for the morning brief.** Remote runs and connector use are documented, but paid plans only.
- **Treat ChatGPT scheduled brief + our connector as unproven.** The docs list only first-party "supported apps". Test it with a real Plus account before promising it.
- **"Not PHI" must be a defensible position.** OpenAI bans PHI by contract, and Anthropic treats healthcare as high-risk (human-in-the-loop and disclosure). Consumer wearable data from a non-covered entity is probably not PHI. (commentary; confirm with counsel).
- **One OAuth 2.1 + PKCE server with CIMD/DCR serves both platforms.** Review needs a privacy policy, a verified publisher, a test account and readOnlyHint annotations.
- **Phone-first works for usage, not setup.** Users add the connector on web/desktop, then use it on the phone.
