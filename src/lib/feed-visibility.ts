// Pure visibility filter for the global activity feed.
//
// Rule (see spec §2B): a rating enters the global feed only when the
// rater's visibility is 'public'. Non-public users appear only to
// people they've explicitly friended. Per-rating opt-outs remove
// specific rating_ids from the feed.

export type Visibility = "private" | "followers" | "public";

export type FeedCandidate = {
  rating_id: string;
  user_id: string;
};

export type Rater = {
  user_id: string;
  visibility: Visibility;
};

export function filterFeedByVisibility(args: {
  candidates: FeedCandidate[];
  raters: Rater[];
  viewerId: string;
  friendIds: Set<string>;
  optoutRatingIds: Set<string>;
}): FeedCandidate[] {
  const vis = new Map(args.raters.map((r) => [r.user_id, r.visibility]));
  return args.candidates.filter((c) => {
    if (args.optoutRatingIds.has(c.rating_id)) return false;
    if (c.user_id === args.viewerId) return false;
    const v = vis.get(c.user_id);
    if (!v) return false;
    if (v === "public") return true;
    // Non-public: only surface to friends of the rater.
    return args.friendIds.has(c.user_id);
  });
}
