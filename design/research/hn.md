# HN: what tech users complain about in wearables

245 complaints from Hacker News, 2024-2026: 235 comments and 10 story titles. Rows are in `hn.jsonl`. **Pts** is the summed score of the distinct threads in each cluster, because comments have no public score.

| Pain | n | Share | Pts |
|---|---|---|---|
| data_access | 59 | 24% | 10,639 |
| subscription_cost | 29 | 12% | 7,006 |
| accuracy | 29 | 12% | 6,293 |
| insight_quality | 25 | 10% | 3,053 |
| sync_app_reliability | 25 | 10% | 4,406 |
| hardware_battery | 24 | 10% | 2,622 |
| other (mostly Garmin UX) | 23 | 9% | 4,164 |
| privacy | 17 | 7% | 3,025 |
| behaviour_change | 8 | 3% | 1,563 |
| ai_coach_quality | 6 | 2% | 996 |

## 1. Data access and lock-in
- "196 json files (228mb) which are just high-level summaries." [↗](https://news.ycombinator.com/item?id=42919353)
- "resorting to tls fingerprinting to prevent unofficial logins to their api" [↗](https://news.ycombinator.com/item?id=48320373)

**Want:** a personal API or local sync that includes the 24/7 metrics.

## 2. Subscriptions
- "being told you have to pay $99 to read your own data." [↗](https://news.ycombinator.com/item?id=50110675)
- "that's a rental model" [↗](https://news.ycombinator.com/item?id=41836902)

**Want:** pay once for the hardware, and never pay to reach their own data.

## 3. Accuracy
- "Nights that I tossed and turned and was up multiple times would score highly." [↗](https://news.ycombinator.com/item?id=49390952)
- "Calorie counting on apple is off by 2-5x" [↗](https://news.ycombinator.com/item?id=42782126)

**Want:** error bars and validation against a reference such as a chest strap.

## 4. Insight quality
- "many fitness tracker brands invent their own metrics." [↗](https://news.ycombinator.com/item?id=43371792)
- "The advice it gives is like shaking a magic 8-ball." [↗](https://news.ycombinator.com/item?id=49796655)

**Want:** see how a score is computed from raw HRV and resting heart rate, and what to change.

## 5. Sync and app reliability
- "It is not even possible to see local data on the phone." [↗](https://news.ycombinator.com/item?id=42633094)
- "Watch ->(Bluetooth)-> Phone ->(LTE/WiFi) -> Garmin Cloud" [↗](https://news.ycombinator.com/item?id=45167514)

**Want:** offline-first sync, so the cloud is optional.

## 6. Hardware and battery
Mostly Apple Watch's one-day battery, which rules out sleep tracking, and Oura batteries that die after 1-2 years.

**Want:** a battery that lasts a week or more and devices built to last.

## 8. Privacy
- "You send Claude your Garmin data and Anthropic will keep it for literally years." [↗](https://news.ycombinator.com/item?id=50101279)

**Want:** a local LLM, or explicit control over what leaves the device.

## 9 and 10. Behaviour change and AI coaches
- "it doesn't tell me anything that my own body isn't telling me" [↗](https://news.ycombinator.com/item?id=49716855)
- "Recovery and Strain scores are made up" [↗](https://news.ycombinator.com/item?id=48147348)
- "those tools have zero context on my goals / preferences" [↗](https://news.ycombinator.com/item?id=46977672)

**Want:** a coach that knows their history, goals and injuries and makes one concrete call for the day.

## Surprises
1. **Garmin is loved for its hardware and hated as a platform.** It accounts for 25 of the 59 data-access complaints.
2. **Vendor AI is resented.** Garmin Connect+ AI is "the most absurd AI slop" [↗](https://news.ycombinator.com/item?id=43774518), and Strava's AI was "useful in no way at all" [↗](https://news.ycombinator.com/item?id=44494503).
3. **The biggest thread was a sync paywall, not a device.** Withings charging $99 a year for Apple Health sync drew 406 points and 293 comments.
4. **Some people sleep better after they stop tracking**, which points to anxiety about sleep scores. [↗](https://news.ycombinator.com/item?id=49280179)

## Unmet wants (people are already building these themselves)
- Exporting Garmin data to SQLite or Notion and having Claude decide "when and how hard to workout". [↗](https://news.ycombinator.com/item?id=50100887)
- "a cron that runs on my homelab that pulls my health data into a DB I own" [↗](https://news.ycombinator.com/item?id=49087357)
- People say they'd pay "$400-500 up front" for a Whoop-like strap with no subscription. [↗](https://news.ycombinator.com/item?id=42851272)
