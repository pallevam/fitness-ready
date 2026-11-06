# Reddit: wearable and AI-coach complaints (Dec 2025 to Sep 2026)

**Method and caveats.** Reddit blocks unauthenticated reads (403 errors, and the JSON endpoints redirect to login). I sampled about 240 snapshots of the subreddits' "new" feeds from a public archive (reddit.sentinel-team.org), which gave 2,647 posts. I hand-tagged 196 complaints, 8 of them top comments. Scores are as captured, often hours after posting, so they **understate** final upvotes. Treat counts as directional. r/running and r/AdvancedRunning rarely discuss devices (9 items). Data: `reddit.jsonl`.

| # | Pain | n | share | upvotes (sum / median) |
|---|---|---|---|---|
| 1 | accuracy | 43 | 22% | 1,715 / 14 |
| 2 | insight_quality | 39 | 20% | 3,979 / 14 |
| 3 | ai_coach_quality | 29 | 15% | 803 / 8 |
| 4 | hardware_battery | 20 | 10% | 1,426 / 20 |
| 5 | sync_app_reliability | 16 | 8% | 1,015 / 18 |
| 6 | other | 15 | 8% | 1,003 / 13 |
| 7 | data_access | 14 | 7% | 447 / 17 |
| 8 | behaviour_change | 9 | 5% | 2,096 / 117 |
| 9 | subscription_cost | 7 | 4% | 1,024 / 78 |
| 10 | privacy | 4 | 2% | 38 / 12 |

**Accuracy.** Wrong activity detection, missed naps, HR during lifting, VO2max and calories. Users want honest confidence and the ability to correct the data.
- "Sometimes I have sex... it suggests: Maybe: Walking" ([303](https://www.reddit.com/r/ouraring/comments/1s82mp9/))
- "my heart rate data has apparently been inaccurate for a long time due to a 'bug'... Support literally admitted they cannot retroactively fix" ([89](https://www.reddit.com/r/whoop/comments/1tj4ok8/))

**Insight quality.** Scores that contradict how people feel, and no "why" behind them. Users want explanations tied to their own data, and a decision they can act on.
- "sleep score 72" after a perfect night ([2,151](https://www.reddit.com/r/Garmin/comments/1t4p7ku/))
- "Most days I look at my readiness score, acknowledge it, and do what I was planning anyway." ([r/running](https://www.reddit.com/r/running/comments/1qoezw4/))
- "It tracks everything but never tells me why anything changed" ([QS](https://www.reddit.com/r/QuantifiedSelf/comments/1t3i20u/))

**Behaviour change.** Few posts but very high upvotes, about anxiety from the data.
- "Stressed out about stress data." ([1,017](https://www.reddit.com/r/Garmin/comments/1vly50p/))

**Subscription.** Price is grudgingly accepted. People resent dark patterns and paywalls on their own data.
- "pay to see my yearly recap?... It's literally data already in my device" ([384](https://www.reddit.com/r/Garmin/comments/1pe1m9w/))
- "making it so difficult for people to cancel" ([216](https://www.reddit.com/r/whoop/comments/1tis009/))
- Press coverage, not verified here, cites r/Garmin Connect+ threads at 7k-11k upvotes.

## Vendor AI coaches
- **Whoop Coach:** the most complaints, about 15. It gets the date and stale data wrong ("pulled strain from April 9", [19](https://www.reddit.com/r/whoop/comments/1tj7so2/)). It asks for data it already has. One reply: "it said it was using general data instead of my own information." It also has a pushy "sales guy" habit of proposing plans, and it ignores memory instructions ([link](https://www.reddit.com/r/whoop/comments/1tukbhr/)). It has defenders, though: one top comment (44) praises its memory and actionability.
- **Fitbit/Google Health Gemini coach:** "It hallucinates all the time... the 'coach' is in a different world" ([63](https://www.reddit.com/r/fitbit/comments/1tjddsd/)). It made up form-analysis stats, and plans change from session to session. Meanwhile one "this app is legit" post scored 201.
- **Oura Advisor:** "has nothing specific to tell me". It says it can't see cycle data that the app itself tracks.
- **Garmin Coach / Active Intelligence:** "it's just going to tell you shit you can already see but say 'keep it up!'" ([154](https://www.reddit.com/r/Garmin/comments/1pe1m9w/)). Coach plans are seen as rigid ([338](https://www.reddit.com/r/Garmin/comments/1pe8rb6/)).

**What users want from AI:** grounded in their actual current data, no invented facts, quiet unless asked, able to remember instructions, and able to read cross-app data (nutrition, lifting).

## DIY LLM pipelines (strong signal for tech users)
- Hourly Python pulls from Garmin and Hevy into a Gemini Gem, because "Gemini gives generic advice because it lacks context" ([124](https://www.reddit.com/r/Garmin/comments/1pvunsi/))
- A Whoop dashboard built with Claude ([56](https://www.reddit.com/r/whoop/comments/1t6b83a/))
- An Oura CLI with a SQLite cache for agents ([17](https://www.reddit.com/r/ouraring/comments/1tja6y1/))
- A Whoop private-API MCP server (36) and NOOP, a local-first Whoop app ([135](https://www.reddit.com/r/whoop/comments/1u22paj/))
- A third-party analysis of 7.4k posts counted 122 posts about pasting wearable data into ChatGPT or Claude ([verum-research](https://verum-research.pages.dev/wearable-data))

## Surprising findings
1. The most upvoted complaints are jokes about scores contradicting how people feel, not about raw sensor error. Trust in the score is the product.
2. People want the AI coach to say *less*. Unprompted plans and follow-up questions are a top Whoop complaint.
3. Tech users route around the vendor coach. They build their own data pipelines and use general-purpose LLMs, which they find better because they control the context.
4. r/QuantifiedSelf mods are pushing back on "vibe-coded health app" spam ([37](https://www.reddit.com/r/QuantifiedSelf/comments/1s05r29/)). Another dashboard won't stand out.
5. Data-access pain shows up as posts about building workarounds, not as complaints, so complaint counts understate it.
