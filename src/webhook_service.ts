import axios from 'axios';
import { sessionManager } from './session';
import { getAccount } from './database';

// Memory cache to prevent duplicate notifications for the same event
const processedStories = new Set<string>();

export default async function pushWebhook(username: string, payload: { event: 'OUTGOING_ACTION' | 'POLL_ACTIVITY', [key: string]: any }) {
    try {
        const acc = await getAccount(username);
        if (!acc || !acc.webhook) return;

        let finalPayload: any = {
            airoza_bot: username,
            timestamp: Date.now(),
            ...payload
        };

        // If it's a polling event, fetch a detailed snapshot: Notifications + Per-Post Stats
        if (payload.event === 'POLL_ACTIVITY') {
            const bot = sessionManager.getSession(username);
            if (!bot) return;

            // 1. Fetch Real-time Notifications
            const activity = await bot.getActivityFeed();
            if (!activity) return;

            // Filter for recent (120s) and deduplicate
            const rawStories = [...(activity.new_stories || []), ...(activity.old_stories || []), ...(activity.stories || [])];
            const nowSec = Math.floor(Date.now() / 1000);

            const recentStories = rawStories.filter((story: any) => {
                const ts = story.args?.timestamp || 0;
                if ((nowSec - ts) > 120) return false;
                const key = `${username}_${story.pk || story.args?.timestamp || Math.random()}`;
                if (processedStories.has(key)) return false;
                processedStories.add(key);
                if (processedStories.size > 10000) processedStories.clear();
                return true;
            });

            // 2. Fetch Detailed Media Stats (Per Posting)
            let postsData: any[] = [];
            let accountSummary: any = { followers: 0, following: 0, posts: 0 };

            try {
                const profile = await bot.getUserMedia(username);
                if (profile) {
                    accountSummary.followers = profile.edge_followed_by?.count || profile.follower_count || 0;
                    accountSummary.following = profile.edge_follow?.count || profile.following_count || 0;
                    accountSummary.posts = profile.edge_owner_to_timeline_media?.count || profile.media_count || 0;

                    // Support both Web API (edges) and Mobile API (items)
                    const edges = profile.edge_owner_to_timeline_media?.edges || [];
                    const items = profile.items || [];
                    const rawItems = edges.length > 0 ? edges.map((e: any) => e.node) : items;

                    postsData = rawItems.map((node: any) => {
                        const id = node.id || node.pk;
                        const shortcode = node.shortcode || node.code;
                        return {
                            id: String(id),
                            shortcode: shortcode,
                            url: `https://www.instagram.com/p/${shortcode}/`,
                            total_likes: node.edge_liked_by?.count || node.like_count || 0,
                            total_comments: node.edge_media_to_comment?.count || node.comment_count || 0,
                            total_shares: node.share_count || 0,
                            total_plays: node.play_count || node.view_count || 0,
                            total_saves: node.save_count || 0,
                            timestamp: (node.taken_at_timestamp || node.taken_at) ?
                                new Date((node.taken_at_timestamp || node.taken_at) * 1000).toISOString() : null
                        };
                    });
                }
            } catch (pErr: any) {
                console.warn(`[WEBHOOK] Failed to fetch per-post analytics: ${pErr.message}`);
            }

            // If nothing new happened and no data found, skip
            if (recentStories.length === 0 && postsData.length === 0) return;

            // 3. Map Notifications to Specific Posts & Fetch missing details if needed
            const enrichedInteractions = await Promise.all(recentStories.map(async (s: any) => {
                const ts = s.args?.timestamp;
                const timeStr = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString();
                const userLink = s.args?.links?.find((l: any) => l.type === 'user');

                const storyMedia = s.args?.media?.[0];
                const storyShortcode = storyMedia?.shortcode;
                const storyMediaId = String(storyMedia?.id || "");
                const mediaIdFromArgs = String(s.args?.media_id || s.args?.node_id || "");
                const targetMediaId = storyMediaId || mediaIdFromArgs;

                const matchingPost = postsData.find(p =>
                    (targetMediaId && targetMediaId !== "undefined" && (targetMediaId.includes(p.id) || p.id.includes(targetMediaId))) ||
                    (storyShortcode && p.shortcode === storyShortcode)
                );

                let currentLikes = matchingPost?.total_likes || null;
                let currentComments = matchingPost?.total_comments || null;
                let currentShares = matchingPost?.total_shares || null;
                let currentPlays = matchingPost?.total_plays || null;
                let currentSaves = matchingPost?.total_saves || null;

                // --- USER REQUEST: If counts are null (not in top 12), perform an active fetch ---
                if (currentLikes === null && (targetMediaId || storyShortcode)) {
                    try {
                        const lookupId = targetMediaId && targetMediaId !== "undefined" ? targetMediaId : storyShortcode;
                        console.log(`[WEBHOOK] Fetching on-demand stats for ${lookupId}...`);
                        const detail = await bot.getMediaDetail(lookupId);
                        if (detail) {
                            currentLikes = detail.like_count;
                            currentComments = detail.comment_count;
                            currentShares = detail.share_count;
                            currentPlays = detail.play_count;
                            currentSaves = detail.save_count;
                        }
                    } catch (e: any) {
                        console.warn(`[WEBHOOK] Active detail fetch failed: ${e.message}`);
                    }
                }

                return {
                    event_type: s.story_type || s.type,
                    description: s.args?.text,
                    user: userLink?.username,
                    event_time: timeStr,
                    post_info: {
                        url: matchingPost?.url || (storyShortcode ? `https://www.instagram.com/p/${storyShortcode}/` : null),
                        shortcode: storyShortcode || matchingPost?.shortcode,
                        current_total_likes: currentLikes,
                        current_total_comments: currentComments,
                        current_total_shares: currentShares,
                        current_total_plays: currentPlays,
                        current_total_saves: currentSaves,
                        media_id: targetMediaId || null
                    }
                };
            }));

            finalPayload.activity_type = 'INCOMING_NOTIFICATIONS';
            finalPayload.account_summary = accountSummary;
            finalPayload.recent_posts_stats = postsData;
            finalPayload.new_interactions = enrichedInteractions;
            finalPayload.unread_inbox_counts = activity.counts || {};
        }

        console.log(`[WEBHOOK] Pushing event ${payload.event} to ${acc.webhook}`);

        await axios.post(acc.webhook, finalPayload, {
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Airoza-Webhook/1.0'
            }
        });

        return true;
    } catch (e: any) {
        console.error(`[WEBHOOK] Push failed for ${username}: ${e.message}`);
        return false;
    }
}
