# Wearable app and AI coach complaints

Data: 265 tagged items in `appstore_forums.jsonl`. 203 are 1-2 star US App Store reviews and 62 are Garmin forum or DC Rainmaker comments (2024-26).

Caveats: the Apple feed was flaky. COROS returned nothing and Garmin only 50 reviews. Fitbit's Google Health migration accounts for 41% of the low ratings.

## App Store (n=203)

| Pain | Count | Share | Excl. Fitbit |
|---|---|---|---|
| sync_app_reliability | 77 | 38% | 33% |
| other (UX/navigation regressions) | 54 | 27% | 23% |
| accuracy | 32 | 16% | 16% |
| subscription_cost | 16 | 8% | 13% |
| hardware_battery | 8 | 4% | 6% |
| data_access, ai_coach_quality | 6 each | 3% | 2-4% |

**Sync and reliability.** "What good is health tracking if you can't view the data on the app." / "It fails to load activities around 90% of the time." (Garmin)
*Want:* the data present every morning, and updates that don't break what worked.

**UX regressions.** "Want to see yesterday's summary? Too bad, it's impossible." (Fitbit) / "a maze with poor information architecture, feature bloat" (Garmin)
*Want:* one glanceable daily view.

**Accuracy.** "Oura repeatedly marks me awake when I was asleep… Bedtime and wake-up edits are not enough" / "Feedback seems to be on a roulette wheel." (WHOOP)
*Want:* to correct wrong data themselves, and scores that match how they feel.

**Subscription.** "Your ring is expensive and is nothing without subscriptor" (Oura) / "hides it behind a paywall" (Strava)
*Want:* to own their data once they've paid for the hardware.

## Power users (n=62)

| Pain | Count | Share |
|---|---|---|
| ai_coach_quality | 14 | 23% |
| subscription_cost | 12 | 19% |
| data_access | 11 | 18% |
| insight_quality | 10 | 16% |
| accuracy | 10 | 16% |
| other | 5 | 8% |

**AI and insights.** "all Garmin does is using AI to simply rephrase existing data." / "missing all the possibility to put training data in a bigger context."
*Want:* contextual training analysis. A few good insights a month is enough.

**Data access.** "Shame that the Personal API key is read-only." / "No MCP (both read and write) is also a miss."
*Want:* read and write API access, with AI use of their own data allowed.

**Accuracy cascade.** Wrong sleep detection skews HRV, which skews readiness and then the suggested workout: "my marathon block is being sabotaged". Users add: "Garmin is really vague on all it's calculations".
*Want:* transparent formulas and the ability to override inputs.

## Paid AI tiers

- **Garmin Connect+:** almost entirely negative. Users see it as rephrased old Insights, and one reported "misses the tempo and sprints". Some object to their data being used to train the models. Food logging is the only part users praise.
- **Strava:** "AI insights' that just repeat platitudes". Users want an off switch.
- **WHOOP Coach:** "the AI can't create anything that it's supposed to"
- **Fitbit coach:** "i'd rather jump off a bridge than use an 'Ai coach'"
- **Oura Advisor:** not mentioned in any review. Oura users complain about the subscription itself.

## What 5-star reviews value

- **WHOOP:** behaviour change ("led me to quit alcohol completely").
- **Oura:** understanding their body. One user showed the reports to a doctor and started CPAP.
- **Garmin:** breadth of tracking.
- **Polar:** a free HR-based training plan.
- **Strava:** community.

## Surprising findings

1. Power users already do the job themselves: they export FIT files to CSV and analyse them in Gemini, and say it beats Connect+. Garmin's personal API drew immediate requests for MCP access.
2. LLM-written support replies make users feel patronised.
3. The top accuracy ask is the ability to edit data, not better sensors.
4. Happy WHOOP users praise habits they changed. Unhappy users of every app complain about metrics.
5. Metric shifts that updates leave unexplained erode trust more than crashes do.
