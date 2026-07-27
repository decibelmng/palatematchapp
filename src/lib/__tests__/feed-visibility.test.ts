import { describe, it, expect } from "vitest";
import { filterFeedByVisibility, type FeedCandidate, type Rater } from "@/lib/feed-visibility";

const raters: Rater[] = [
  { user_id: "priv",   visibility: "private" },
  { user_id: "follo",  visibility: "followers" },
  { user_id: "pub",    visibility: "public" },
];
const candidates: FeedCandidate[] = [
  { rating_id: "r-priv",  user_id: "priv" },
  { rating_id: "r-follo", user_id: "follo" },
  { rating_id: "r-pub",   user_id: "pub" },
];

describe("filterFeedByVisibility", () => {
  it("only surfaces public raters to strangers", () => {
    const out = filterFeedByVisibility({
      candidates, raters,
      viewerId: "me",
      friendIds: new Set(),
      optoutRatingIds: new Set(),
    });
    expect(out.map((r) => r.rating_id)).toEqual(["r-pub"]);
  });

  it("surfaces non-public raters when the viewer is a friend", () => {
    const out = filterFeedByVisibility({
      candidates, raters,
      viewerId: "me",
      friendIds: new Set(["follo"]),
      optoutRatingIds: new Set(),
    });
    expect(out.map((r) => r.rating_id).sort()).toEqual(["r-follo", "r-pub"]);
  });

  it("respects per-rating opt-outs even for public raters", () => {
    const out = filterFeedByVisibility({
      candidates, raters,
      viewerId: "me",
      friendIds: new Set(),
      optoutRatingIds: new Set(["r-pub"]),
    });
    expect(out).toEqual([]);
  });

  it("never returns the viewer's own ratings", () => {
    const out = filterFeedByVisibility({
      candidates: [{ rating_id: "self", user_id: "me" }, ...candidates],
      raters: [...raters, { user_id: "me", visibility: "public" }],
      viewerId: "me",
      friendIds: new Set(),
      optoutRatingIds: new Set(),
    });
    expect(out.map((r) => r.rating_id)).toEqual(["r-pub"]);
  });
});
